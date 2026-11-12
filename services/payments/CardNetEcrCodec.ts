/**
 * Codec del protocolo ECRti de CardNET (Consorcio de Tarjetas Dominicanas).
 *
 * Fuente: "Espec_ POS-Caja_PROVEEDORES_Ethernet_Vr. 2.25" (4/02/2025).
 * Este módulo NO abre sockets: solo construye y parsea las tramas de campos
 * que viajan entre la caja (ECR, este POS) y el terminal CardNET.
 *
 * Reglas de justificación (sección "Justificación de Campos"):
 *  - Campos numéricos: justificados a la derecha y rellenados con ceros a la izquierda.
 *  - Campos alfanuméricos: justificados a la izquierda y rellenados con espacios a la derecha.
 *  - Los montos viajan sin punto decimal; los dos últimos dígitos son los centavos.
 *  - Los campos se separan con <FS> (0x1C) y el último campo también lleva su <FS>.
 */

export const CARDNET_DEFAULT_PORT = 7060;

export const CARDNET_CONTROL = {
    EOT: 0x04,
    ACK: 0x06,
    NAK: 0x15,
    ENQ: 0x05,
    SYN: 0x16,
    EOM: 0x19,
    STX: 0x02,
    ETX: 0x03,
    FS: 0x1c,
} as const;

export const CARDNET_FS = String.fromCharCode(CARDNET_CONTROL.FS);

export type CardNetEcrFraming = 'PLAIN' | 'STX_ETX' | 'STX_ETX_LRC';

export const CARDNET_FRAMING_LABELS: Record<CardNetEcrFraming, string> = {
    PLAIN: 'Campos con <FS> (sin STX/ETX)',
    STX_ETX: '<STX> … <ETX>',
    STX_ETX_LRC: '<STX> … <ETX><LRC>',
};

/** Códigos de transacción documentados para el canal ECR. */
export type CardNetTransactionCode =
    | 'CN00' // Venta
    | 'CU00' // Venta diferida (cuotas)
    | 'PU00' // Venta de lealtad / puntos
    | 'TP00' // tPago
    | 'PA00' // Recarga de peaje
    | 'BR00' // BR+
    | 'CH00' // Check IN
    | 'CH01' // Check OUT crédito
    | 'CH05' // Check OUT AMEX
    | 'IC00' // Incremento Check IN
    | 'QC00' // Quasi Cash
    | 'NS00' // Not Show
    | 'RD00' // Room Deposit
    | 'CN01' // Cierre
    | 'CN02' // Anulación de venta
    | 'CH02' // Anulación de Check IN
    | 'CN03' // Devolución
    | 'AV00' // Ajuste de propina
    | 'CS00' // Consulta de tarjeta
    | 'UT00' // Consulta última transacción aprobada
    | 'RT00' // Reverso de venta
    | 'PR00' // Pre autorización
    | 'PR01' // Confirmación de pago
    | 'PR05'; // Confirmación de pago AMEX

export const CARDNET_TRANSACTION_LABELS: Record<string, string> = {
    CN00: 'Venta',
    CU00: 'Venta diferida',
    PU00: 'Venta de lealtad',
    TP00: 'tPago',
    PA00: 'Recarga de peaje',
    BR00: 'BR+',
    CH00: 'Check IN',
    CH01: 'Check OUT',
    CH05: 'Check OUT AMEX',
    IC00: 'Incremento Check IN',
    QC00: 'Quasi Cash',
    NS00: 'Not Show',
    RD00: 'Room Deposit',
    CN01: 'Cierre',
    CN02: 'Anulación',
    CH02: 'Anulación Check IN',
    CN03: 'Devolución',
    AV00: 'Ajuste de propina',
    CS00: 'Consulta de tarjeta',
    UT00: 'Última transacción aprobada',
    RT00: 'Reverso',
    PR00: 'Pre autorización',
    PR01: 'Confirmación de pago',
    PR05: 'Confirmación de pago AMEX',
};

/** Códigos de respuesta que el POS devuelve fuera del layout largo. */
export const CARDNET_RESPONSE_CODE_LABELS: Record<string, string> = {
    '00': 'Aprobada / operación realizada',
    '01': 'Cierre falló, intente de nuevo',
    '02': 'Lote duplicado',
    '05': 'Propina ajustada',
    '10': 'Lotes vacíos',
    '40': 'Función inválida (transacción no activa en el terminal)',
    '99': 'Transacción no progresó / rechazada',
};

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Convierte un monto a la representación de campos numéricos de CardNET:
 * sin punto decimal, dos decimales implícitos, ceros a la izquierda.
 * Ej.: 250.00 → "000000025000" (12 posiciones).
 */
