import { Capacitor, registerPlugin } from '@capacitor/core';

import { PaymentIntegrationDefinition } from '../../types';
import {
    CARDNET_DEFAULT_PORT,
    CARDNET_RESPONSE_CODE_LABELS,
    CardNetEcrFraming,
    CardNetParsedResponse,
    CardNetSaleResponse,
    CardNetTransactionCode,
    buildCardInquiryRequest,
    buildCloseRequest,
    buildLastTransactionRequest,
    buildRefundRequest,
    buildReverseRequest,
    buildSaleRequest,
    buildTipAdjustRequest,
    buildVoidRequest,
    frameCardNetPayload,
    parseCardNetResponse,
    splitFields,
} from './CardNetEcrCodec';

export type CardNetEcrAction =
    | 'SALE'
    | 'VOID'
    | 'REFUND'
    | 'CLOSE_TOTALS'
    | 'TIP_ADJUST'
    | 'GET_LAST_TRX'
    | 'CARD_INQUIRY';

export interface CardNetEcrNormalizedResult {
    provider: 'CARDNET';
    approved: boolean;
    responseCode: string;
    responseMessage: string;
    transactionCode: CardNetTransactionCode;
    host: string;
    cardBrand: string;
    entryMode: string;
    maskedPan: string;
    batchNumber: string;
    terminalId: string;
    merchantId: string;
    authorizationCode: string;
    referenceNumber: string;
    sequenceNumber: string;
    invoiceNumber: string;
    orderNumber?: string;
    cardHolderName: string;
    tipAmount: string;
    productType: string;
    saleIndicator: string;
    aid: string;
    tidMarca: string;
    voucherMode: string;
    qpsLimit: string;
    pinType: string;
    emvLevel: string;
    deferred: string;
    dcc?: {
        accepted: string;
        marginPercentage: string;
        transactionAmount: string;
        displayRate: string;
        currencySymbol: string;
    };
    promonet?: {
        program: string;
        pointsName: string;
        message: string;
        qrCode: string;
    };
    moniPayment: boolean;
    quickPayment: boolean;
    requireSignature: boolean;
    signatureData?: string;
    receiptMerchant: string;
    receiptClient: string;
    closeRecords: CardNetParsedResponse['records'];
    responseFields: Record<string, string>;
    rawResponse: {
        transactionCode: CardNetTransactionCode;
        requestFrame: string;
        responseFrame: string;
        rawFields: string[];
        transcript: string;
        lrcValid?: boolean;
        warnings: string[];
    };
}

export class CardNetEcrError extends Error {
    action: CardNetEcrAction;
    parsed?: CardNetParsedResponse;
    rawFrame?: string;
    transcript?: string;

