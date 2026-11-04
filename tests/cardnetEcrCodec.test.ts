import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CARDNET_CONTROL,
    CARDNET_FS,
    buildCloseRequest,
    buildLastTransactionRequest,
    buildRefundRequest,
    buildSaleRequest,
    buildTipAdjustRequest,
    buildVoidRequest,
    computeLrc,
    formatAlphaField,
    formatAmountField,
    formatNumericField,
    frameCardNetPayload,
    joinFields,
    parseCardNetResponse,
    parseCloseResponse,
    parseSaleResponse,
    splitFields,
    unframeCardNetPayload,
} from '../services/payments/CardNetEcrCodec';
import {
    CardNetEcrError,
    NATIVE_TRANSPORT_REQUIRED_MESSAGE,
    cardNetEcrService,
    resolveCardNetEndpoint,
    setCardNetEcrTransport,
} from '../services/payments/CardNetEcrService';
import type { CardNetEcrTransport } from '../services/payments/CardNetEcrService';
import type { PaymentIntegrationDefinition } from '../types';

const STX = String.fromCharCode(CARDNET_CONTROL.STX);
const ETX = String.fromCharCode(CARDNET_CONTROL.ETX);

const makeIntegration = (overrides: Partial<PaymentIntegrationDefinition> = {}): PaymentIntegrationDefinition => ({
    id: 'int-cardnet-1',
    name: 'CardNET Caja 1',
    provider: 'CARDNET',
    isEnabled: true,
    environment: 'PRODUCTION',
    baseUrl: '192.168.1.50:7060',
    merchantId: '349111111000',
    terminalId: '12345678',
    timeoutMs: 90_000,
    capabilities: { sale: true, void: true, refund: true, settle: true },
    metadata: {},
    auditEvents: [],
    ...overrides,
});

/** Respuesta de venta del ejemplo 1.2 (layout 2.2, sin campos especiales). */
const SALE_RESPONSE_LEGACY = [
    '06', 'VISA ', 'D@5', '54229800xxxx6290 ', '001', '120310', '101010',
    'JOAQUIN  PRUEBA ', '123456', '12345678', '001', '009912345678',
    '349111111000 ', '0000', '123456789012345', '0543210987654321',
    '0'.repeat(64), '02000234090211.bmp',
].join(CARDNET_FS) + CARDNET_FS;

/** Respuesta con Campos Especiales (ejemplo de la sección "Campos Especiales"). */
const SALE_RESPONSE_WITH_SPECIALS = [
    '06', 'MC', 'D@5', '52995200****4010', '004', '010518', '142012',
    'JUANA GOMEZ', '821520', '82828282', '123', '545825485214', '000034900000000',
    '', '123456789012345', '', '', '', '', '',
    '34901056568754475757.bmp', '',
    'S ', 'APROBADA', '1', '00/00 ', '1 ', 'CARDNET', '0', '0 ',
].join(CARDNET_FS) + CARDNET_FS;

/** Respuesta 2.25 con Indicador de Venta, tipo de producto y campos especiales. */
const buildModernSaleResponse = (options: {
    authorizationCode?: string;
    message?: string;
    productType?: string;
} = {}): string => joinFields([
    '06', 'VC', 'C@5', '54229800****6290', '001', '120310', '101010',
    'JUAN PEREZ', options.authorizationCode ?? '123456', '12345678', '002',
    '009912345679', '349111111000', '0000', '123456789012345', 'A0000000041010',
    '00', options.productType ?? 'VC', ' '.repeat(59), '',
    'N', options.message ?? 'APROBADA', '1', '00/00', '4', 'CARDNET', '0', '1',
]);

test('formatea montos como enteros de centavos con ceros a la izquierda', () => {
    assert.equal(formatAmountField(250, 12), '000000025000');
    assert.equal(formatAmountField(10, 12), '000000001000');
    assert.equal(formatAmountField(1.6, 12), '000000000160');
    assert.equal(formatAmountField(0.05, 12), '000000000005');
    assert.equal(formatAmountField(0, 12), '000000000000');
    assert.ok(formatAlphaField('CN00', 4) === 'CN00');
    assert.equal(formatAlphaField('VISA', 8), 'VISA    ');
    assert.equal(formatNumericField('56', 6), '000056');
    assert.equal(formatNumericField('1234567', 6), '234567');
});