export const formatAmountField = (value: number, length = 12): string => {
    const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
    const cents = Math.round(roundToTwo(amount) * 100);
    const digits = String(cents);

    if (digits.length > length) {
        throw new Error(`El monto ${amount.toFixed(2)} excede la longitud de ${length} posiciones soportada por CardNET.`);
    }

    return digits.padStart(length, '0');
};

/** Campo numérico genérico: ceros a la izquierda. */
export const formatNumericField = (value: string | number, length: number): string => {
    const raw = String(value ?? '').trim();
    const digits = raw.replace(/[^0-9]/g, '');

    if (!digits) return '0'.repeat(length);
    if (digits.length > length) return digits.slice(digits.length - length);

    return digits.padStart(length, '0');
};

/** Campo alfanumérico: justificado a la izquierda y completado con espacios. */
export const formatAlphaField = (value: string, length: number): string => {
    const raw = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ');

    if (raw.length >= length) return raw.slice(0, length);

    return raw.padEnd(length, ' ');
};

/** Separa una lista de valores con <FS> y cierra la trama con <FS>. */
export const joinFields = (values: string[]): string => `${values.join(CARDNET_FS)}${CARDNET_FS}`;

/** XOR de todos los bytes: cubre desde <STX> hasta <ETX> inclusive. */
export const computeLrc = (bytes: number[]): number => bytes.reduce((acc, byte) => acc ^ (byte & 0xff), 0) & 0xff;

/** Envuelve la trama de campos según el framing configurado. */
export const frameCardNetPayload = (payload: string, framing: CardNetEcrFraming): string => {
    if (framing === 'PLAIN') return payload;

    const body = `${String.fromCharCode(CARDNET_CONTROL.STX)}${payload}${String.fromCharCode(CARDNET_CONTROL.ETX)}`;
    if (framing === 'STX_ETX') return body;

    const bytes = Array.from(body).map(char => char.charCodeAt(0) & 0xff);
    return `${body}${String.fromCharCode(computeLrc(bytes))}`;
};

export interface CardNetEcrUnframedPayload {
    payload: string;
    hasStx: boolean;
    hasEtx: boolean;
    hasLrc: boolean;
    lrc?: number;
    lrcValid?: boolean;
    warnings: string[];
}

/**
 * Normaliza una trama recibida del terminal: quita controles de enlace
 * (EOT/EOM/ENQ/ACK) y los delimitadores STX/ETX/LRC si están presentes.
 */
export const unframeCardNetPayload = (raw: string): CardNetEcrUnframedPayload => {
    const warnings: string[] = [];
    let text = String(raw ?? '');

    // Controles de enlace que pueden llegar pegados a la trama.
    text = text.replace(/^[\x04\x05\x06\x15\x13\x11]+/, '').replace(/[\x04\x19\x05\x06]+$/, '');

    const hasStx = text.startsWith(String.fromCharCode(CARDNET_CONTROL.STX));
    const hasEtx = text.includes(String.fromCharCode(CARDNET_CONTROL.ETX));

    if (hasStx) text = text.slice(1);

    let hasLrc = false;
    let lrc: number | undefined;
    let lrcValid: boolean | undefined;

    if (hasEtx) {
        const etxIndex = text.lastIndexOf(String.fromCharCode(CARDNET_CONTROL.ETX));
        const trailer = text.slice(etxIndex + 1);
        text = text.slice(0, etxIndex);

        if (trailer.length > 0) {
            hasLrc = true;
            lrc = trailer.charCodeAt(0) & 0xff;
            const body = `${String.fromCharCode(CARDNET_CONTROL.STX)}${text}${String.fromCharCode(CARDNET_CONTROL.ETX)}`;
            const expected = computeLrc(Array.from(body).map(char => char.charCodeAt(0) & 0xff));
            lrcValid = expected === lrc;
            if (!lrcValid) {
                warnings.push(`LRC recibido ${lrc} distinto al calculado ${expected}.`);
            }
        }
    }

    return { payload: text, hasStx, hasEtx, hasLrc, lrc, lrcValid, warnings };
};

export interface CardNetEcrRequestField {
    name: string;
    length: number;
    value: string;
}

export interface CardNetEcrRequest {
    code: CardNetTransactionCode;
    label: string;
    fields: CardNetEcrRequestField[];
    /** Trama sin framing: campos unidos por <FS>, terminada en <FS>. */
    payload: string;
    warnings: string[];
}

const buildRequest = (
    code: CardNetTransactionCode,
    fields: CardNetEcrRequestField[]
): CardNetEcrRequest => ({
    code,
    label: CARDNET_TRANSACTION_LABELS[code] || code,
    fields,
    payload: joinFields(fields.map(field => field.value)),
    warnings: fields
        .filter(field => field.value.trim().length === 0)
        .map(field => `Campo "${field.name}" viaja vacío.`),
});

