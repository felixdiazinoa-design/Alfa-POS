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
