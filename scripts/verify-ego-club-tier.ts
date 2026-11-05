/**
 * Comprobación manual reproducible de T3 (el nivel del cliente llega al ticket).
 *
 *   npx tsx scripts/verify-ego-club-tier.ts
 *
 * Sale con código 1 si alguna aserción falla.
 */
import { applyPromotions } from '../utils/promotionEngine';
import { getTierDefinition, getTierLabel, isEgoClubEnabled, mapCustomerFromErp, normalizeTier } from '../utils/egoClub';
import type { BusinessConfig, CartItem, Customer, Promotion } from '../types';

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
};

// Snapshot del ERP tal como llega por el canal de sync (snake_case).
const erpCustomer = {
    id: 'c-1',
    name: 'Ana Pérez',
    cedula: '00112345678',
    tier: 'golD',
    loyalty_points: 3120,
    wallet: { id: 'w1', balance: 500, status: 'ACTIVE' },
    cards: [],
};

const mapped = mapCustomerFromErp(erpCustomer);
check('tier llega normalizado a mayúsculas', mapped.tier, 'GOLD');
check('loyalty_points se mapea a loyaltyPoints', mapped.loyaltyPoints, 3120);
check('no se cuela loyalty_points crudo en el objeto', (mapped as any).loyalty_points, undefined);
check('el resto del cliente se conserva', (mapped as any).cedula, '00112345678');

// Cliente sin membresía: tier debe quedar undefined (no 'STANDARD').
const noMembership = mapCustomerFromErp({ id: 'c-2', name: 'Pedro', tier: null, loyalty_points: 0 });
check('cliente sin membresía queda sin tier', noMembership.tier, undefined);
check('cliente sin membresía conserva 0 puntos', noMembership.loyaltyPoints, 0);

const legacyTier = mapCustomerFromErp({ id: 'c-3', name: 'Viejo', tier: 'BRONZE', loyalty_points: 20 });
check('nivel fuera del programa no se propaga como si fuera EGO Club', legacyTier.tier, undefined);
check('normalizeTier acepta minúsculas', normalizeTier('black'), 'BLACK');
check('normalizeTier rechaza vacío', normalizeTier('   '), null);

// La config del snapshot, con umbrales por nivel (nada hardcodeado en el POS).
const config = {
    vertical: 'Retail',
    subVertical: 'Calzado',
    currencySymbol: 'RD$',
    taxRate: 0.18,
    taxes: [],
    themeColor: 'blue',
    features: { stockTracking: false },
    companyInfo: { name: 'EGO', rnc: '', address: '', phone: '', email: '' },
    currencies: [],
    paymentMethods: [],
    terminals: [],
    tariffs: [],
    ux: { theme: 'LIGHT', gridDensity: 'COMFORTABLE', showProductImages: false, quickKeysLayout: 'A', viewMode: 'RETAIL' },
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
    promotions: [{
        id: 'promo-tiers',
        name: 'Socio Gold/Black 20%',
        type: 'DISCOUNT',
        priority: 10,
        targetType: 'ALL',
        benefitValue: 20,
        audience: { tiers: ['GOLD', 'BLACK'] },
        schedule: { days: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], startTime: '00:00', endTime: '23:59', isActive: true },
    } satisfies Promotion],
} as unknown as BusinessConfig;

check('programa encendido', isEgoClubEnabled(config), true);
check('programa apagado cuando loyalty es null', isEgoClubEnabled({ ...config, loyalty: null } as any), false);
check('etiqueta del nivel tomada del ERP', getTierLabel(config, 'BLACK'), 'Black');
check('umbral de nivel leído de la config del ERP', getTierDefinition(config, 'BLACK')?.spendThreshold, 70800);

const line = {
    id: 'p-1', name: 'Zapatilla', price: 1000, category: 'Calzado', quantity: 1, cartId: 'c-1',
    images: [], attributes: [], variants: [], tariffs: [], appliedTaxIds: [],
} as CartItem;

// El ticket usa el cliente tal como lo mapea la ingesta: cambiar de cliente cambia el
// resultado de la promoción sin tocar el motor ni recargar nada.
const priceFor = (customer?: Customer) => applyPromotions([line], config, 't1', customer)[0].price;
check('cliente Black mapeado del ERP recibe la promo', priceFor(mapped), 800);
check('cliente sin membresía no recibe la promo', priceFor(noMembership), 1000);
check('ticket anónimo no recibe la promo', priceFor(undefined), 1000);

console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