export interface CardNetSaleRequestInput {
    amount: number;
    itbis?: number;
    otherTaxes?: number;
    /** "Ticket de la Factura": 6 posiciones generadas por la ECR. */
    invoiceTicket: string;
    /** Solo si el terminal usa Multi-Merchant (valor 99 cierra todas las empresas). */
    multiMerchantId?: string;
    /** Cuotas para ventas diferidas (CU00). */
    deferred?: string;
    code?: 'CN00' | 'CU00' | 'PU00' | 'TP00';
    /** Teléfono para tPago (TP00). */
    phoneNumber?: string;
    /** Folio para pre autorización / hotel (PR00, CH00). */
    folio?: string;
}

/** Venta, venta diferida, lealtad, tPago y devolución comparten el mismo layout base. */
export const buildSaleRequest = (input: CardNetSaleRequestInput): CardNetEcrRequest => {
    const code = input.code || 'CN00';
    const fields: CardNetEcrRequestField[] = [
        { name: 'tipoTransaccion', length: 4, value: formatAlphaField(code, 4) },
    ];

    if (input.multiMerchantId && input.multiMerchantId.trim()) {
        fields.push({ name: 'idMultiMerchant', length: 2, value: formatNumericField(input.multiMerchantId, 2) });
    }

    fields.push(
        { name: 'montoTransaccion', length: 12, value: formatAmountField(input.amount, 12) },
        { name: 'itbis', length: 12, value: formatAmountField(input.itbis ?? 0, 12) },
        { name: 'otrosImpuestos', length: 12, value: formatAmountField(input.otherTaxes ?? 0, 12) },
        { name: 'ticketFactura', length: 6, value: formatNumericField(input.invoiceTicket, 6) }
    );

    if (code === 'TP00' && input.phoneNumber) {
        fields.push({ name: 'telefono', length: 10, value: formatNumericField(input.phoneNumber, 10) });
    }

    if (input.deferred && input.deferred.trim()) {
        fields.push({ name: 'diferido', length: 2, value: formatNumericField(input.deferred, 2) });
    }

    return buildRequest(code, fields);
};

export interface CardNetRefundRequestInput {
    amount: number;
    itbis?: number;
    otherTaxes?: number;
    invoiceTicket: string;
    multiMerchantId?: string;
}

/** Devolución (CN03). La tarjeta debe estar presente: se ejecuta tras el cierre. */
export const buildRefundRequest = (input: CardNetRefundRequestInput): CardNetEcrRequest => {
    const fields: CardNetEcrRequestField[] = [
        { name: 'tipoTransaccion', length: 4, value: formatAlphaField('CN03', 4) },
    ];

    if (input.multiMerchantId && input.multiMerchantId.trim()) {
        fields.push({ name: 'idMultiMerchant', length: 2, value: formatNumericField(input.multiMerchantId, 2) });
    }

    fields.push(
        { name: 'montoTransaccion', length: 12, value: formatAmountField(input.amount, 12) },
        { name: 'itbis', length: 12, value: formatAmountField(input.itbis ?? 0, 12) },
        { name: 'otrosImpuestos', length: 12, value: formatAmountField(input.otherTaxes ?? 0, 12) },
        { name: 'ticketFactura', length: 6, value: formatNumericField(input.invoiceTicket, 6) }
    );

    return buildRequest('CN03', fields);
};

export interface CardNetVoidRequestInput {
    /** 06 = Crédito, 08 = AMEX, 09 = Privada, 10 = Peaje, 12 = Otro. */
    host: string;
    /** "Num. De Ref." de la transacción aprobada (3 posiciones). */
    referenceNumber: string;
    /** Solo para anulación de Check IN (CH02). */
    folio?: string;
    multiMerchantId?: string;
    code?: 'CN02' | 'CH02';
}

/** Anulación de una transacción ya aprobada y aún abierta en el lote. */
export const buildVoidRequest = (input: CardNetVoidRequestInput): CardNetEcrRequest => {
    const code = input.code || 'CN02';
    const fields: CardNetEcrRequestField[] = [
        { name: 'tipoTransaccion', length: 4, value: formatAlphaField(code, 4) },
    ];

    if (input.multiMerchantId && input.multiMerchantId.trim()) {
        fields.push({ name: 'idMultiMerchant', length: 2, value: formatNumericField(input.multiMerchantId, 2) });
    }

    fields.push({ name: 'host', length: 2, value: formatNumericField(input.host, 2) });

    if (code === 'CH02') {
        fields.push({ name: 'folio', length: 8, value: formatNumericField(input.folio || '0', 8) });
    }

    fields.push({ name: 'numReferencia', length: 3, value: formatNumericField(input.referenceNumber, 3) });

    return buildRequest(code, fields);
};

export interface CardNetCloseRequestInput {
    /** 2 posiciones por empresa; "99" cierra todas las empresas del terminal. */
    multiMerchantId?: string;
}

