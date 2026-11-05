import type { BusinessConfig, Customer, LoyaltyConfig, LoyaltyTierId } from '../types';

/**
 * Dominio EGO Club en el POS.
 *
 * Regla de oro: el ERP es la única fuente de verdad. Aquí no se calcula saldo ni se
 * decide nivel; sólo se normaliza lo que ya resolvió el ERP para poder mostrarlo y
 * para que el motor de promociones pueda comparar niveles.
 */

/** Niveles conocidos del programa, en orden ascendente. */
export const EGO_CLUB_TIERS: LoyaltyTierId[] = ['STANDARD', 'GOLD', 'BLACK'];

/** Etiqueta por defecto cuando el ERP no manda nombre para el nivel. */
const DEFAULT_TIER_LABELS: Record<LoyaltyTierId, string> = {
    STANDARD: 'EGO Club',
    GOLD: 'Gold',
    BLACK: 'Black',
};

/**
 * Normaliza el nivel a mayúsculas. Devuelve `null` cuando no hay membresía, para que
 * el ticket no herede un nivel por accidente (ver T2: sin nivel no hay beneficios).
 */
export const normalizeTier = (value: unknown): LoyaltyTierId | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toUpperCase();
    if (text.length === 0) return null;
    return (EGO_CLUB_TIERS as string[]).includes(text) ? (text as LoyaltyTierId) : null;
};

/** ¿Está encendido el programa en esta sucursal? `null`/ausente ⇒ apagado. */
export const isEgoClubEnabled = (config?: BusinessConfig | null): boolean => config?.loyalty?.isEnabled === true;

/** Configuración de fidelización, o `null` si el programa viene apagado. */
export const getLoyaltyConfig = (config?: BusinessConfig | null): LoyaltyConfig | null => (
    isEgoClubEnabled(config) ? (config!.loyalty as LoyaltyConfig) : null
);

/** Definición del nivel tal como la publica el ERP (umbrales y tasas incluidos). */
export const getTierDefinition = (config: BusinessConfig | null | undefined, tier: unknown) => {
    const tiers = config?.loyalty?.tiers;
    if (!Array.isArray(tiers) || tiers.length === 0) return undefined;

    const normalized = normalizeTier(tier);
    if (!normalized) return undefined;

    // El ERP usa ids como "GOLD"; se comparan normalizados por si llegan en minúsculas.
    return tiers.find(candidate => String(candidate.id).trim().toUpperCase() === normalized);
};

/** Etiqueta visible del nivel: la del ERP si viene, si no la del programa. */
export const getTierLabel = (config: BusinessConfig | null | undefined, tier: unknown): string => {
    const normalized = normalizeTier(tier);
    if (!normalized) return '';

    const definition = getTierDefinition(config, normalized);
    const fromErp = definition?.name?.trim();
    return fromErp && fromErp.length > 0 ? fromErp : DEFAULT_TIER_LABELS[normalized];
};

/** Clases tailwind del badge de nivel, alineadas con la identidad del programa. */
export const getTierBadgeClass = (tier: unknown): string => {
    switch (normalizeTier(tier)) {
        case 'BLACK':
            return 'bg-gray-900 text-white border-gray-900';
        case 'GOLD':
            return 'bg-amber-100 text-amber-800 border-amber-300';
        case 'STANDARD':
            return 'bg-blue-50 text-blue-700 border-blue-200';
        default:
            return 'bg-gray-100 text-gray-500 border-gray-200';
    }
};

/**
 * Mapea el cliente que llega del canal de sync al tipo `Customer` del POS.
 *
 * El ERP entrega `loyalty_points` en snake_case y el POS guarda `loyaltyPoints`; sin este
 * mapeo el saldo se perdía en la ingesta y el cliente quedaba siempre en 0 puntos.
 * `tier` se normaliza a mayúsculas y queda `undefined` cuando no hay membresía, que es
 * justo lo que necesita la regla de audiencia de T2.
 */
export const mapCustomerFromErp = (raw: any): Customer => {
    if (!raw || typeof raw !== 'object') return raw as Customer;

    const rawTier = raw.tier ?? raw.loyalty_tier ?? raw.membership_tier;
    const tier = normalizeTier(rawTier);

    const rawPoints = raw.loyaltyPoints ?? raw.loyalty_points ?? raw.points_balance;
    const loyaltyPoints = Number.isFinite(Number(rawPoints)) ? Number(rawPoints) : undefined;

    // Se descartan las variantes crudas para que un tier/nivel inválido no se cuele en el
    // objeto final: si no hay membresía reconocida, `tier` debe quedar ausente.
    const {
        tier: _rawTier,
        loyalty_tier: _snakeTier,
        membership_tier: _membershipTier,
        loyalty_points: _snakePoints,
        points_balance: _pointsBalance,
        ...rest
    } = raw;

    return {
        ...rest,
        ...(tier ? { tier } : {}),
        ...(loyaltyPoints !== undefined ? { loyaltyPoints } : {}),
    } as Customer;
};