test('rechaza montos que no caben en 12 posiciones', () => {
    assert.throws(() => formatAmountField(10_000_000_000, 12), /excede la longitud/);
});

test('calcula el LRC con XOR de STX..ETX', () => {
    assert.equal(computeLrc([0x02, 0x0a, 0x03]), 0x02 ^ 0x0a ^ 0x03);
    assert.equal(computeLrc([]), 0);
    assert.equal(computeLrc([0xff, 0xff]), 0);
});

test('envuelve y desenvuelve la trama según el framing configurado', () => {
    const payload = `CN00${CARDNET_FS}${CARDNET_FS}`;

    assert.equal(frameCardNetPayload(payload, 'PLAIN'), payload);

    const framedNoLrc = frameCardNetPayload(payload, 'STX_ETX');
    assert.equal(framedNoLrc, `${STX}${payload}${ETX}`);

    const framed = frameCardNetPayload(payload, 'STX_ETX_LRC');
    const unframed = unframeCardNetPayload(framed);

    assert.equal(unframed.payload, payload);
    assert.equal(unframed.hasStx, true);
    assert.equal(unframed.hasEtx, true);
    assert.equal(unframed.hasLrc, true);
    assert.equal(unframed.lrcValid, true);
    assert.deepEqual(unframed.warnings, []);
});

test('descarta controles de enlace pegados a la trama y detecta LRC inválido', () => {
    const payload = `06${CARDNET_FS}VISA${CARDNET_FS}`;
    const framed = frameCardNetPayload(payload, 'STX_ETX_LRC');

    // EOT/EOM del final del diálogo pegados a la trama.
    const withControls = `${framed}${String.fromCharCode(CARDNET_CONTROL.EOT, CARDNET_CONTROL.EOM)}`;
    const unframed = unframeCardNetPayload(withControls);
    assert.equal(unframed.payload, payload);
    assert.equal(unframed.lrcValid, true);

    const corrupted = `${STX}${payload}${ETX}${String.fromCharCode(0x00)}`;
    const brokenResult = unframeCardNetPayload(corrupted);
    assert.equal(brokenResult.lrcValid, false);
    assert.match(brokenResult.warnings.join(' '), /LRC recibido/);
});

test('separa posiciones conservando los vacíos intermedios', () => {
    const payload = joinFields(['CN00', '000000001000', '', 'X']);
    assert.deepEqual(splitFields(payload), ['CN00', '000000001000', '', 'X']);
    assert.deepEqual(splitFields('10'), ['10']);
});

test('construye la petición de venta con el layout del ejemplo de la especificación', () => {
    const request = buildSaleRequest({
        amount: 250,
        itbis: 20,
        otherTaxes: 0,
        invoiceTicket: '56',
    });

    assert.equal(request.code, 'CN00');
    assert.equal(request.payload, `CN00${CARDNET_FS}000000025000${CARDNET_FS}000000002000${CARDNET_FS}000000000000${CARDNET_FS}000056${CARDNET_FS}`);

    const withMerchant = buildSaleRequest({
        amount: 10,
        itbis: 1.6,
        otherTaxes: 0.4,
        invoiceTicket: '1',
        multiMerchantId: '1',
    });

    assert.equal(
        withMerchant.payload,
        ['CN00', '01', '000000001000', '000000000160', '000000000040', '000001']
            .join(CARDNET_FS) + CARDNET_FS
    );
});

test('construye venta diferida y tPago con sus campos adicionales', () => {
    const deferred = buildSaleRequest({ amount: 100, invoiceTicket: '12', code: 'CU00', deferred: '6' });
    assert.deepEqual(
        deferred.fields.map(field => field.name),
        ['tipoTransaccion', 'montoTransaccion', 'itbis', 'otrosImpuestos', 'ticketFactura', 'diferido']
    );
    assert.equal(deferred.fields[5].value, '06');

    const tpago = buildSaleRequest({ amount: 100, invoiceTicket: '12', code: 'TP00', phoneNumber: '8095551234' });
    assert.ok(tpago.payload.includes('8095551234'));
});