/** Cierre de lote (CN01). El ECR debe esperar hasta 150 s por lote. */
export const buildCloseRequest = (input: CardNetCloseRequestInput = {}): CardNetEcrRequest => {
    const fields: CardNetEcrRequestField[] = [
        { name: 'tipoTransaccion', length: 4, value: formatAlphaField('CN01', 4) },
    ];

    if (input.multiMerchantId && input.multiMerchantId.trim()) {
        fields.push({ name: 'idMultiMerchant', length: 2, value: formatNumericField(input.multiMerchantId, 2) });
    }

    return buildRequest('CN01', fields);
};

export interface CardNetTipAdjustRequestInput {
    host: string;
    referenceNumber: string;
    tipAmount: number;
    multiMerchantId?: string;
}

/** Ajuste de propina (AV00). El terminal responde "05" si la ajustó. */
export const buildTipAdjustRequest = (input: CardNetTipAdjustRequestInput): CardNetEcrRequest => {
    const fields: CardNetEcrRequestField[] = [
        { name: 'tipoTransaccion', length: 4, value: formatAlphaField('AV00', 4) },
    ];

    if (input.multiMerchantId && input.multiMerchantId.trim()) {
        fields.push({ name: 'idMultiMerchant', length: 2, value: formatNumericField(input.multiMerchantId, 2) });
    }

    fields.push(
        { name: 'host', length: 2, value: formatNumericField(input.host, 2) },
        { name: 'numReferencia', length: 3, value: formatNumericField(input.referenceNumber, 3) },
        { name: 'montoPropina', length: 12, value: formatAmountField(input.tipAmount, 12) }
    );

    return buildRequest('AV00', fields);
};

/** Consulta de la última transacción aprobada (UT00). */
export const buildLastTransactionRequest = (): CardNetEcrRequest =>
    buildRequest('UT00', [{ name: 'tipoTransaccion', length: 4, value: formatAlphaField('UT00', 4) }]);

/** Consulta de tarjeta (CS00): devuelve BIN, marca y titular sin datos sensibles. */
export const buildCardInquiryRequest = (): CardNetEcrRequest =>
    buildRequest('CS00', [{ name: 'tipoTransaccion', length: 4, value: formatAlphaField('CS00', 4) }]);

export interface CardNetReverseRequestInput {
    invoiceTicket: string;
    amount: number;
    /** Formato YYYY-MM-DD (8 posiciones). */
    transactionDate: string;
    multiMerchantId?: string;
    host?: string;
    referenceNumber?: string;
}

/** Reverso solicitado por la ECR (RT00), usado solo con el parámetro "Reverso ECR" activo. */
export const buildReverseRequest = (input: CardNetReverseRequestInput): CardNetEcrRequest => {
    const fields: CardNetEcrRequestField[] = [
        { name: 'tipoTransaccion', length: 4, value: formatAlphaField('RT00', 4) },
    ];

    if (input.multiMerchantId && input.multiMerchantId.trim()) {
        fields.push({ name: 'idMultiMerchant', length: 2, value: formatNumericField(input.multiMerchantId, 2) });
    }

    fields.push(
        { name: 'ticketFactura', length: 6, value: formatNumericField(input.invoiceTicket, 6) },
        { name: 'montoFactura', length: 15, value: formatAmountField(input.amount, 15) },
        { name: 'fechaTransaccion', length: 8, value: formatAlphaField(input.transactionDate, 8) }
    );

    if (input.host && input.host.trim()) {
        fields.push({ name: 'host', length: 2, value: formatNumericField(input.host, 2) });
    }

    if (input.referenceNumber && input.referenceNumber.trim()) {
        fields.push({ name: 'numReferencia', length: 3, value: formatNumericField(input.referenceNumber, 3) });
    }

    return buildRequest('RT00', fields);
};

/** Divide una trama de campos en sus posiciones; conserva los vacíos. */
export const splitFields = (payload: string): string[] => {
    const cleaned = String(payload ?? '').replace(/[\r\n]+$/, '');
    const parts = cleaned.split(CARDNET_FS);

    // La trama termina en <FS>, lo que genera una última posición vacía.
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();

    return parts;
};

const DECLINE_PATTERN = /(RECHAZ|NEGAD|DECLIN|DENEG|INSUFIC|INVALID|VENCID|CANCEL|ERROR|NO APROB|FONDOS|LLAME)/i;

const isPureResultCode = (value: string): boolean => /^\d{2}$/.test(value);

const readResultCode = (payload: string): string => {
    const trimmed = String(payload ?? '').trim();
    const match = trimmed.match(/^(\d{2})$/);
    if (match) return match[1];

    const fields = splitFields(payload).map(field => field.trim()).filter(Boolean);
    if (fields.length === 1 && /^\d{2}$/.test(fields[0])) return fields[0];

    return '';
};