/** Aplica el mapeo a una colección completa, sin tocar el resto de campos. */
export const mapCustomersFromErp = (raw: unknown): Customer[] => (
    Array.isArray(raw) ? raw.map(mapCustomerFromErp) : []
);

/**
 * Saldo en RD$ a partir de los puntos y la tasa de canje del ERP.
 * No inventa saldo: es sólo la conversión que el cajero necesita ver.
 */
export const pointsToCurrency = (points: number | undefined, config: BusinessConfig | null | undefined): number => {
    const redeemRate = Number(config?.loyalty?.redeemRate);
    if (!Number.isFinite(redeemRate) || redeemRate <= 0) return 0;
    return (Number(points) || 0) * redeemRate;
};

/** Tasa de canje del ERP (1 punto = RD$X). 0 si el programa está apagado o mal configurado. */
export const getRedeemRate = (config: BusinessConfig | null | undefined): number => {
    const rate = Number(config?.loyalty?.redeemRate);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
};

/**
 * Mínimo de canje del nivel del cliente.
 *
 * Es un **umbral para poder canjear**, no un saldo que deba permanecer en la cuenta: con
 * 1.250 puntos exactos el socio puede canjear los 1.250. Se toma del nivel y, si el nivel
 * no lo declara, del mínimo global del programa.
 */
export const getMinRedemptionUnits = (config: BusinessConfig | null | undefined, tier: unknown): number => {
    const fromTier = Number(getTierDefinition(config, tier)?.minRedemptionUnits);
    if (Number.isFinite(fromTier) && fromTier > 0) return fromTier;

    const global = Number(config?.loyalty?.minRedemptionPoints);
    return Number.isFinite(global) && global > 0 ? global : 0;
};

export interface RedemptionBounds {
    /** Puntos disponibles según el ERP. */
    available: number;
    /** Umbral de canje del nivel: el socio debe tener al menos estos puntos. */
    minUnits: number;
    /** Mínimo canjeable en esta operación (siempre 1 punto: el umbral es de elegibilidad). */
    minAmount: number;
    /** Tope de canje: min(disponibles, ticketTotal / redeemRate). */
    max: number;
    redeemRate: number;
    /** ¿El cliente puede canjear hoy (alcanza el umbral y el ticket lo admite)? */
    canRedeem: boolean;
    /** Motivo por el que no se puede canjear, para mostrar en caja. */
    blockedReason?: string;
}

/**
 * Calcula los límites del canje para un ticket.
 *
 * `ticketTotal` es el total que el cliente paga (con impuestos): el canje puede cubrir
 * hasta el 100 % del ticket, nunca más.
 *
 * Decisión sobre el mínimo de canje: `minRedemptionUnits` (1.250) se evalúa como
 * **umbral de elegibilidad sobre el saldo disponible**, no como monto mínimo de la
 * operación. Es la única lectura compatible con el caso de aceptación del brief (cliente
 * con 2.000 puntos y ticket de RD$500 → puede canjear hasta 500 puntos): si el mínimo
 * fuera el monto, ese ticket no podría canjear nada. Ver nota en el PR de T5.
 */
export const calculateRedemptionBounds = (params: {
    availablePoints: number | undefined;
    ticketTotal: number;
    config: BusinessConfig | null | undefined;
    tier: unknown;
}): RedemptionBounds => {
    const redeemRate = getRedeemRate(params.config);
    const minUnits = getMinRedemptionUnits(params.config, params.tier);
    const available = Math.max(0, Math.floor(Number(params.availablePoints) || 0));
    const empty = { available, minUnits, minAmount: 1, redeemRate, max: 0 };

    if (redeemRate <= 0) {
        return { ...empty, canRedeem: false, blockedReason: 'El programa no tiene tasa de canje configurada' };
    }

    const ticketTotal = Math.max(0, Number(params.ticketTotal) || 0);
    const max = Math.max(0, Math.min(available, Math.floor(ticketTotal / redeemRate)));

    if (minUnits > 0 && available < minUnits) {
        return {
            ...empty,
            max,
            canRedeem: false,
            blockedReason: `El mínimo para canjear de este nivel es de ${minUnits.toLocaleString('es-DO')} puntos`,
        };
    }

    if (max <= 0) {
        return { ...empty, canRedeem: false, blockedReason: 'El ticket no tiene monto canjeable' };
    }

    return { ...empty, max, canRedeem: true };
};
