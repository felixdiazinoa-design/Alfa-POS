import { v5 as uuidv5 } from 'uuid';
import { postErpSyncJson } from '../../utils/erpSyncLifecycle';
import {
    getLoyaltyChannelAvailability,
    isErpLoyaltyChannelFlagEnabled,
    markErpRouteAvailable,
    markErpRouteUnavailable,
} from '../../utils/erpDiagnostics';
import { isRouteNotPublishedError, isTerminalBindingError } from '../../utils/erpSyncContract';
import { isErpSyncRequestError } from '../../utils/erpSyncTransport';
import {
    enqueueLoyaltyOperation,
    listLoyaltyOutbox,
    markLoyaltyOperationFailed,
    markLoyaltyOperationSynced,
    processLoyaltyOutbox,
    type LoyaltyOutboxItem,
    type ProcessOutboxResult,
    type SendOutcome,
} from '../../utils/loyaltyOutbox';
import type { LoyaltyMarketingChannel } from '../../constants/egoClubLegal';

/** Se reexporta para que la UI consuma todo el contrato desde un solo módulo. */
export type { LoyaltyMarketingChannel };

/**
 * Cliente de fidelización EGO Club contra el canal de sincronización del ERP.
 *
 * El ERP es la única fuente de verdad: aquí no se calculan saldos ni niveles, sólo se
 * envían operaciones y se guarda lo que el ERP responde.
 *
 * Canal: `POST {ERP}/api/sync/loyalty/*` con el contexto de terminal (ver
 * `postErpSyncJson`). Los endpoints `/api/settings/crm/loyalty/*` exigen RBAC
 * (`x-role-id`) y no se usan desde el POS a propósito.
 *
 * ⚠️ `enroll`, `redeem` y `apply-sale-document` **todavía no están publicados** en
 * Alfa-RMS (404 de ruta sync). Por eso todo el canal está detrás de la bandera
 * `ERP_SUPPORTS_LOYALTY_CHANNEL` (default `false`):
 *
 * - `false`: no se llama ninguno de los tres; la UI degrada ("no disponible en esta
 *   caja") y la lealtad se sigue acumulando por el evento de venta en `/inbox`, que es
 *   donde el ERP la aplica.
 * - `true`: llamadas normales. Un 404 de ruta o un 403 `LICENSE_EXCEEDED_INACTIVE` se
 *   tratan como capacidad ausente (no como excepción): se degrada y se registra en el
 *   diagnóstico.
 */

/** Ruta base del canal de lealtad (para el estado de capacidad). */
export const LOYALTY_CHANNEL_ROUTE = '/loyalty';

/** Estado del canal de lealtad en esta caja (bandera + rutas publicadas). */
export const getLoyaltyChannelStatus = (route: string = LOYALTY_CHANNEL_ROUTE): {
    enabled: boolean;
    reason: string | null;
} => getLoyaltyChannelAvailability(route);

/** `true` si el POS puede llamar al canal de lealtad del ERP. */
export const isLoyaltyChannelAvailable = (route: string = LOYALTY_CHANNEL_ROUTE): boolean => (
    getLoyaltyChannelAvailability(route).enabled
);

/** Motivo accionable cuando el canal no está disponible (para mostrar en la UI). */
export const getLoyaltyChannelUnavailableMessage = (route: string = LOYALTY_CHANNEL_ROUTE): string => (
    getLoyaltyChannelAvailability(route).reason
    || 'No disponible en esta caja: el ERP no publica el canal de lealtad.'
);

/**
 * Convierte un fallo del canal de lealtad en un estado manejado.
 *
 * Un 404 de ruta sync **no** es un error de negocio: se marca la ruta como no publicada
 * (queda visible en el diagnóstico) y se degrada sin reintentar en bucle. Los estados
 * terminales de vinculación tampoco se reintentan: exigen que el operador re-vincule.
 */
const classifyLoyaltyFailure = (
    error: unknown,
    path: string,
): { error: string; unavailable: boolean } => {
    if (isErpSyncRequestError(error)) {
        const description = error.description;

        if (isRouteNotPublishedError(description)) {
            markErpRouteUnavailable(path, description.code);
            return {
                error: `No disponible en esta caja: el ERP todavía no publica ${path}.`,
                unavailable: true,
            };
        }

        if (isTerminalBindingError(description)) {
            return {
                error: `${description.title}: ${description.operatorMessage} Acción: ${description.action}`,
                unavailable: true,
            };
        }

        return { error: error.message || description.operatorMessage, unavailable: false };
    }

    return { error: String((error as any)?.message || 'Error de red'), unavailable: false };
};