export interface CardNetDccInfo {
    accepted: string;
    marginPercentage: string;
    transactionAmount: string;
    displayRate: string;
    currencySymbol: string;
}

export interface CardNetPromonetInfo {
    program: string;
    pointsName: string;
    message: string;
    qrCode: string;
}

export interface CardNetSaleResponse {
    host: string;
    cardBrand: string;
    entryMode: string;
    maskedPan: string;
    batchNumber: string;
    date: string;
    time: string;
    cardHolderName: string;
    authorizationCode: string;
    terminalId: string;
    sequenceNumber: string;
    referenceNumber: string;
    merchantId: string;
    deferred: string;
    tidMarca: string;
    aid: string;
    saleIndicator: string;
    productType: string;
    reserved: string;
    signatureFile: string;
    signatureIndicator: string;
    responseMessage: string;
    signature: string;
    expiry: string;
    voucherMode: string;
    emvLevel: string;
    qpsLimit: string;
    pinType: string;
    tipAmount: string;
    dcc?: CardNetDccInfo;
    promonet?: CardNetPromonetInfo;
    moniPayment: boolean;
    quickPayment: boolean;
    deferredInstallments: string;
}

export interface CardNetCloseRecord {
    result: string;
    host: string;
    merchantId: string;
    terminalId: string;
    batchNumber: string;
    closeDate: string;
    closeTime: string;
    refundCount: string;
    refundAmount: string;
    refundItbis: string;
    saleCount: string;
    closeTotal: string;
    closeItbis: string;
    closeOtherTaxes: string;
}

export interface CardNetCardInquiryResponse {
    host: string;
    cardBrand: string;
    entryMode: string;
    bin: string;
    serviceCode: string;
    cardHolderName: string;
}

export interface CardNetParsedResponse {
    /** Código de transacción solicitado (o UNKNOWN si la trama no se reconoce). */
    code: CardNetTransactionCode | 'UNKNOWN';
    approved: boolean;
    responseCode: string;
    responseMessage: string;
    /** Campos nombrados según el layout detectado. */
    fields: Record<string, string>;
    /** Posiciones crudas tal como llegaron, para diagnóstico. */
    rawFields: string[];
    /** Registros de cierre (uno por HOST). */
    records: CardNetCloseRecord[];
    sale?: CardNetSaleResponse;
    inquiry?: CardNetCardInquiryResponse;
    warnings: string[];
    lrcValid?: boolean;
}

const EMPTY_SALE: CardNetSaleResponse = {
    host: '',
    cardBrand: '',
    entryMode: '',
    maskedPan: '',
    batchNumber: '',
    date: '',
    time: '',
    cardHolderName: '',
    authorizationCode: '',
    terminalId: '',
    sequenceNumber: '',
    referenceNumber: '',
    merchantId: '',
    deferred: '',
    tidMarca: '',
    aid: '',
    saleIndicator: '',
    productType: '',
    reserved: '',
    signatureFile: '',
    signatureIndicator: '',
    responseMessage: '',
    signature: '',
    expiry: '',
    voucherMode: '',
    emvLevel: '',
    qpsLimit: '',
    pinType: '',
    tipAmount: '',
    moniPayment: false,
    quickPayment: false,
    deferredInstallments: '',
};

const pick = (fields: string[], index: number): string => String(fields[index] ?? '').trim();

const SIGNATURE_FILE_PATTERN = /\.(bmp|jpg|jpeg|png|sig)$/i;

/**
 * Parsea la respuesta de una transacción de venta / devolución / última transacción.
 *
 * Las primeras 16 posiciones son estables (HOST … AID). A partir de ahí el POS
 * agrega los bloques de MONI/DCC/Promonet/propina y, opcionalmente, los
 * "Campos Especiales". Cuando el terminal no envía los campos especiales o
 * agrega posiciones de relleno, el parseo degrada a best-effort y deja avisos
 * en `warnings` en lugar de fallar: la trama cruda queda en `rawFields`.
 */
