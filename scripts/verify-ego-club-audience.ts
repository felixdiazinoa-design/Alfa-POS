/**
 * Comprobación manual reproducible de T2 (audiencia por nivel EGO Club).
 *
 *   npx tsx scripts/verify-ego-club-audience.ts
 *
 * Sale con código 1 si alguna aserción falla.
 */
import { applyPromotions, promotionMatchesAudience } from '../utils/promotionEngine';
import type { BusinessConfig, CartItem, Customer, Promotion } from '../types';

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
};

const line = (overrides: Partial<CartItem> = {}): CartItem => ({
    id: 'p-1',
    name: 'Zapatilla',
    price: 1000,
    category: 'Calzado',
    quantity: 1,
    cartId: 'c-1',
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
    ...overrides,
} as CartItem);

const basePromo: Promotion = {
    id: 'promo-gold-black',
    name: 'Socio Gold/Black',
    type: 'DISCOUNT',
    priority: 10,
    targetType: 'ALL',
    benefitValue: 20,
    schedule: { days: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], startTime: '00:00', endTime: '23:59', isActive: true },
};

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
    promotions: [{ ...basePromo, audience: { tiers: ['GOLD', 'BLACK'] } }],
} as unknown as BusinessConfig;

const gold = { id: 'c-gold', name: 'Ana', tier: 'GOLD' } as Customer;
const black = { id: 'c-black', name: 'Luis', tier: 'black' } as Customer;
const standard = { id: 'c-std', name: 'Pedro', tier: 'STANDARD' } as Customer;
const noTier = { id: 'c-none', name: 'Sin membresía' } as Customer;

const priceFor = (customer?: Customer) => applyPromotions([line()], config, 't1', customer)[0].price;

// --- T2: audiencia declarada ------------------------------------------------
check('cliente GOLD recibe el descuento', priceFor(gold), 800);
check('cliente BLACK (minúsculas en el dato) también', priceFor(black), 800);
check('cliente STANDARD no aplica y queda a precio base', priceFor(standard), 1000);
check('ticket sin cliente identificado no aplica', priceFor(undefined), 1000);
check('cliente sin membresía (tier undefined) no aplica', priceFor(noTier), 1000);

check('audiencia declarada coincide con GOLD', promotionMatchesAudience(config.promotions![0], gold), true);
check('audiencia declarada no coincide con STANDARD', promotionMatchesAudience(config.promotions![0], standard), false);

// --- T2: sin audiencia = todos ----------------------------------------------
const openPromo: Promotion = { ...basePromo, id: 'promo-open', audience: undefined };
const emptyAudience: Promotion = { ...basePromo, id: 'promo-empty', audience: { tiers: [] } };
check('sin audience aplica a anónimo', promotionMatchesAudience(openPromo, undefined), true);
check('audience.tiers vacío aplica a anónimo', promotionMatchesAudience(emptyAudience, undefined), true);

const openConfig = { ...config, promotions: [openPromo] } as unknown as BusinessConfig;
check('promo sin audiencia descuenta a ticket anónimo', applyPromotions([line()], openConfig, 't1')[0].price, 800);

// --- T2: sistema heredado de conditions intacto -----------------------------
const legacyTierCondition: Promotion = {
    ...basePromo,
    id: 'promo-legacy',
    conditions: [{ type: 'CUSTOMER_TIER', value: 'GOLD' }],
}; 
const legacyConfig = { ...config, promotions: [legacyTierCondition] } as unknown as BusinessConfig;
check('CUSTOMER_TIER heredado sigue aplicando a GOLD', applyPromotions([line()], legacyConfig, 't1', gold)[0].price, 800);
check('CUSTOMER_TIER heredado no aplica sin cliente', applyPromotions([line()], legacyConfig, 't1')[0].price, 1000);

const legacyPoints: Promotion = {
    ...basePromo,
    id: 'promo-points',
    conditions: [{ type: 'HAS_POINTS_MIN', value: '1500' }],
};
const pointsConfig = { ...config, promotions: [legacyPoints] } as unknown as BusinessConfig;
const rich = { id: 'c-rich', name: 'Rico', loyaltyPoints: 2000 } as Customer;
const poor = { id: 'c-poor', name: 'Pobre', loyaltyPoints: 300 } as Customer;
check('HAS_POINTS_MIN heredado aplica con saldo suficiente', applyPromotions([line()], pointsConfig, 't1', rich)[0].price, 800);
check('HAS_POINTS_MIN heredado no aplica con saldo bajo', applyPromotions([line()], pointsConfig, 't1', poor)[0].price, 1000);

console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