test('construye devolución, anulación, cierre, propina y consultas', () => {
    const refund = buildRefundRequest({ amount: 100, itbis: 0, invoiceTicket: '123456' });
    assert.equal(
        refund.payload,
        ['CN03', '000000010000', '000000000000', '000000000000', '123456'].join(CARDNET_FS) + CARDNET_FS
    );

    const voidRequest = buildVoidRequest({ host: '06', referenceNumber: '1' });
    assert.equal(voidRequest.payload, ['CN02', '06', '001'].join(CARDNET_FS) + CARDNET_FS);

    const voidCheckIn = buildVoidRequest({ host: '06', referenceNumber: '7', folio: '1234', code: 'CH02' });
    assert.equal(
        voidCheckIn.payload,
        ['CH02', '06', '00001234', '007'].join(CARDNET_FS) + CARDNET_FS
    );

    assert.equal(buildCloseRequest().payload, `CN01${CARDNET_FS}`);
    assert.equal(buildCloseRequest({ multiMerchantId: '99' }).payload, ['CN01', '99'].join(CARDNET_FS) + CARDNET_FS);
    assert.equal(buildLastTransactionRequest().payload, `UT00${CARDNET_FS}`);

    const tip = buildTipAdjustRequest({ host: '06', referenceNumber: '3', tipAmount: 50 });
    assert.equal(tip.payload, ['AV00', '06', '003', '000000005000'].join(CARDNET_FS) + CARDNET_FS);
});

test('interpreta la respuesta de venta del ejemplo 1.2 (layout 2.2)', () => {
    const parsed = parseSaleResponse(SALE_RESPONSE_LEGACY);
    const sale = parsed.sale;

    assert.ok(sale);
    assert.equal(sale.host, '06');
    assert.equal(sale.cardBrand, 'VISA');
    assert.equal(sale.entryMode, 'D@5');
    assert.equal(sale.maskedPan, '54229800xxxx6290');
    assert.equal(sale.batchNumber, '001');
    assert.equal(sale.date, '120310');
    assert.equal(sale.time, '101010');
    assert.equal(sale.cardHolderName, 'JOAQUIN  PRUEBA');
    assert.equal(sale.authorizationCode, '123456');
    assert.equal(sale.terminalId, '12345678');
    assert.equal(sale.sequenceNumber, '001');
    assert.equal(sale.referenceNumber, '009912345678');
    assert.equal(sale.merchantId, '349111111000');
    assert.equal(sale.aid, '0543210987654321');
    assert.equal(sale.signatureFile, '02000234090211.bmp');
    assert.equal(parsed.approved, true);
    assert.equal(parsed.responseCode, '00');
});

test('lee los Campos Especiales al final de la trama', () => {
    const parsed = parseSaleResponse(SALE_RESPONSE_WITH_SPECIALS);
    const sale = parsed.sale;

    assert.ok(sale);
    assert.equal(sale.host, '06');
    assert.equal(sale.cardBrand, 'MC');
    assert.equal(sale.authorizationCode, '821520');
    assert.equal(sale.signatureIndicator, 'S');
    assert.equal(sale.responseMessage, 'APROBADA');
    assert.equal(sale.voucherMode, '1');
    assert.equal(sale.emvLevel, 'CARDNET');
    assert.equal(sale.qpsLimit, '0');
    assert.equal(sale.pinType, '0');
    assert.equal(sale.signatureFile, '34901056568754475757.bmp');
    assert.equal(parsed.approved, true);
});

test('lee indicador de venta, tipo de producto y pin en el layout 2.25', () => {
    const parsed = parseSaleResponse(buildModernSaleResponse());
    const sale = parsed.sale;

    assert.ok(sale);
    assert.equal(sale.saleIndicator, '00');
    assert.equal(sale.productType, 'VC');
    assert.equal(sale.pinType, '1');
    assert.equal(sale.responseMessage, 'APROBADA');
    assert.equal(parsed.approved, true);
    assert.ok(parsed.fields.productType === 'VC');
});

test('marca como rechazada una venta sin código de autorización o con mensaje de rechazo', () => {
    const declined = parseSaleResponse(buildModernSaleResponse({
        authorizationCode: '000000',
        message: 'FONDOS INSUFICIENTES',
    }));

    assert.equal(declined.approved, false);
    assert.equal(declined.responseCode, '99');
    assert.equal(declined.responseMessage, 'FONDOS INSUFICIENTES');
});