export const parseSaleResponse = (payload: string): CardNetParsedResponse => {
    const rawFields = splitFields(payload);
    const warnings: string[] = [];
    const sale: CardNetSaleResponse = { ...EMPTY_SALE };

    if (rawFields.length < 13) {
        warnings.push(`La respuesta de venta llegó con ${rawFields.length} posiciones; se esperaban al menos 13.`);
    }

    sale.host = pick(rawFields, 0);
    sale.cardBrand = pick(rawFields, 1);
    sale.entryMode = pick(rawFields, 2);
    sale.maskedPan = pick(rawFields, 3);
    sale.batchNumber = pick(rawFields, 4);
    sale.date = pick(rawFields, 5);
    sale.time = pick(rawFields, 6);
    sale.cardHolderName = pick(rawFields, 7);
    sale.authorizationCode = pick(rawFields, 8);
    sale.terminalId = pick(rawFields, 9);
    sale.sequenceNumber = pick(rawFields, 10);
    sale.referenceNumber = pick(rawFields, 11);
    sale.merchantId = pick(rawFields, 12);
    sale.deferred = pick(rawFields, 13);
    sale.tidMarca = pick(rawFields, 14);
    sale.aid = pick(rawFields, 15);

    const tail = rawFields.slice(16).map(field => String(field ?? ''));

    // --- Campos Especiales (8 posiciones finales, sección "Estructura de los Campos") ---
    let specials: string[] | null = null;
    let body = tail;

    if (tail.length >= 8) {
        const candidate = tail.slice(tail.length - 8);
        const [sigFlag, message, signature, expiry] = candidate;
        const looksSpecial = /^\d{2}\/\d{2}$/.test((expiry || '').trim())
            || /^[01]$/.test((signature || '').trim())
            || /^(APROBAD|RECHAZ|DECLIN|FONDOS|NEGAD|INVALID|TRANSAC|CANCEL)/i.test((message || '').trim())
            || /^[SN]$/.test((sigFlag || '').trim());

        if (looksSpecial) {
            specials = candidate;
            body = tail.slice(0, tail.length - 8);
        } else {
            warnings.push('No se detectaron Campos Especiales al final de la trama.');
        }
    }

    // Quita posiciones de relleno vacías al final del cuerpo.
    while (body.length > 0 && String(body[body.length - 1] ?? '').trim() === '') body.pop();

    // --- Bloque variable: MONI / DCC / Promonet / propina ---
    const signatureFileIndex = body.findIndex(field => SIGNATURE_FILE_PATTERN.test(field.trim()));
    const signatureFile = signatureFileIndex >= 0 ? body[signatureFileIndex].trim() : '';
    const bodyWithoutSignature = signatureFileIndex >= 0
        ? body.filter((_, index) => index !== signatureFileIndex)
        : body;

    // "Indicador de Venta" solo existe desde la v2.2 con el parámetro de campos nuevos
    // activo en el terminal: si la primera posición no es un indicador conocido, el
    // terminal está en el layout antiguo y solo se conservan las posiciones crudas.
    const indicatorCandidate = pick(bodyWithoutSignature, 0).toUpperCase();
    const hasSaleIndicator = ['', '00', 'BE', 'DC', 'PR', 'PM'].includes(indicatorCandidate);
    const saleIndicator = hasSaleIndicator ? indicatorCandidate : '';
    const offset = hasSaleIndicator ? 1 : 0;
    const at = (index: number): string => pick(bodyWithoutSignature, index + offset);

    sale.saleIndicator = saleIndicator;

    if (!hasSaleIndicator) {
        sale.productType = '';
        sale.reserved = '';
        if (bodyWithoutSignature.some(field => field.trim())) {
            warnings.push('La trama no trae Indicador de Venta (terminal en layout 2.2 o anterior); el bloque posterior al AID queda solo en rawFields.');
        }
    } else if (saleIndicator === 'PR' || saleIndicator === 'PM') {
        // Tras el reservado llegan Archivo de firma, Mensaje y QR; el archivo puede
        // venir vacío, así que se toman el primer y el último valor no vacíos.
        const promoTail = bodyWithoutSignature
            .slice(4 + offset)
            .map(field => field.trim())
            .filter(Boolean);

        sale.promonet = {
            program: at(0),
            pointsName: at(1),
            message: promoTail[0] || '',
            qrCode: promoTail.length > 1 ? promoTail[promoTail.length - 1] : '',
        };
        sale.productType = at(2);
        sale.reserved = at(3);
        sale.moniPayment = saleIndicator === 'PM';
    } else if (saleIndicator === 'DC') {
        sale.dcc = {
            accepted: at(0).toUpperCase(),
            marginPercentage: at(1),
            transactionAmount: at(2),
            displayRate: at(3),
            currencySymbol: at(4),
        };
        sale.productType = at(5);

        const possibleTip = at(6);
        if (/^\d{1,12}$/.test(possibleTip) && possibleTip.length > 2) {
            sale.tipAmount = possibleTip;
            sale.reserved = at(7);
        } else {
            sale.reserved = possibleTip;
        }
    } else {
        sale.moniPayment = saleIndicator === 'BE';

        const first = at(0);
        const second = at(1);

        // Con propina sugerida el layout inserta "Propina Sugerida" (12) antes del producto.
        if (/^\d{1,12}$/.test(first) && first.length > 2 && /^[A-Z]{2}$/i.test(second || '')) {
            sale.tipAmount = first;
            sale.productType = second;
            sale.reserved = at(2);
        } else {
            sale.productType = first;
            sale.reserved = second;
        }
    }

    sale.signatureFile = signatureFile;
    sale.quickPayment = sale.deferred.toUpperCase().startsWith('Q');

    const installments = sale.deferred.toUpperCase().match(/^CU(\d{1,2})$/);
    if (installments) sale.deferredInstallments = installments[1];

    if (specials) {
        sale.signatureIndicator = (specials[0] || '').trim();
        sale.responseMessage = (specials[1] || '').trim();
        sale.signature = (specials[2] || '').trim();
        sale.expiry = (specials[3] || '').trim();
        sale.voucherMode = (specials[4] || '').trim();
        sale.emvLevel = (specials[5] || '').trim();
        sale.qpsLimit = (specials[6] || '').trim();
        sale.pinType = (specials[7] || '').trim();
    } else {
        sale.signatureIndicator = '';
        sale.responseMessage = '';
    }

    const approved = Boolean(sale.authorizationCode)
        && !/^0+$/.test(sale.authorizationCode)
        && !DECLINE_PATTERN.test(sale.responseMessage);

    if (!approved && !sale.responseMessage) {
        warnings.push('La trama no trae mensaje de respuesta (Campos Especiales desactivados en el terminal).');
    }

    const fields: Record<string, string> = {
        host: sale.host,
        cardBrand: sale.cardBrand,
        entryMode: sale.entryMode,
        maskedPan: sale.maskedPan,
        batchNumber: sale.batchNumber,
        date: sale.date,
        time: sale.time,
        cardHolderName: sale.cardHolderName,
        authorizationCode: sale.authorizationCode,
        terminalId: sale.terminalId,
        sequenceNumber: sale.sequenceNumber,
        referenceNumber: sale.referenceNumber,
        merchantId: sale.merchantId,
        deferred: sale.deferred,
        tidMarca: sale.tidMarca,
        aid: sale.aid,
        saleIndicator: sale.saleIndicator,
        productType: sale.productType,
        reserved: sale.reserved,
        signatureFile: sale.signatureFile,
        responseMessage: sale.responseMessage,
        voucherMode: sale.voucherMode,
        emvLevel: sale.emvLevel,
        qpsLimit: sale.qpsLimit,
        pinType: sale.pinType,
        tipAmount: sale.tipAmount,
    };

    if (sale.dcc) {
        fields.dccAccepted = sale.dcc.accepted;
        fields.dccMargin = sale.dcc.marginPercentage;
        fields.dccAmount = sale.dcc.transactionAmount;
        fields.dccRate = sale.dcc.displayRate;
        fields.dccCurrency = sale.dcc.currencySymbol;
    }

    if (sale.promonet) {
        fields.promonetProgram = sale.promonet.program;
        fields.promonetPoints = sale.promonet.pointsName;
        fields.promonetMessage = sale.promonet.message;
    }

    return {
        code: 'CN00',
        approved,
        responseCode: approved ? '00' : '99',
        responseMessage: sale.responseMessage || (approved ? 'APROBADA' : 'TRANSACCION NO PROGRESO'),
        fields,
        rawFields,
        records: [],
        sale,
        warnings,
    };
};