/** Namespace propio para derivar claves estables (idempotencia del lado del POS). */
const EGO_CLUB_NAMESPACE = 'd2c5f5b0-7d59-4b9a-9b2e-5f0a8e1c4c11';

export type LoyaltyConsentType = 'TERMS' | 'PRIVACY' | LoyaltyMarketingChannel;

export interface LoyaltyConsent {
    type: LoyaltyConsentType;
    granted: boolean;
}

export interface LoyaltyEnrollInput {
    nombre: string;
    cedula: string;
    celular: string;
    email: string;
    birthDate: string;
    registrationStoreId: string;
    consents: LoyaltyConsent[];
}

/** Sólo dígitos: la cédula se valida y se envía sin guiones ni espacios. */
export const normalizeCedula = (value: string): string => String(value || '').replace(/\D/g, '');

/** Sólo dígitos y sin el código de país: `+1 (809) 555-0101` → `8095550101`. */
export const normalizePhone = (value: string): string => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
};

export const isValidCedula = (value: string): boolean => normalizeCedula(value).length === 11;

export const isValidPhone = (value: string): boolean => {
    const digits = normalizePhone(value);
    return digits.length === 10;
};

export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());

/**
 * Convierte una fecha de referencia a fecha local.
 *
 * `new Date('2026-06-01')` se interpreta como medianoche **UTC**, que en RD (UTC-4) cae
 * el día anterior; eso corrompería el cálculo de edad justo en el cumpleaños. Las fechas
 * sin hora se construyen por componentes para quedarse en horario local.
 */
const toLocalDate = (value: Date | string): Date => {
    if (value instanceof Date) return value;
    const raw = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    return new Date(raw);
};

/**
 * Edad cumplida a una fecha de referencia.
 * Devuelve `null` si la fecha no es válida o es futura.
 */
export const calculateAge = (birthDate: string, reference: Date | string = new Date()): number | null => {
    const raw = String(birthDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

    const [year, month, day] = raw.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day
    ) return null;

    const ref = toLocalDate(reference);
    if (parsed > ref) return null;

    let age = ref.getFullYear() - year;
    const hadBirthday = ref.getMonth() > month - 1
        || (ref.getMonth() === month - 1 && ref.getDate() >= day);
    if (!hadBirthday) age -= 1;

    return age;
};

export const isAdult = (birthDate: string, reference: Date | string = new Date()): boolean => {
    const age = calculateAge(birthDate, reference);
    return age !== null && age >= 18;
};

/** Cédula normalizada como clave estable: reintentar el alta no duplica al socio. */
export const buildEnrollOperationId = (cedula: string): string => (
    `enroll:${uuidv5(`ego-club:enroll:${normalizeCedula(cedula)}`, EGO_CLUB_NAMESPACE)}`
);

/** El id del documento de venta local ya es único: reintentar el devengo es seguro. */
export const buildSaleDocumentOperationId = (documentId: string): string => (
    `sale-document:${uuidv5(`ego-club:sale:${documentId}`, EGO_CLUB_NAMESPACE)}`
);

export interface EnrollValidationResult {
    valid: boolean;
    errors: Partial<Record<'nombre' | 'cedula' | 'celular' | 'email' | 'birthDate' | 'registrationStoreId' | 'consents', string>>;
}

/** Validación del formulario de alta, aislada para poder verificarla sin UI. */
export const validateEnrollInput = (input: LoyaltyEnrollInput): EnrollValidationResult => {
    const errors: EnrollValidationResult['errors'] = {};

    if (!String(input.nombre || '').trim() || String(input.nombre).trim().split(/\s+/).length < 2) {
        errors.nombre = 'Indica nombre y apellido';
    }
    if (!isValidCedula(input.cedula)) {
        errors.cedula = 'La cédula debe tener 11 dígitos';
    }
    if (!isValidPhone(input.celular)) {
        errors.celular = 'El celular debe tener 10 dígitos';
    }
    if (!isValidEmail(input.email)) {
        errors.email = 'Correo electrónico inválido';
    }
    if (!isAdult(input.birthDate)) {
        errors.birthDate = 'El socio debe ser mayor de 18 años';
    }
    if (!String(input.registrationStoreId || '').trim()) {
        errors.registrationStoreId = 'Selecciona la tienda de registro';
    }

    // TERMS y PRIVACY son obligatorios y deben venir explícitamente otorgados.
    const grantOf = (type: LoyaltyConsentType) => input.consents.some(c => c.type === type && c.granted);
    if (!grantOf('TERMS') || !grantOf('PRIVACY')) {
        errors.consents = 'Debes aceptar los términos y la política de privacidad';
    }

    return { valid: Object.keys(errors).length === 0, errors };
};