const buildModernSaleResponseWithTip = (): string => joinFields([
    '06', 'MD', 'D@5', '54229800****6290', '001', '120310', '101010', 'JUAN PEREZ',
    '123456', '12345678', '002', '009912345679', '349111111000', '0000', '123456789012345',
    'A0000000041010',
    '00', '000000005000', 'MD', ' '.repeat(47), '',
    'N', 'APROBADA', '1', '00/00', '1', 'CARDNET', '0', '0',
]);

test('detecta ventas MONI, DCC, Promonet y propina sugerida', () => {
    const moni = parseSaleResponse(joinFields([
        '06', 'MC', 'A@5', '52995200****4010', '004', '010518', '142012', 'JUANA GOMEZ',
        '821520', '82828282', '123', '545825485214', '000034900000000', '', '123456789012345', '',
        'BE', 'MC', ' '.repeat(59), '',
        'N', 'APROBADA', '1', '00/00', '7', 'CARDNET', '0', '0',
    ]));
    assert.equal(moni.sale?.moniPayment, true);
    assert.equal(moni.sale?.saleIndicator, 'BE');

    const dcc = parseSaleResponse(joinFields([
        '06', 'MC', 'C@5', '54229800****6290', '001', '120310', '101010', 'JUAN PEREZ',
        '123456', '12345678', '002', '009912345679', '349111111000', '0000', '123456789012345',
        'A0000000041010',
        'DC', 'Y', '3500', '000000012345678', '000018500000000', 'USD', 'MC', ' '.repeat(14), '',
        'N', 'APROBADA', '1', '00/00', '1', 'CARDNET', '0', '1',
    ]));
    assert.equal(dcc.sale?.dcc?.accepted, 'Y');
    assert.equal(dcc.sale?.dcc?.currencySymbol, 'USD');
    assert.equal(dcc.sale?.dcc?.transactionAmount, '000000012345678');
    assert.equal(dcc.approved, true);

    const promonet = parseSaleResponse(joinFields([
        '06', 'MC', 'D@5', '54229800****6290', '001', '120310', '101010', 'JUAN PEREZ',
        '123456', '12345678', '002', '009912345679', '349111111000', '0000', '123456789012345',
        'A0000000041010',
        'PR', 'PRO1', 'PUNTOS PREMIO', 'MC', ' '.repeat(38), '',
        'GANASTE UN PREMIO', 'QR-DATA',
    ]));
    assert.equal(promonet.sale?.promonet?.program, 'PRO1');
    assert.equal(promonet.sale?.promonet?.pointsName, 'PUNTOS PREMIO');
    assert.equal(promonet.sale?.promonet?.message, 'GANASTE UN PREMIO');
    assert.equal(promonet.sale?.promonet?.qrCode, 'QR-DATA');

    const tip = parseSaleResponse(buildModernSaleResponseWithTip());
    assert.equal(tip.sale?.tipAmount, '000000005000');
    assert.equal(tip.sale?.productType, 'MD');
});

test('interpreta anulación, propina y rechazos con código corto', () => {
    const voidApproved = parseCardNetResponse('CN02', `00${CARDNET_FS}`);
    assert.equal(voidApproved.approved, true);
    assert.equal(voidApproved.responseCode, '00');

    const voidFailed = parseCardNetResponse('CN02', `99${CARDNET_FS}`);
    assert.equal(voidFailed.approved, false);
    assert.match(voidFailed.responseMessage, /no progresó/i);

    const tip = parseCardNetResponse('AV00', '05');
    assert.equal(tip.approved, true);
    assert.equal(tip.responseCode, '05');

    const invalidFunction = parseCardNetResponse('CN03', '40');
    assert.equal(invalidFunction.approved, false);
    assert.match(invalidFunction.responseMessage, /Función inválida/i);
});