const closeRecord = (fields: string[]): CardNetCloseRecord => ({
    result: pick(fields, 0),
    host: pick(fields, 1),
    merchantId: pick(fields, 2),
    terminalId: pick(fields, 3),
    batchNumber: pick(fields, 4),
    closeDate: pick(fields, 5),
    closeTime: pick(fields, 6),
    refundCount: pick(fields, 7),
    refundAmount: pick(fields, 8),
    refundItbis: pick(fields, 9),
    saleCount: pick(fields, 10),
    closeTotal: pick(fields, 11),
    closeItbis: pick(fields, 12),
    closeOtherTaxes: pick(fields, 13),
});

const CLOSE_RECORD_SIZE = 14;
const CLOSE_AUTOCLOSE_SIZE = 3;

/** Parsea la respuesta del cierre (CN01): un registro por HOST o modalidad automática. */
export const parseCloseResponse = (payload: string): CardNetParsedResponse => {
    const rawFields = splitFields(payload);
    const warnings: string[] = [];
    const records: CardNetCloseRecord[] = [];

    if (rawFields.length === 1 && rawFields[0].trim() === '10') {
        return {
            code: 'CN01',
            approved: true,
            responseCode: '10',
            responseMessage: CARDNET_RESPONSE_CODE_LABELS['10'],
            fields: { result: '10' },
            rawFields,
            records,
            warnings,
        };
    }

    if (rawFields.length % CLOSE_RECORD_SIZE === 0) {
        for (let index = 0; index < rawFields.length; index += CLOSE_RECORD_SIZE) {
            records.push(closeRecord(rawFields.slice(index, index + CLOSE_RECORD_SIZE)));
        }
    } else if (rawFields.length % CLOSE_AUTOCLOSE_SIZE === 0) {
        for (let index = 0; index < rawFields.length; index += CLOSE_AUTOCLOSE_SIZE) {
            const chunk = rawFields.slice(index, index + CLOSE_AUTOCLOSE_SIZE);
            records.push({
                ...closeRecord([]),
                result: pick(chunk, 0),
                host: pick(chunk, 1),
                batchNumber: pick(chunk, 2),
            });
        }
        warnings.push('Cierre en modalidad automática: la trama trae solo Resultado, HOST y Lote.');
    } else {
        records.push(closeRecord(rawFields));
        warnings.push(
            `La trama de cierre trae ${rawFields.length} posiciones y no coincide con un múltiplo de ${CLOSE_RECORD_SIZE}; se interpretó como un único registro.`
        );
    }

    const failedRecord = records.find(record => record.result && record.result !== '00');
    const approved = records.length > 0 && !failedRecord;
    const responseCode = failedRecord?.result || (records[0]?.result ?? '');

    return {
        code: 'CN01',
        approved,
        responseCode: responseCode || (approved ? '00' : '99'),
        responseMessage: CARDNET_RESPONSE_CODE_LABELS[responseCode || ''] || (approved ? 'Cierre exitoso' : 'Cierre fallido'),
        fields: records[0] ? ({ ...records[0] } as unknown as Record<string, string>) : {},
        rawFields,
        records,
        warnings,
    };
};