/** Cuerpo exacto del contrato `POST /crm/loyalty/enroll`. */
export const buildEnrollPayload = (input: LoyaltyEnrollInput): Record<string, unknown> => ({
    nombre: String(input.nombre || '').trim(),
    cedula: normalizeCedula(input.cedula),
    celular: normalizePhone(input.celular),
    email: String(input.email || '').trim().toLowerCase(),
    birth_date: String(input.birthDate || '').trim(),
    registration_store_id: String(input.registrationStoreId || '').trim(),
    consents: input.consents.map(consent => ({ type: consent.type, granted: Boolean(consent.granted) })),
});

/**
 * Encola el alta de socio y dispara un intento inmediato.
 *
 * El alta sólo se envía si el canal de lealtad está habilitado (bandera del ERP). Con la
 * bandera apagada la entrada queda en cola y no se gasta ningún intento: la UI muestra
 * "no disponible en esta caja" y no se llama a `/loyalty/enroll`.
 */
export const enqueueEnrollment = async (input: LoyaltyEnrollInput): Promise<LoyaltyOutboxItem> => {
    const item = await enqueueLoyaltyOperation(
        'ENROLL',
        buildEnrollOperationId(input.cedula),
        buildEnrollPayload(input),
        String(input.nombre || '').trim() || normalizeCedula(input.cedula),
    );
    void flushLoyaltyOutbox();
    return item;
};

/** Envía una entrada de la cola al ERP. Devuelve `ok: false` para reintentar después. */
export const sendLoyaltyOutboxItem = async (item: LoyaltyOutboxItem): Promise<SendOutcome> => {
    const path = item.type === 'ENROLL' ? '/loyalty/enroll' : '/loyalty/apply-sale-document';

    if (!isErpLoyaltyChannelFlagEnabled()) {
        // Capacidad apagada: no se llama al ERP y no se gastan intentos.
        return { ok: false, unavailable: true, error: getLoyaltyChannelUnavailableMessage(path) };
    }

    try {
        if (item.type === 'ENROLL') {
            const response = await postErpSyncJson<Record<string, unknown>>('/loyalty/enroll', item.payload);
            if (response === null) return { ok: false, error: 'Canal de sincronización del ERP no configurado' };
            markErpRouteAvailable('/loyalty/enroll');
            return { ok: true };
        }

        if (item.type === 'SALE_DOCUMENT') {
            const documentId = String(item.payload?.document_id || '');
            if (!documentId) return { ok: false, error: 'Falta document_id' };
            const response = await postErpSyncJson<Record<string, unknown>>('/loyalty/apply-sale-document', {
                document_id: documentId,
            });
            if (response === null) return { ok: false, error: 'Canal de sincronización del ERP no configurado' };
            markErpRouteAvailable('/loyalty/apply-sale-document');
            return { ok: true };
        }

        return { ok: false, error: `Tipo de operación no soportada: ${item.type}` };
    } catch (error: any) {
        const classified = classifyLoyaltyFailure(error, path);
        return { ok: false, error: classified.error, unavailable: classified.unavailable };
    }
};

/** Procesa lo pendiente (se llama al arrancar, al recuperar red y tras encolar). */
export const flushLoyaltyOutbox = async (): Promise<ProcessOutboxResult> => (
    processLoyaltyOutbox(sendLoyaltyOutboxItem)
);

/**
 * Reporta al ERP el documento de venta para que devengue los puntos.
 *
 * - Se encola **una vez por documento** (clave estable derivada del id local del
 *   documento), fuera del flujo de impresión: la venta nunca espera a la red.
 * - Con `ERP_SUPPORTS_LOYALTY_CHANNEL=false` (default) **no** se llama ni se encola:
 *   el ERP aplica la lealtad desde el evento de venta en `/inbox`, así que reportar el
 *   documento sería duplicar el devengo (y además la ruta no está publicada).
 * - El ERP es idempotente por `document_id`; aun así la clave evita encolar dos veces el
 *   mismo documento desde el POS.
 * - El POS **no** calcula los puntos devengados: el ERP aplica la base elegible (sin
 *   ITBIS, sin ofertas, sin tarjeta de regalo ni wallet) y la tasa del nivel.
 */
export const enqueueSaleDocumentReport = async (params: {
    documentId: string;
    reference?: string;
}): Promise<LoyaltyOutboxItem | null> => {
    const documentId = String(params.documentId || '').trim();
    if (!documentId) return null;

    if (!isErpLoyaltyChannelFlagEnabled()) {
        // Sin canal de lealtad el devengo lo aplica el ERP desde el evento de venta.
        return null;
    }

    const item = await enqueueLoyaltyOperation(
        'SALE_DOCUMENT',
        buildSaleDocumentOperationId(documentId),
        { document_id: documentId },
        params.reference || documentId,
    );
    void flushLoyaltyOutbox();
    return item;
};

