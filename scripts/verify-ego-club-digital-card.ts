/**
 * Comprobación manual reproducible de T7 (tarjeta digital del socio).
 *
 *   npx tsx scripts/verify-ego-club-digital-card.ts
 *
 * Verifica la resolución del dato mostrado: saldo vivo del ERP, último saldo sincronizado
 * cuando no hay datos vivos, y «sin sincronizar» (nunca un saldo inventado), además de la
 * marca de tiempo relativa y el payload del QR.
 *
 * Sale con código 1 si alguna aserción falla.
 */
import {
    buildEgoClubQrPayload,
    formatUpdatedAgo,
    resolveEgoClubCardView,
    type EgoClubCardSnapshot,
} from '../utils/egoClubCard';
import type { BusinessConfig, Customer } from '../types';

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
};

const config = {
    currencySymbol: 'RD$',
    loyalty: {
        isEnabled: true,
        earnMode: 'UNIFIED',
        earnRate: 0.05,
        redeemRate: 1,
        minRedemptionPoints: 1250,
        expirationMonths: 12,
        excludedCategories: [],
        tiers: [
            { id: 'STANDARD', name: 'EGO Club', spendThreshold: 0, earnUnitsPer100: 5, minRedemptionUnits: 1250 },
            { id: 'GOLD', name: 'Gold', spendThreshold: 47720, earnUnitsPer100: 10, minRedemptionUnits: 1250 },
            { id: 'BLACK', name: 'Black', spendThreshold: 70800, earnUnitsPer100: 15, minRedemptionUnits: 1250 },
        ],
    },
} as unknown as BusinessConfig;

const customer = {
    id: 'c-1',
    name: 'Ana Pérez',
    tier: 'BLACK',
    loyaltyPoints: 3120,
    lastVisit: '2026-06-20T14:05:00.000Z',
} as Customer;

const now = new Date('2026-06-21T12:00:00.000Z');

// --- Datos vivos (online) ----------------------------------------------------
const live = resolveEgoClubCardView({ customer, config, now });
check('saldo vivo del ERP', live.points, 3120);
check('equivalente en RD$ con la tasa del ERP', live.value, 3120);
check('fuente = LIVE', live.source, 'LIVE');
check('etiqueta del nivel', live.tierLabel, 'Black');
check('QR del socio', live.qrPayload, 'EGOCLUB:c-1');

// --- Sin conexión: último saldo sincronizado ---------------------------------
const snapshot: EgoClubCardSnapshot = {
    customerId: 'c-1',
    name: 'Ana Pérez',
    tier: 'BLACK',
    points: 2500,
    redeemRate: 1,
    lastActivityAt: '2026-06-20T14:05:00.000Z',
    syncedAt: '2026-06-21T09:00:00.000Z',
    qrPayload: 'EGOCLUB:c-1',
};
const cached = resolveEgoClubCardView({
    customer: { id: 'c-1', name: 'Ana Pérez' } as Customer,
    snapshot,
    config,
    now,
});
check('sin datos vivos usa el último saldo sincronizado', [cached.points, cached.source], [2500, 'CACHED']);
check('lo dice con su marca de tiempo', cached.freshness, 'hace 3 h');
check('conserva el nivel cacheado', cached.tier, 'BLACK');
check('conserva la fecha de sincronización', cached.syncedAt, '2026-06-21T09:00:00.000Z');

// --- Nunca inventa saldo -----------------------------------------------------
const empty = resolveEgoClubCardView({
    customer: { id: 'c-2', name: 'Sin historial' } as Customer,
    snapshot: null,
    config,
    now,
});
check('sin caché: fuente NONE', empty.source, 'NONE');
check('sin caché: no inventa saldo', [empty.points, empty.value], [0, 0]);
check('sin caché: lo dice explícitamente', empty.freshness, 'sin sincronizar');
check('sin caché: sin membresía', empty.tierLabel, 'Sin membresía');

// --- Frescura del dato -------------------------------------------------------
check('menos de un minuto', formatUpdatedAgo('2026-06-21T11:59:30.000Z', now), 'ahora mismo');
check('minutos', formatUpdatedAgo('2026-06-21T11:40:00.000Z', now), 'hace 20 min');
check('horas', formatUpdatedAgo('2026-06-21T06:00:00.000Z', now), 'hace 6 h');
check('un día', formatUpdatedAgo('2026-06-20T12:00:00.000Z', now), 'hace 1 día');
check('varios días', formatUpdatedAgo('2026-06-15T12:00:00.000Z', now), 'hace 6 días');
check('sin fecha', formatUpdatedAgo(undefined, now), 'sin sincronizar');

// --- QR ----------------------------------------------------------------------
check('QR usa el número de tarjeta si existe', buildEgoClubQrPayload({
    id: 'c-3',
    name: 'Luis',
    cards: [{ id: 'lc1', customerId: 'c-3', type: 'LOYALTY', cardNumber: '888000111', pointsBalance: 10, status: 'ACTIVE', issuedAt: now.toISOString(), history: [] }],
} as Customer), 'EGOCLUB:888000111');

console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