/** Parsea respuestas cortas: anulación (00), propina (05), rechazos (40/99). */
const parseShortResponse = (
    code: CardNetTransactionCode,
    payload: string
): CardNetParsedResponse => {
    const resultCode = readResultCode(payload);
    const approved = resultCode === '00' || resultCode === '05';

    return {
        code,
        approved,
        responseCode: resultCode || '99',
        responseMessage: CARDNET_RESPONSE_CODE_LABELS[resultCode || ''] || 'Respuesta no reconocida del terminal',
        fields: resultCode ? { result: resultCode } : {},
        rawFields: splitFields(payload),
        records: [],
        warnings: resultCode ? [] : ['La respuesta corta no trajo un código de resultado de 2 dígitos.'],
    };
};

/** Parsea la respuesta de consulta de tarjeta (CS00). */
export const parseCardInquiryResponse = (payload: string): CardNetParsedResponse => {
    const rawFields = splitFields(payload);
    const inquiry: CardNetCardInquiryResponse = {
        host: pick(rawFields, 0),
        cardBrand: pick(rawFields, 1),
        entryMode: pick(rawFields, 2),
        bin: pick(rawFields, 3),
        serviceCode: pick(rawFields, 4),
        cardHolderName: pick(rawFields, 5),
    };

    const approved = Boolean(inquiry.bin);
    const resultCode = readResultCode(payload);

    return {
        code: 'CS00',
        approved: resultCode ? resultCode === '00' : approved,
        responseCode: resultCode || (approved ? '00' : '99'),
        responseMessage: approved ? 'Tarjeta leída' : (CARDNET_RESPONSE_CODE_LABELS[resultCode] || 'No se pudo leer la tarjeta'),
        fields: { ...inquiry },
        rawFields,
        records: [],
        inquiry,
        warnings: [],
    };
};

/**
 * Punto de entrada: interpreta la trama según el código de transacción enviado.
 * Tolera que el terminal responda con un código corto (40, 99, 10) en cualquier tipo.
 */
export const parseCardNetResponse = (
    code: CardNetTransactionCode,
    rawPayload: string
): CardNetParsedResponse => {
    const unframed = unframeCardNetPayload(rawPayload);
    const payload = unframed.payload;
    const shortCode = readResultCode(payload);
    const warnings = [...unframed.warnings];
    const lrcValid = unframed.lrcValid;

    // El cierre siempre trae su propio layout: "10" (lotes vacíos) NO es un rechazo.
    if (code === 'CN01') {
        const closeParsed = parseCloseResponse(payload);
        return {
            ...closeParsed,
            warnings: [...warnings, ...closeParsed.warnings],
            lrcValid,
        };
    }

    if (shortCode && shortCode !== '00' && shortCode !== '05') {
        const short = parseShortResponse(code, payload);
        return { ...short, warnings: [...warnings, ...short.warnings], lrcValid };
    }

    let parsed: CardNetParsedResponse;

    switch (code) {
        case 'CN02':
        case 'CH02':
        case 'AV00':
        case 'RT00':
            parsed = parseShortResponse(code, payload);
            break;
        case 'CS00':
            parsed = parseCardInquiryResponse(payload);
            break;
        default:
            parsed = parseSaleResponse(payload);
            parsed.code = code;
            break;
    }

    return {
        ...parsed,
        warnings: [...warnings, ...parsed.warnings],
        lrcValid,
    };
};