test('interpreta el cierre por HOST y la modalidad automática', () => {
    const record = (host: string, total: string, result = '00') => [
        result, host, '349111111000', '12345678', '001', '120310', '235959',
        '000', '000000000000', '000000000000', '003', total, '000000000150', '000000000000',
    ];

    const multiHost = parseCloseResponse(joinFields([...record('CREDITO', '000000030000'), ...record('DEBITO', '000000010000')]));
    assert.equal(multiHost.approved, true);
    assert.equal(multiHost.records.length, 2);
    assert.equal(multiHost.records[0].host, 'CREDITO');
    assert.equal(multiHost.records[1].closeTotal, '000000010000');
    assert.equal(multiHost.responseCode, '00');

    const failed = parseCloseResponse(joinFields(record('CREDITO', '000000030000', '01')));
    assert.equal(failed.approved, false);
    assert.equal(failed.responseCode, '01');
    assert.match(failed.responseMessage, /Cierre falló/i);

    const empty = parseCardNetResponse('CN01', '10');
    assert.equal(empty.approved, true);
    assert.equal(empty.responseCode, '10');
    assert.match(empty.responseMessage, /Lotes vacíos/i);

    const automatic = parseCloseResponse(joinFields(['00', 'CREDITO', '007']));
    assert.equal(automatic.approved, true);
    assert.equal(automatic.records[0].batchNumber, '007');
});

test('resuelve el endpoint Ethernet con puerto 7060 por defecto', () => {
    assert.deepEqual(resolveCardNetEndpoint('192.168.1.50'), { host: '192.168.1.50', port: 7060 });
    assert.deepEqual(resolveCardNetEndpoint('192.168.1.50:7060'), { host: '192.168.1.50', port: 7060 });
    assert.deepEqual(resolveCardNetEndpoint('tcp://10.0.0.5:7000'), { host: '10.0.0.5', port: 7000 });
    assert.deepEqual(resolveCardNetEndpoint('http://pos-cardnet.local:7060/'), { host: 'pos-cardnet.local', port: 7060 });
    assert.throws(() => resolveCardNetEndpoint(''), /requiere la IP del terminal/i);
    assert.throws(() => resolveCardNetEndpoint('192.168.1.50:99999'), /puerto configurado/i);
});

test('normaliza una venta aprobada contra el terminal', async () => {
    const requests: string[] = [];
    const transport: CardNetEcrTransport = {
        async transact(request) {
            requests.push(request.requestFrame);
            return {
                ok: true,
                responseFrame: frameCardNetPayload(buildModernSaleResponse(), request.framing),
                transcript: 'ECR -> ENQ\nPOS -> ACK',
                elapsedMs: 1234,
            };
        },
        async probe() {
            return { reachable: true, message: 'ok', latencyMs: 12 };
        },
    };

    setCardNetEcrTransport(transport);
    try {
        const result = await cardNetEcrService.sale(makeIntegration(), {
            amount: 100,
            itbis: 16,
            invoiceTicket: '654321',
        });

        assert.equal(result.provider, 'CARDNET');
        assert.equal(result.approved, true);
        assert.equal(result.authorizationCode, '123456');
        assert.equal(result.referenceNumber, '009912345679');
        assert.equal(result.sequenceNumber, '002');
        assert.equal(result.batchNumber, '001');
        assert.equal(result.maskedPan, '54229800****6290');
        assert.equal(result.cardBrand, 'VC');
        assert.equal(result.host, '06');
        assert.equal(result.invoiceNumber, '654321');
        assert.equal(result.terminalId, '12345678');
        assert.match(result.receiptMerchant, /CARDNET/);
        assert.match(result.receiptMerchant, /123456/);
        assert.equal(requests.length, 1);
        assert.ok(requests[0].includes('CN00'));
        assert.ok(requests[0].startsWith(STX));
        assert.ok(requests[0].includes(ETX));
        assert.equal(result.rawResponse.lrcValid, true);
    } finally {
        setCardNetEcrTransport(null);
    }
});

test('lanza CardNetEcrError cuando el terminal rechaza la venta', async () => {
    setCardNetEcrTransport({
        async transact() {
            return {
                ok: true,
                responseFrame: buildModernSaleResponse({ authorizationCode: '000000', message: 'TARJETA VENCIDA' }),
                transcript: '',
                elapsedMs: 10,
            };
        },
        async probe() {
            return { reachable: true, message: 'ok', latencyMs: 1 };
        },
    });

    try {
        await assert.rejects(
            () => cardNetEcrService.sale(makeIntegration(), { amount: 50, itbis: 8 }),
            (error: unknown) => {
                assert.ok(error instanceof CardNetEcrError);
                assert.equal(error.action, 'SALE');
                assert.equal(error.parsed?.responseCode, '99');
                assert.match(error.message, /TARJETA VENCIDA/);
                return true;
            }
        );
    } finally {
        setCardNetEcrTransport(null);
    }
});