    constructor(input: {
        action: CardNetEcrAction;
        message: string;
        parsed?: CardNetParsedResponse;
        rawFrame?: string;
        transcript?: string;
    }) {
        super(input.message);
        this.name = 'CardNetEcrError';
        this.action = input.action;
        this.parsed = input.parsed;
        this.rawFrame = input.rawFrame;
        this.transcript = input.transcript;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** Metadatos reconocidos dentro de `PaymentIntegrationDefinition.metadata`. */
export const CARDNET_METADATA_KEYS = {
    multiMerchantId: 'cardnet.multiMerchantId',
    framing: 'cardnet.framing',
    connectTimeoutMs: 'cardnet.connectTimeoutMs',
} as const;

export const CARDNET_PLUGIN_NAME = 'CardNetEcr';

const DEFAULT_SALE_TIMEOUT_MS = 90_000; // sección 1: la ECR espera hasta 90 s
const DEFAULT_CLOSE_TIMEOUT_MS = 150_000; // sección 3: hasta 150 s por lote
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

export interface CardNetEndpoint {
    host: string;
    port: number;
}

/**
 * Acepta `192.168.1.50`, `192.168.1.50:7060`, `tcp://192.168.1.50:7060`
 * o `http://192.168.1.50:7060` en el campo "URL base" de la integración.
 */
export const resolveCardNetEndpoint = (rawBaseUrl?: string): CardNetEndpoint => {
    const trimmed = String(rawBaseUrl || '').trim();

    if (!trimmed) {
        throw new Error('CardNET requiere la IP del terminal Ethernet (campo de conexión).');
    }

    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
    const [hostPart, portPart] = withoutScheme.split('/')[0].split(':');
    const host = (hostPart || '').trim();
    const port = Number((portPart || '').trim());

    if (!host) {
        throw new Error('CardNET requiere la IP del terminal Ethernet (campo de conexión).');
    }

    if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
        throw new Error(`La IP/host configurado para CardNET no es válido: "${host}".`);
    }

    if (portPart && (!Number.isFinite(port) || port <= 0 || port > 65535)) {
        throw new Error(`El puerto configurado para CardNET no es válido: "${portPart}".`);
    }

    return { host, port: portPart ? port : CARDNET_DEFAULT_PORT };
};

const resolveFraming = (integration: PaymentIntegrationDefinition): CardNetEcrFraming => {
    const raw = String(integration.metadata?.[CARDNET_METADATA_KEYS.framing] || '').trim().toUpperCase();
    if (raw === 'PLAIN' || raw === 'STX_ETX' || raw === 'STX_ETX_LRC') return raw;
    return 'STX_ETX_LRC';
};

const resolveMultiMerchantId = (integration: PaymentIntegrationDefinition): string => (
    String(integration.metadata?.[CARDNET_METADATA_KEYS.multiMerchantId] || '').trim()
);

const resolveTimeout = (integration: PaymentIntegrationDefinition, fallback: number): number => {
    const candidate = Number(integration.timeoutMs || 0);
    return Number.isFinite(candidate) && candidate >= 1_000 ? candidate : fallback;
};

const resolveConnectTimeout = (integration: PaymentIntegrationDefinition): number => {
    const candidate = Number(integration.metadata?.[CARDNET_METADATA_KEYS.connectTimeoutMs] || 0);
    return Number.isFinite(candidate) && candidate >= 500 ? candidate : DEFAULT_CONNECT_TIMEOUT_MS;
};

const ensureCardNetIntegration = (integration: PaymentIntegrationDefinition): void => {
    if (integration.provider !== 'CARDNET') {
        throw new Error('La integración seleccionada no corresponde a CardNET.');
    }

    resolveCardNetEndpoint(integration.baseUrl);
};

// ---------------------------------------------------------------------------
// Transporte: plugin nativo Android (socket TCP crudo al puerto 7060)
// ---------------------------------------------------------------------------

export interface CardNetEcrTransportRequest {
    host: string;
    port: number;
    /** Trama ya envuelta con STX/ETX/LRC según el framing configurado. */
    requestFrame: string;
    framing: CardNetEcrFraming;
    connectTimeoutMs: number;
    ackTimeoutMs: number;
    responseTimeoutMs: number;
}

export interface CardNetEcrTransportResponse {
    ok: boolean;
    responseFrame: string;
    transcript: string;
    elapsedMs: number;
    errorCode?: string;
    errorMessage?: string;
}

export interface CardNetEcrProbeRequest {
    host: string;
    port: number;
    connectTimeoutMs: number;
    ackTimeoutMs: number;
}

export interface CardNetEcrProbeResponse {
    reachable: boolean;
    message: string;
    latencyMs: number;
    responseFrame?: string;
    transcript?: string;
    errorCode?: string;
}

export interface CardNetEcrTransport {
    transact(request: CardNetEcrTransportRequest): Promise<CardNetEcrTransportResponse>;
    probe(request: CardNetEcrProbeRequest): Promise<CardNetEcrProbeResponse>;
}

interface CardNetEcrNativePlugin {
    transact(options: {
        host: string;
        port: number;
        requestFrame: string;
        framing: string;
        connectTimeoutMs: number;
        ackTimeoutMs: number;
        responseTimeoutMs: number;
    }): Promise<{
        ok: boolean;
        responseFrame: string;
        transcript: string;
        elapsedMs: number;
        errorCode?: string;
        errorMessage?: string;
    }>;
    probe(options: {
        host: string;
        port: number;
        connectTimeoutMs: number;
        ackTimeoutMs: number;
    }): Promise<{
        reachable: boolean;
        message: string;
        latencyMs: number;
        responseFrame?: string;
        transcript?: string;
        errorCode?: string;
    }>;
}

const CardNetEcrNative = registerPlugin<CardNetEcrNativePlugin>(CARDNET_PLUGIN_NAME);

const isNativeRuntime = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

export const NATIVE_TRANSPORT_REQUIRED_MESSAGE =
    'La integración CardNET Ethernet necesita la APK Android de CLIC-POS: el navegador no puede abrir sockets TCP al terminal en el puerto 7060.';

const nativeTransport: CardNetEcrTransport = {
    async transact(request) {
        if (!isNativeRuntime()) {
            throw new Error(NATIVE_TRANSPORT_REQUIRED_MESSAGE);
        }

        const response = await CardNetEcrNative.transact({
            host: request.host,
            port: request.port,
            requestFrame: request.requestFrame,
            framing: request.framing,
            connectTimeoutMs: request.connectTimeoutMs,
            ackTimeoutMs: request.ackTimeoutMs,
            responseTimeoutMs: request.responseTimeoutMs,
        });

        return {
            ok: Boolean(response?.ok),
            responseFrame: String(response?.responseFrame || ''),
            transcript: String(response?.transcript || ''),
            elapsedMs: Number(response?.elapsedMs || 0),
            errorCode: response?.errorCode,
            errorMessage: response?.errorMessage,
        };
    },

    async probe(request) {
        if (!isNativeRuntime()) {
            throw new Error(NATIVE_TRANSPORT_REQUIRED_MESSAGE);
        }

        const response = await CardNetEcrNative.probe({
            host: request.host,
            port: request.port,
            connectTimeoutMs: request.connectTimeoutMs,
            ackTimeoutMs: request.ackTimeoutMs,
        });

        return {
            reachable: Boolean(response?.reachable),
            message: String(response?.message || ''),
            latencyMs: Number(response?.latencyMs || 0),
            responseFrame: response?.responseFrame,
            transcript: response?.transcript,
            errorCode: response?.errorCode,
        };
    },
};

let activeTransport: CardNetEcrTransport = nativeTransport;

/** Permite inyectar un transporte alternativo (pruebas o bridge de escritorio). */
export const setCardNetEcrTransport = (transport: CardNetEcrTransport | null): void => {
    activeTransport = transport || nativeTransport;
};

export const getCardNetEcrTransport = (): CardNetEcrTransport => activeTransport;

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

const amountFromCents = (value?: string): string => {
    const digits = String(value ?? '').replace(/[^0-9]/g, '');
    if (!digits) return '0.00';
    return (Number(digits) / 100).toFixed(2);
};

const formatTransactionDate = (ddmmaa?: string): string => {
    const raw = String(ddmmaa ?? '').trim();
    if (!/^\d{6}$/.test(raw)) return raw;
    return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/20${raw.slice(4, 6)}`;
};

const formatTransactionTime = (hhmmss?: string): string => {
    const raw = String(hhmmss ?? '').trim();
    if (!/^\d{6}$/.test(raw)) return raw;
    return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
};

const line = (label: string, value?: string): string => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    return `${label.padEnd(13, ' ')}${trimmed}`;
};

/** Voucher que la caja imprime con los datos no sensibles devueltos por el terminal. */
export const buildCardNetSaleVoucher = (
    sale: CardNetSaleResponse | undefined,
    options: { amount?: number; itbis?: number; invoiceTicket?: string } = {}
): string => {
    if (!sale) return '';

    const rows = [
        'CARDNET - COMPROBANTE DE VENTA',
        '--------------------------------',
        line('TARJETA', `${sale.cardBrand} ${sale.maskedPan}`.trim()),
        line('MODO', sale.entryMode),
        line('AUT', sale.authorizationCode),
        line('LOTE/TERM', `${sale.batchNumber} / ${sale.terminalId}`),
        line('FECHA', `${formatTransactionDate(sale.date)} ${formatTransactionTime(sale.time)}`.trim()),
        line('REF/SEC', `${sale.referenceNumber} / ${sale.sequenceNumber}`.trim()),
        line('TITULAR', sale.cardHolderName),
        line('TICKET', options.invoiceTicket),
        line('MONTO', options.amount !== undefined ? options.amount.toFixed(2) : ''),
        line('ITBIS', options.itbis !== undefined ? options.itbis.toFixed(2) : ''),
        line('PROPINA', sale.tipAmount ? amountFromCents(sale.tipAmount) : ''),
        line('PRODUCTO', sale.productType),
        line('AID', sale.aid),
        line('ESTADO', sale.responseMessage),
    ].filter(Boolean);

    if (sale.dcc?.accepted === 'Y') {
        rows.push(
            '--------------------------------',
            line('DCC MONEDA', sale.dcc.currencySymbol),
            line('DCC MONTO', amountFromCents(sale.dcc.transactionAmount)),
            line('DCC TASA', sale.dcc.displayRate),
            line('DCC MARGEN', sale.dcc.marginPercentage)
        );
    }

    if (sale.promonet) {
        rows.push(
            '--------------------------------',
            'PROMONET',
            line('PROGRAMA', sale.promonet.program),
            line('PUNTOS', sale.promonet.pointsName),
            sale.promonet.message,
            sale.promonet.qrCode ? `QR: ${sale.promonet.qrCode}` : ''
        );
    }

    if (sale.moniPayment) {
        rows.push('PAGO CON BILLETERA MONI', 'Recibo enviado al tarjetahabiente por correo.');
    }

    if (sale.quickPayment) {
        rows.push('FIRMA NO REQUERIDA / PAGO RAPIDO');
    }

    return rows.filter(Boolean).join('\n');
};

/** Resumen imprimible del cierre (uno por HOST reportado por el terminal). */
export const buildCardNetCloseVoucher = (
    parsed: CardNetParsedResponse,
    integration: PaymentIntegrationDefinition
): string => {
    if (!parsed.records.length) {
        return [
            'CIERRE CARDNET',
            '--------------------------------',
            line('ESTADO', parsed.responseMessage),
            line('RESULTADO', parsed.responseCode),
        ].filter(Boolean).join('\n');
    }

    const header = [
        'CIERRE CARDNET',
        '--------------------------------',
        line('TERMINAL', parsed.records[0].terminalId || integration.terminalId || ''),
        line('LOTE', parsed.records[0].batchNumber),
        line('FECHA', `${formatTransactionDate(parsed.records[0].closeDate)} ${formatTransactionTime(parsed.records[0].closeTime)}`.trim()),
        '--------------------------------',
        'HOST      VENTAS      MONTO       DEVOL.',
    ];

    const rows = parsed.records.map(record => (
        [
            String(record.host || '').padEnd(9, ' '),
            String(record.saleCount || '0').padEnd(11, ' '),
            amountFromCents(record.closeTotal).padStart(11, ' '),
            amountFromCents(record.refundAmount).padStart(12, ' ')
        ].join(' ')
    ));

    return [...header, ...rows].join('\n');
};

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const normalizeResult = (input: {
    integration: PaymentIntegrationDefinition;
    code: CardNetTransactionCode;
    parsed: CardNetParsedResponse;
    requestFrame: string;
    responseFrame: string;
    transcript: string;
    invoiceTicket?: string;
    amount?: number;
    itbis?: number;
}): CardNetEcrNormalizedResult => {
    const { integration, code, parsed, requestFrame, responseFrame, transcript } = input;
    const sale = parsed.sale;
    const inquiry = parsed.inquiry;
    const isClose = code === 'CN01';

    const responseFields = {
        ...parsed.fields,
        resultCode: parsed.responseCode,
        resultMessage: parsed.responseMessage,
    };

    if (parsed.sale) {
        Object.entries({
            host: parsed.sale.host,
            cardBrand: parsed.sale.cardBrand,
            entryMode: parsed.sale.entryMode,
            maskedPan: parsed.sale.maskedPan,
            batchNumber: parsed.sale.batchNumber,
            authorizationCode: parsed.sale.authorizationCode,
            terminalId: parsed.sale.terminalId,
            sequenceNumber: parsed.sale.sequenceNumber,
            referenceNumber: parsed.sale.referenceNumber,
            merchantId: parsed.sale.merchantId,
        }).forEach(([key, value]) => {
            if (value) responseFields[key] = value;
        });
    }

    const receipt = isClose
        ? buildCardNetCloseVoucher(parsed, integration)
        : buildCardNetSaleVoucher(sale, {
            amount: input.amount,
            itbis: input.itbis,
            invoiceTicket: input.invoiceTicket,
        });

    return {
        provider: 'CARDNET',
        approved: parsed.approved,
        responseCode: parsed.responseCode,
        responseMessage: parsed.responseMessage,
        transactionCode: code,
        host: sale?.host || inquiry?.host || parsed.records[0]?.host || '',
        cardBrand: sale?.cardBrand || inquiry?.cardBrand || '',
        entryMode: sale?.entryMode || inquiry?.entryMode || '',
        maskedPan: sale?.maskedPan || (inquiry ? `${inquiry.bin}********` : ''),
        batchNumber: sale?.batchNumber || parsed.records[0]?.batchNumber || '',
        terminalId: sale?.terminalId || parsed.records[0]?.terminalId || integration.terminalId || '',
        merchantId: sale?.merchantId || parsed.records[0]?.merchantId || integration.merchantId || '',
        authorizationCode: sale?.authorizationCode || '',
        referenceNumber: sale?.referenceNumber || '',
        sequenceNumber: sale?.sequenceNumber || '',
        invoiceNumber: input.invoiceTicket || '',
        orderNumber: input.invoiceTicket,
        cardHolderName: sale?.cardHolderName || inquiry?.cardHolderName || '',
        tipAmount: sale?.tipAmount || '',
        productType: sale?.productType || '',
        saleIndicator: sale?.saleIndicator || '',
        aid: sale?.aid || '',
        tidMarca: sale?.tidMarca || '',
        voucherMode: sale?.voucherMode || '',
        qpsLimit: sale?.qpsLimit || '',
        pinType: sale?.pinType || '',
        emvLevel: sale?.emvLevel || '',
        deferred: sale?.deferred || '',
        dcc: sale?.dcc,
        promonet: sale?.promonet,
        moniPayment: Boolean(sale?.moniPayment),
        quickPayment: Boolean(sale?.quickPayment),
        requireSignature: Boolean(sale?.signatureIndicator && /^[SN]$/i.test(sale.signatureIndicator)
            ? sale.signatureIndicator.toUpperCase() === 'S'
            : Boolean(sale?.signature && sale.signature !== '0')),
        signatureData: sale?.signatureFile || undefined,
        receiptMerchant: receipt,
        receiptClient: receipt,
        closeRecords: parsed.records,
        responseFields,
        rawResponse: {
            transactionCode: code,
            requestFrame,
            responseFrame,
            rawFields: parsed.rawFields,
            transcript,
            lrcValid: parsed.lrcValid,
            warnings: parsed.warnings,
        },
    };
};

export const generateCardNetInvoiceTicket = (seed?: number): string => {
    const base = Number.isFinite(seed as number) ? Number(seed) : Date.now();
    return String(Math.abs(Math.trunc(base)) % 1_000_000).padStart(6, '0');
};

const runTransaction = async (input: {
    integration: PaymentIntegrationDefinition;
    action: CardNetEcrAction;
    code: CardNetTransactionCode;
    payload: string;
    invoiceTicket?: string;
    amount?: number;
    itbis?: number;
    responseTimeoutMs?: number;
}): Promise<CardNetEcrNormalizedResult> => {
    const { integration, action, code, payload } = input;
    ensureCardNetIntegration(integration);

    const endpoint = resolveCardNetEndpoint(integration.baseUrl);
    const framing = resolveFraming(integration);
    const requestFrame = frameCardNetPayload(payload, framing);

    let response: CardNetEcrTransportResponse;

    try {
        response = await activeTransport.transact({
            host: endpoint.host,
            port: endpoint.port,
            requestFrame,
            framing,
            connectTimeoutMs: resolveConnectTimeout(integration),
            ackTimeoutMs: DEFAULT_ACK_TIMEOUT_MS,
            responseTimeoutMs: input.responseTimeoutMs
                || resolveTimeout(integration, code === 'CN01' ? DEFAULT_CLOSE_TIMEOUT_MS : DEFAULT_SALE_TIMEOUT_MS),
        });
    } catch (error) {
        throw new CardNetEcrError({
            action,
            message: error instanceof Error ? error.message : 'No se pudo comunicar con el terminal CardNET.',
        });
    }

    if (!response.ok) {
        throw new CardNetEcrError({
            action,
            message: response.errorMessage
                || `El terminal CardNET no respondió a la operación ${code}.`,
            rawFrame: response.responseFrame,
            transcript: response.transcript,
        });
    }

    const parsed = parseCardNetResponse(code, response.responseFrame);
    const normalized = normalizeResult({
        integration,
        code,
        parsed,
        requestFrame,
        responseFrame: response.responseFrame,
        transcript: response.transcript,
        invoiceTicket: input.invoiceTicket,
        amount: input.amount,
        itbis: input.itbis,
    });

    if (!normalized.approved) {
        throw new CardNetEcrError({
            action,
            message: normalized.responseMessage || CARDNET_RESPONSE_CODE_LABELS[normalized.responseCode] || 'Transacción rechazada por el terminal CardNET.',
            parsed,
            rawFrame: response.responseFrame,
            transcript: response.transcript,
        });
    }

    return normalized;
};

export const cardNetEcrService = {
    /** ENQ → ACK: valida que el terminal esté en línea y escuchando en el puerto configurado. */
    async testConnection(integration: PaymentIntegrationDefinition): Promise<{
        success: boolean;
        message: string;
        responseCode?: string;
        responseMessage?: string;
        merchantId?: string;
        terminalId?: string;
        host?: string;
        port?: number;
        latencyMs?: number;
    }> {
        ensureCardNetIntegration(integration);
        const endpoint = resolveCardNetEndpoint(integration.baseUrl);

        try {
            const probe = await activeTransport.probe({
                host: endpoint.host,
                port: endpoint.port,
                connectTimeoutMs: resolveConnectTimeout(integration),
                ackTimeoutMs: DEFAULT_ACK_TIMEOUT_MS,
            });

            return {
                success: probe.reachable,
                message: probe.message || (probe.reachable
                    ? 'Terminal CardNET en línea.'
                    : 'El terminal CardNET no respondió el handshake ENQ/ACK.'),
                responseCode: probe.reachable ? 'ENQ_ACK' : (probe.errorCode || 'NO_ACK'),
                responseMessage: probe.reachable ? 'OK' : 'SIN_RESPUESTA',
                merchantId: integration.merchantId,
                terminalId: integration.terminalId,
                host: endpoint.host,
                port: endpoint.port,
                latencyMs: probe.latencyMs,
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'No se pudo probar la conexión con el terminal CardNET.',
                responseCode: 'TRANSPORT_ERROR',
                responseMessage: 'TRANSPORT_ERROR',
                merchantId: integration.merchantId,
                terminalId: integration.terminalId,
                host: endpoint.host,
                port: endpoint.port,
            };
        }
    },

    async sale(
        integration: PaymentIntegrationDefinition,
        request: {
            amount: number;
            itbis?: number;
            otherTaxes?: number;
            invoiceTicket?: string;
            multiMerchantId?: string;
            deferred?: string;
            code?: 'CN00' | 'CU00' | 'PU00';
        }
    ): Promise<CardNetEcrNormalizedResult> {
        const invoiceTicket = request.invoiceTicket
            ? String(request.invoiceTicket)
            : generateCardNetInvoiceTicket();
        const built = buildSaleRequest({
            amount: request.amount,
            itbis: request.itbis,
            otherTaxes: request.otherTaxes,
            invoiceTicket,
            multiMerchantId: request.multiMerchantId ?? resolveMultiMerchantId(integration),
            deferred: request.deferred,
            code: request.code,
        });

        return runTransaction({
            integration,
            action: 'SALE',
            code: built.code,
            payload: built.payload,
            invoiceTicket,
            amount: request.amount,
            itbis: request.itbis,
        });
    },

    /** Devolución (CN03): posterior al cierre, con la tarjeta presente. */
    async refund(
        integration: PaymentIntegrationDefinition,
        request: {
            amount: number;
            itbis?: number;
            otherTaxes?: number;
            invoiceTicket?: string;
            multiMerchantId?: string;
        }
    ): Promise<CardNetEcrNormalizedResult> {
        const invoiceTicket = request.invoiceTicket
            ? String(request.invoiceTicket)
            : generateCardNetInvoiceTicket();
        const built = buildRefundRequest({
            amount: request.amount,
            itbis: request.itbis,
            otherTaxes: request.otherTaxes,
            invoiceTicket,
            multiMerchantId: request.multiMerchantId ?? resolveMultiMerchantId(integration),
        });

        return runTransaction({
            integration,
            action: 'REFUND',
            code: built.code,
            payload: built.payload,
            invoiceTicket,
            amount: request.amount,
            itbis: request.itbis,
        });
    },

    /** Anulación (CN02) de una venta aún abierta en el lote del terminal. */
    async saleCancellation(
        integration: PaymentIntegrationDefinition,
        request: {
            host: string;
            referenceNumber: string;
            folio?: string;
            multiMerchantId?: string;
            code?: 'CN02' | 'CH02';
        }
    ): Promise<CardNetEcrNormalizedResult> {
        const built = buildVoidRequest({
            host: request.host,
            referenceNumber: request.referenceNumber,
            folio: request.folio,
            multiMerchantId: request.multiMerchantId ?? resolveMultiMerchantId(integration),
            code: request.code,
        });

        return runTransaction({
            integration,
            action: 'VOID',
            code: built.code,
            payload: built.payload,
        });
    },

    /** Cierre de lote (CN01). El POS puede tardar hasta 150 s por lote. */
    async closeBatch(integration: PaymentIntegrationDefinition): Promise<CardNetEcrNormalizedResult> {
        const built = buildCloseRequest({
            multiMerchantId: resolveMultiMerchantId(integration),
        });

        return runTransaction({
            integration,
            action: 'CLOSE_TOTALS',
            code: built.code,
            payload: built.payload,
            responseTimeoutMs: Math.max(resolveTimeout(integration, DEFAULT_CLOSE_TIMEOUT_MS), DEFAULT_CLOSE_TIMEOUT_MS),
        });
    },

    /** Ajuste de propina (AV00). El terminal responde "05" cuando la aplica. */
    async tipAdjust(
        integration: PaymentIntegrationDefinition,
        request: { host: string; referenceNumber: string; tipAmount: number; multiMerchantId?: string }
    ): Promise<CardNetEcrNormalizedResult> {
        const built = buildTipAdjustRequest({
            host: request.host,
            referenceNumber: request.referenceNumber,
            tipAmount: request.tipAmount,
            multiMerchantId: request.multiMerchantId ?? resolveMultiMerchantId(integration),
        });

        return runTransaction({
            integration,
            action: 'TIP_ADJUST',
            code: built.code,
            payload: built.payload,
        });
    },

    /** UT00: recupera la trama de la última transacción aprobada (recuperación de ACK perdido). */
    async getLastTransaction(integration: PaymentIntegrationDefinition): Promise<CardNetEcrNormalizedResult> {
        const built = buildLastTransactionRequest();

        return runTransaction({
            integration,
            action: 'GET_LAST_TRX',
            code: built.code,
            payload: built.payload,
        });
    },

    /** CS00: lectura previa de la tarjeta (BIN, marca y titular, sin datos sensibles). */
    async cardInquiry(integration: PaymentIntegrationDefinition): Promise<CardNetEcrNormalizedResult> {
        const built = buildCardInquiryRequest();

        return runTransaction({
            integration,
            action: 'CARD_INQUIRY',
            code: built.code,
            payload: built.payload,
        });
    },

    /** RT00: reverso controlado por la caja (parámetro "Reverso ECR" encendido). */
    async reverse(
        integration: PaymentIntegrationDefinition,
        request: {
            invoiceTicket: string;
            amount: number;
            transactionDate: string;
            host?: string;
            referenceNumber?: string;
            multiMerchantId?: string;
        }
    ): Promise<CardNetEcrNormalizedResult> {
        const built = buildReverseRequest({
            ...request,
            multiMerchantId: request.multiMerchantId ?? resolveMultiMerchantId(integration),
        });

        return runTransaction({
            integration,
            action: 'VOID',
            code: built.code,
            payload: built.payload,
        });
    },
};

/** Expuesto para pruebas y diagnósticos: posiciones de una trama recibida. */
export const inspectCardNetFrame = (frame: string): string[] => splitFields(frame);

export type CardNetEcrService = typeof cardNetEcrService;