export const getLoyaltyOutboxForCustomer = async (cedulaOrName: string): Promise<LoyaltyOutboxItem[]> => {
    const needle = String(cedulaOrName || '').trim().toUpperCase();
    if (!needle) return [];
    const queue = await listLoyaltyOutbox();
    return queue.filter(item => String(item.reference || '').toUpperCase().includes(needle));
};

/** Envío directo (sin cola) del alta: lo usa el botón "Reintentar ahora". */
export const sendEnrollmentNow = async (item: LoyaltyOutboxItem): Promise<{ ok: boolean; error?: string }> => {
    const outcome = await sendLoyaltyOutboxItem(item);
    if (outcome.ok) {
        await markLoyaltyOperationSynced(item.id);
    } else {
        await markLoyaltyOperationFailed(item.id, outcome.error || 'Error desconocido');
    }
    return outcome;
};

/**
 * Clave idempotente del canje.
 *
 * Se deriva de cliente + puntos + minuto, de modo que un doble clic del cajero sobre el
 * mismo canje reutiliza la clave en lugar de enviar dos redenciones distintas.
 */
export const buildRedemptionId = (params: { customerId: string; points: number; at?: Date }): string => {
    const at = params.at || new Date();
    const minute = at.toISOString().slice(0, 16);
    return uuidv5(`ego-club:redeem:${params.customerId}:${params.points}:${minute}`, EGO_CLUB_NAMESPACE);
};

/** Extrae el saldo devuelto por el ERP sin asumir una única forma de snapshot. */
export const extractPointsBalance = (snapshot: any): number | undefined => {
    if (!snapshot || typeof snapshot !== 'object') return undefined;
    const candidates = [
        snapshot.loyalty_points,
        snapshot.loyaltyPoints,
        snapshot.points,
        snapshot.points_balance,
        snapshot.balance,
        snapshot.loyalty?.points,
        snapshot.wallet?.points,
    ];
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value)) return value;
    }
    return undefined;
};

export interface RedeemResult {
    ok: boolean;
    points?: number;
    /** Saldo autoritativo devuelto por el ERP. */
    balance?: number;
    error?: string;
    /** `true` cuando la capacidad no está disponible en esta caja (no es error de red). */
    unavailable?: boolean;
}

/**
 * Canje de puntos en línea.
 *
 * No se encola a propósito: descontar dinero contra un saldo sin verificar no es
 * aceptable. Si el ERP falla o no responde, el POS **no** aplica el descuento y avisa al
 * cajero. El saldo que se muestra después es el del snapshot del ERP, nunca uno calculado
 * localmente.
 *
 * Con `ERP_SUPPORTS_LOYALTY_CHANNEL=false` (default) la función ni siquiera llama al
 * ERP: devuelve un estado "no disponible en esta caja" que la UI muestra sin bloquear la
 * venta. Un 404 de ruta sync se trata igual (capacidad ausente, no excepción).
 */
export const redeemPoints = async (params: {
    customerId: string;
    points: number;
    reason: string;
}): Promise<RedeemResult> => {
    const points = Math.floor(Number(params.points));
    if (!params.customerId) return { ok: false, error: 'Falta el cliente para canjear' };
    if (!Number.isFinite(points) || points <= 0) return { ok: false, error: 'Cantidad de puntos inválida' };

    if (!isErpLoyaltyChannelFlagEnabled()) {
        return {
            ok: false,
            unavailable: true,
            error: getLoyaltyChannelUnavailableMessage('/loyalty/redeem'),
        };
    }

    try {
        const response = await postErpSyncJson<Record<string, any>>('/loyalty/redeem', {
            customer_id: params.customerId,
            points,
            reason: params.reason,
        });

        if (response === null) {
            return { ok: false, error: 'Canal de sincronización del ERP no configurado' };
        }

        markErpRouteAvailable('/loyalty/redeem');

        const status = String(response.status || '').toLowerCase();
        if (status && status !== 'success') {
            return { ok: false, error: String(response.message || response.error || 'El ERP rechazó el canje') };
        }

        return {
            ok: true,
            points,
            balance: extractPointsBalance(response.snapshot),
        };
    } catch (error: any) {
        const classified = classifyLoyaltyFailure(error, '/loyalty/redeem');
        return { ok: false, error: classified.error, unavailable: classified.unavailable };
    }
};
