import { EXPECTED_ERP_SUPABASE_PROJECT_REF } from './erpBaseUrl';

/**
 * Contrato puro del canal de sincronización del ERP (Alfa-RMS).
 *
 * Sin red, sin `localStorage` y sin React: aquí sólo se interpreta lo que publica el ERP
 * (`GET /version`, `GET /health`), se decide el transporte del `/inbox` y se traducen sus
 * errores a mensajes de operador accionables.
 */

const asRecord = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
);

const pickStrictTrue = (...values: unknown[]): boolean => values.some((value) => value === true);

export interface ErpVersionCapabilities {
    commit: string | null;
    buildTime: string | null;
    /** `capabilities.supports_batch_inbox` (o su alias camelCase). */
    supportsBatchInbox: boolean;
    limits: { maxEvents?: number; maxTransactions?: number; maxPayloadBytes?: number } | null;
}

/**
 * Interpreta `GET /version`.
 *
 * `supports_batch_inbox` ausente, `false` o de tipo inesperado => **no** hay lote: nunca se
 * asume lote por el host. Alfa-RMS lo tiene apagado (`POST /inbox/batch` responde 404
 * `SYNC_BATCH_INBOX_DISABLED`).
 */
export const readErpVersionCapabilities = (payload: unknown): ErpVersionCapabilities => {
    const root = asRecord(payload);
    const capabilities = asRecord(root.capabilities);
    const limits = asRecord(capabilities.limits || root.limits);

    const readNumber = (...values: unknown[]): number | undefined => {
        for (const value of values) {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return undefined;
    };

    const maxEvents = readNumber(limits.max_events, limits.maxEvents, capabilities.max_batch_events);
    const maxTransactions = readNumber(limits.max_transactions, limits.maxTransactions);
    const maxPayloadBytes = readNumber(limits.max_payload_bytes, limits.maxPayloadBytes, limits.max_bytes);

    return {
        commit: String(root.commit || root.git_commit || root.build_commit || '').trim() || null,
        buildTime: String(root.buildTime || root.build_time || '').trim() || null,
        supportsBatchInbox: pickStrictTrue(
            capabilities.supports_batch_inbox,
            capabilities.supportsBatchInbox,
            root.supports_batch_inbox,
            root.supportsBatchInbox,
        ),
        limits: (maxEvents || maxTransactions || maxPayloadBytes)
            ? { maxEvents, maxTransactions, maxPayloadBytes }
            : null,
    };
};

/** `projectRef` de `GET /health` (identidad del proyecto Supabase del ERP). */
export const readErpProjectRef = (payload: unknown): string | null => {
    const root = asRecord(payload);
    return String(
        root.projectRef || root.project_ref || root.supabase_project_ref || '',
    ).trim() || null;
};

export const isExpectedErpProjectRef = (projectRef?: string | null): boolean => (
    String(projectRef || '').trim().toLowerCase() === EXPECTED_ERP_SUPABASE_PROJECT_REF
);

/**
 * Evento del `/inbox` del ERP a partir de un evento durable del POS.
 *
 * El lote (`/inbox/batch`) viaja con las claves del outbox durable (`eventId`, `eventType`,
 * `payload`), pero el endpoint de **un solo evento** usa el contrato del ERP:
 * `{ event_id, event_type, payload }`. Este mapeo es el que permite seguir operando cuando
 * el ERP no soporta lote.
 */
export const toErpInboxEvent = (event: Record<string, unknown>): {
    event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
} => {
    const record = asRecord(event);
    const eventId = String(record.eventId || record.event_id || '').trim();
    const eventType = String(record.eventType || record.event_type || '').trim().toUpperCase();

    return {
        event_id: eventId,
        event_type: eventType,
        payload: asRecord(record.payload),
    };
};

export type ErpSyncErrorKind =
    | 'TERMINAL_NOT_BOUND'
    | 'TOKEN_MISSING'
    | 'DEVICE_SUPERSEDED'
    | 'MASTERS_PULL_FORBIDDEN'
    | 'BATCH_INBOX_DISABLED'
    | 'LICENSE_EXCEEDED'
    | 'ROUTE_NOT_PUBLISHED'
    | 'RATE_LIMITED'
    | 'BUSINESS_REJECTED'
    | 'NETWORK'
    | 'SERVER'
    | 'UNKNOWN';

export interface ErpSyncErrorDescription {
    kind: ErpSyncErrorKind;
    code: string | null;
    httpStatus: number | null;
    title: string;
    operatorMessage: string;
    action: string;
    /** `true` si es un estado terminal hasta que el operador actue. */
    terminal: boolean;
    retryable: boolean;
}

const DESCRIPTIONS: Record<ErpSyncErrorKind, Omit<ErpSyncErrorDescription, 'kind' | 'code' | 'httpStatus'>> = {
    TERMINAL_NOT_BOUND: {
        title: 'Terminal no vinculada a este ERP',
        operatorMessage: 'Esta caja no existe todavia en el ERP al que apunta el POS (Alfa-RMS).',
        action: 'Re-vincular la terminal cuando el ERP confirme la migración de datos.',
        terminal: true,
        retryable: false,
    },
    TOKEN_MISSING: {
        title: 'Token de sincronización inválido',
        operatorMessage: 'El ERP rechazó el token de esta terminal: falta o ya no es válido.',
        action: 'Re-vincular la terminal para regenerar el token.',
        terminal: true,
        retryable: false,
    },
    DEVICE_SUPERSEDED: {
        title: 'La terminal fue tomada por otro equipo',
        operatorMessage: 'El ERP autorizó otro dispositivo para esta terminal.',
        action: 'Re-vincular esta caja (registrar la terminal y autenticar) antes de vender.',
        terminal: true,
        retryable: false,
    },
    MASTERS_PULL_FORBIDDEN: {
        title: 'Terminal sin permiso de maestros',
        operatorMessage: 'Esta terminal no tiene permitido descargar maestros del ERP.',
        action: 'Reactivar la terminal en el ERP o actualizar el POS.',
        terminal: true,
        retryable: false,
    },
    BATCH_INBOX_DISABLED: {
        title: 'Envío por lote deshabilitado en el ERP',
        operatorMessage: 'El ERP no acepta envío por lote de eventos.',
        action: 'Sin acción: el POS envía los eventos uno por uno por /inbox.',
        terminal: false,
        retryable: true,
    },
    LICENSE_EXCEEDED: {
        title: 'Licencia inactiva o límite excedido',
        operatorMessage: 'El ERP rechazó la operación por licencia inactiva o exceso de terminales.',
        action: 'Contactar al administrador para reactivar la licencia.',
        terminal: true,
        retryable: false,
    },
    ROUTE_NOT_PUBLISHED: {
        title: 'Función no publicada en este ERP',
        operatorMessage: 'La ruta solicitada todavía no está publicada en el ERP.',
        action: 'Ninguna en caja: la función queda deshabilitada hasta que el ERP la publique.',
        terminal: false,
        retryable: false,
    },
    RATE_LIMITED: {
        title: 'El ERP limitó las peticiones',
        operatorMessage: 'El ERP respondió 429 (rate limit): la petición es válida pero llegó demasiadas veces.',
        action: 'Sin acción: el POS reintenta solo con backoff.',
        terminal: false,
        retryable: true,
    },
    BUSINESS_REJECTED: {
        title: 'El ERP rechazo la operacion',
        operatorMessage: 'El ERP rechazó la operación por una regla de negocio.',
        action: 'Corregir el dato indicado: reintentar sin cambios dará el mismo resultado.',
        terminal: false,
        retryable: false,
    },
    NETWORK: {
        title: 'Sin conexión con el ERP',
        operatorMessage: 'No se pudo alcanzar el ERP; la venta continúa localmente.',
        action: 'Verificar la conexión; el POS reintenta en segundo plano.',
        terminal: false,
        retryable: true,
    },
    SERVER: {
        title: 'Error del ERP',
        operatorMessage: 'El ERP respondió con un error interno.',
        action: 'Reintentar en unos minutos; si persiste, reportar al equipo ERP.',
        terminal: false,
        retryable: true,
    },
    UNKNOWN: {
        title: 'Fallo de sincronización',
        operatorMessage: 'La sincronización con el ERP falló.',
        action: 'Revisar el detalle en el diagnóstico antes de reintentar.',
        terminal: false,
        retryable: true,
    },
};

const ERP_BUSINESS_ERROR_CODES = [
    'CUSTOMER_NOT_FOUND',
    'INSUFFICIENT_LOYALTY_BALANCE',
    'CUSTOMER_ID_REQUIRED',
    'INVALID_POINTS',
    'DOCUMENT_ID_REQUIRED',
];

/**
 * Traduce una respuesta/fallo del ERP a un estado accionable.
 *
 * Cubre lo que el ERP devuelve cuando la caja aún no está migrada o la función no está
 * publicada: `SYNC_TERMINAL_NOT_FOUND`, `SYNC_TOKEN_MISSING`, `Invalid or missing sync
 * token`, `DEVICE_SUPERSEDED`, `PULL_MASTERS_NOT_ALLOWED`, `SYNC_BATCH_INBOX_DISABLED`,
 * `LICENSE_EXCEEDED_INACTIVE`, 429 y el 404 de ruta sync.
 */
export const mapErpSyncError = (params: {
    httpStatus?: number | null;
    payload?: unknown;
    networkMessage?: string | null;
}): ErpSyncErrorDescription => {
    const httpStatus = Number.isFinite(Number(params.httpStatus)) ? Number(params.httpStatus) : null;
    const payload = asRecord(params.payload);
    const code = String(payload.code || payload.error_code || '').trim();
    const haystack = `${code} ${String(payload.message || '')} ${String(payload.details || '')}`.toUpperCase();

    const build = (kind: ErpSyncErrorKind, resolvedCode: string | null): ErpSyncErrorDescription => ({
        kind,
        code: resolvedCode,
        httpStatus,
        ...DESCRIPTIONS[kind],
    });

    if (haystack.includes('SYNC_TERMINAL_NOT_FOUND')) return build('TERMINAL_NOT_BOUND', code || 'SYNC_TERMINAL_NOT_FOUND');
    if (haystack.includes('SYNC_TOKEN_MISSING') || haystack.includes('INVALID OR MISSING SYNC TOKEN')) {
        return build('TOKEN_MISSING', code || 'SYNC_TOKEN_MISSING');
    }
    if (haystack.includes('DEVICE_SUPERSEDED') || haystack.includes('TERMINAL_WITHOUT_TENANT')) {
        return build('DEVICE_SUPERSEDED', code || 'DEVICE_SUPERSEDED');
    }
    if (haystack.includes('PULL_MASTERS_NOT_ALLOWED')) return build('MASTERS_PULL_FORBIDDEN', code || 'PULL_MASTERS_NOT_ALLOWED');
    if (haystack.includes('SYNC_BATCH_INBOX_DISABLED')) return build('BATCH_INBOX_DISABLED', code || 'SYNC_BATCH_INBOX_DISABLED');
    if (haystack.includes('LICENSE_EXCEEDED')) return build('LICENSE_EXCEEDED', code || 'LICENSE_EXCEEDED_INACTIVE');
    if (haystack.includes('TERMINAL_CONTEXT_REQUIRED')) return build('TOKEN_MISSING', code || 'TERMINAL_CONTEXT_REQUIRED');
    if (httpStatus === 429 || haystack.includes('RATE_LIMITED')) return build('RATE_LIMITED', code || null);
    if (ERP_BUSINESS_ERROR_CODES.some((businessCode) => haystack.includes(businessCode))) {
        return build('BUSINESS_REJECTED', code || null);
    }
    if (httpStatus === 404) return build('ROUTE_NOT_PUBLISHED', code || null);
    if (httpStatus === 401 || httpStatus === 403) return build('TOKEN_MISSING', code || null);
    if (httpStatus !== null && httpStatus >= 500) return build('SERVER', code || null);
    if (httpStatus !== null && httpStatus >= 400) return build('BUSINESS_REJECTED', code || null);
    if (params.networkMessage) return build('NETWORK', null);

    return build('UNKNOWN', code || null);
};

/** `true` si el estado exige que una persona re-vincule o reactive la terminal. */
export const isTerminalBindingError = (description: ErpSyncErrorDescription | null | undefined): boolean => (
    Boolean(description && description.terminal)
);
