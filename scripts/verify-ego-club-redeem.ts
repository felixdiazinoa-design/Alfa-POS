/**
 * Comprobación manual reproducible de T5 (canje en el ticket).
 *
 *   npx tsx scripts/verify-ego-club-redeem.ts
 *
 * Cubre los límites del canje (tope, mínimo por nivel, ticket al 100 %), la lectura del
 * snapshot del ERP y el comportamiento **fail-closed**: si el canje no se autoriza, no
 * hay descuento. El canal HTTP se sustituye por un `fetch` falso para no tocar la red.
 *
 * Sale con código 1 si alguna aserción falla.
 */
import { calculateRedemptionBounds, getMinRedemptionUnits, getRedeemRate, pointsToCurrency } from '../utils/egoClub';
import { buildRedemptionId, extractPointsBalance, redeemPoints } from '../services/loyalty/LoyaltyService';
import type { BusinessConfig } from '../types';

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
};

const config = {
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

check('tasa de canje del ERP', getRedeemRate(config), 1);
check('mínimo de canje del nivel', getMinRedemptionUnits(config, 'GOLD'), 1250);
check('mínimo del nivel cae al global si el nivel no lo declara', getMinRedemptionUnits({
    loyalty: { ...config.loyalty!, tiers: [{ id: 'GOLD', name: 'Gold' }] },
} as any, 'GOLD'), 1250);

// --- Caso de aceptación: 2.000 puntos, ticket de RD$500 -----------------------
const bounds = calculateRedemptionBounds({ availablePoints: 2000, ticketTotal: 500, config, tier: 'GOLD' });
check('tope = min(disponibles, ticket/tasa) = 500', bounds.max, 500);
check('puede canjear aunque el tope (500) sea menor que el umbral (1.250)', bounds.canRedeem, true);
check('valor del tope en RD$ = total del ticket', pointsToCurrency(bounds.max, config), 500);

// --- El mínimo es un umbral, no un saldo residual ----------------------------
const exact = calculateRedemptionBounds({ availablePoints: 1250, ticketTotal: 5000, config, tier: 'GOLD' });
check('con exactamente 1.250 puntos puede canjear los 1.250', [exact.canRedeem, exact.max], [true, 1250]);
const below = calculateRedemptionBounds({ availablePoints: 1249, ticketTotal: 5000, config, tier: 'GOLD' });
check('con 1.249 puntos no alcanza el umbral', below.canRedeem, false);
check('y se le explica el mínimo', below.blockedReason?.includes('1,250') || below.blockedReason?.includes('1250'), true);

// --- Ticket menor que el mínimo canjeable ------------------------------------
const smallTicket = calculateRedemptionBounds({ availablePoints: 5000, ticketTotal: 500, config, tier: 'BLACK' });
check('ticket de RD$500 con saldo de sobra: tope = 500', [smallTicket.canRedeem, smallTicket.max], [true, 500]);
check('el umbral de nivel se informa aparte del monto', smallTicket.minUnits, 1250);

// --- Canje del 100 % del ticket ----------------------------------------------
const full = calculateRedemptionBounds({ availablePoints: 10000, ticketTotal: 1180, config, tier: 'GOLD' });
check('canje puede cubrir el 100 % del ticket', full.max, 1180);

// --- Programa apagado ---------------------------------------------------------
const off = calculateRedemptionBounds({ availablePoints: 5000, ticketTotal: 1000, config: { loyalty: null } as any, tier: 'GOLD' });
check('sin programa no hay canje', [off.canRedeem, off.max], [false, 0]);

// --- Snapshot del ERP --------------------------------------------------------
check('saldo desde snapshot.loyalty_points', extractPointsBalance({ loyalty_points: 1870 }), 1870);
check('saldo desde snapshot.points', extractPointsBalance({ points: '1870' }), 1870);
check('snapshot irreconocible no inventa saldo', extractPointsBalance({ foo: 'bar' }), undefined);

// --- Clave idempotente del canje ---------------------------------------------
const at = new Date('2026-03-01T10:15:30.000Z');
check('mismo canje en el mismo minuto reutiliza clave', buildRedemptionId({
    customerId: 'c-1', points: 500, at,
}), buildRedemptionId({ customerId: 'c-1', points: 500, at: new Date('2026-03-01T10:15:59.000Z') }));
check('canje con otros puntos genera otra clave', buildRedemptionId({ customerId: 'c-1', points: 500, at })
    === buildRedemptionId({ customerId: 'c-1', points: 600, at }), false);

// --- Fail-closed: si el ERP no autoriza, no hay canje ------------------------
const run = async () => {
    const storage: Record<string, string> = {
        CLIC_ERP_SYNC_URL: 'https://erp.invalid',
        CLIC_POS_DEVICE_TOKEN: 'device-1',
    };
    (globalThis as any).localStorage = {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => { storage[key] = value; },
        removeItem: (key: string) => { delete storage[key]; },
        clear: () => { Object.keys(storage).forEach(key => delete storage[key]); },
    };

    // 1) El ERP responde con error HTTP.
    (globalThis as any).fetch = async () => ({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Saldo insuficiente' }),
    });
    const rejected = await redeemPoints({ customerId: 'c-1', points: 500, reason: 'Canje EGO Club' });
    check('el ERP rechaza ⇒ ok: false', rejected.ok, false);
    check('el error del ERP se propaga al cajero', rejected.error, 'Saldo insuficiente');
    check('no devuelve saldo inventado', rejected.balance, undefined);

    // 2) El ERP responde 200 pero con status distinto de success.
    (globalThis as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'error', message: 'Puntos expirados' }),
    });
    const notSuccess = await redeemPoints({ customerId: 'c-1', points: 500, reason: 'Canje' });
    check('status != success ⇒ ok: false', notSuccess.ok, false);

    // 3) Red caída.
    (globalThis as any).fetch = async () => { throw new Error('Failed to fetch'); };
    const offline = await redeemPoints({ customerId: 'c-1', points: 500, reason: 'Canje' });
    check('sin red ⇒ ok: false (falla cerrado)', offline.ok, false);

    // 4) Éxito: se acepta el saldo del snapshot, no uno calculado.
    (globalThis as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', snapshot: { loyalty_points: 1500 } }),
    });
    const ok = await redeemPoints({ customerId: 'c-1', points: 500, reason: 'Canje' });
    check('canje autorizado', ok.ok, true);
    check('saldo autoritativo del ERP', ok.balance, 1500);

    console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
    process.exit(failures === 0 ? 0 : 1);
};

void run();