test('propaga los fallos de transporte del socket nativo', async () => {
    setCardNetEcrTransport({
        async transact() {
            return {
                ok: false,
                responseFrame: '',
                transcript: 'ECR -> ENQ\nERROR NO_ACK_ENQ',
                elapsedMs: 8000,
                errorCode: 'NO_ACK_ENQ',
                errorMessage: 'El terminal no respondio ACK al ENQ.',
            };
        },
        async probe() {
            return { reachable: false, message: 'sin ACK', latencyMs: 8000, errorCode: 'NO_ACK' };
        },
    });

    try {
        await assert.rejects(
            () => cardNetEcrService.sale(makeIntegration(), { amount: 10 }),
            (error: unknown) => {
                assert.ok(error instanceof CardNetEcrError);
                assert.match(error.message, /no respondio ACK al ENQ/);
                assert.match(error.transcript || '', /NO_ACK_ENQ/);
                return true;
            }
        );
    } finally {
        setCardNetEcrTransport(null);
    }
});

test('anulación y cierre usan las tramas CN02 y CN01', async () => {
    const frames: string[] = [];
    setCardNetEcrTransport({
        async transact(request) {
            frames.push(request.requestFrame);
            if (request.requestFrame.includes('CN01')) {
                return {
                    ok: true,
                    responseFrame: joinFields([
                        '00', 'CREDITO', '349111111000', '12345678', '001', '120310', '235959',
                        '000', '000000000000', '000000000000', '003', '000000030000', '000000000150', '000000000000',
                    ]),
                    transcript: '',
                    elapsedMs: 30,
                };
            }

            return { ok: true, responseFrame: '00', transcript: '', elapsedMs: 5 };
        },
        async probe() {
            return { reachable: true, message: 'ok', latencyMs: 1 };
        },
    });

    try {
        const voidResult = await cardNetEcrService.saleCancellation(makeIntegration(), {
            host: '06',
            referenceNumber: '2',
        });
        assert.equal(voidResult.approved, true);

        const closeResult = await cardNetEcrService.closeBatch(makeIntegration());
        assert.equal(closeResult.approved, true);
        assert.equal(closeResult.batchNumber, '001');
        assert.equal(closeResult.closeRecords.length, 1);
        assert.match(closeResult.receiptMerchant, /CIERRE CARDNET/);
        assert.ok(frames[0].includes('CN02'));
        assert.ok(frames[1].includes('CN01'));
    } finally {
        setCardNetEcrTransport(null);
    }
});

test('la prueba de conexión informa el handshake ENQ/ACK', async () => {
    setCardNetEcrTransport({
        async transact() {
            throw new Error('no debería usarse en la prueba de conexión');
        },
        async probe(request) {
            assert.equal(request.port, 7060);
            return { reachable: true, message: 'Terminal CardNET en linea en 192.168.1.50:7060.', latencyMs: 42 };
        },
    });

    try {
        const result = await cardNetEcrService.testConnection(makeIntegration());
        assert.equal(result.success, true);
        assert.equal(result.responseCode, 'ENQ_ACK');
        assert.equal(result.port, 7060);
        assert.equal(result.latencyMs, 42);
    } finally {
        setCardNetEcrTransport(null);
    }
});

test('sin APK Android la integración explica que hace falta el plugin nativo', async () => {
    setCardNetEcrTransport(null);

    const result = await cardNetEcrService.testConnection(makeIntegration());

    assert.equal(result.success, false);
    assert.equal(result.message, NATIVE_TRANSPORT_REQUIRED_MESSAGE);
});

test('rechaza integraciones que no son CardNET', async () => {
    await assert.rejects(
        () => cardNetEcrService.sale(makeIntegration({ provider: 'AZUL' }), { amount: 10 }),
        /no corresponde a CardNET/
    );

    await assert.rejects(
        () => cardNetEcrService.sale(makeIntegration({ baseUrl: '' }), { amount: 10 }),
        /requiere la IP del terminal/i
    );
});
