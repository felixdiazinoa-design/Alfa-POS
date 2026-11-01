/**
 * Comprobación manual reproducible de T1 (objetivos BRAND y VARIANT del motor).
 *
 * No hay framework de tests en el repo, así que esta verificación vive en un script
 * ejecutable con el `tsx` que ya está en devDependencies:
 *
 *   npx tsx scripts/verify-ego-club-targets.ts
 *
 * Sale con código 1 si alguna aserción falla.
 */
import { applyPromotions, itemMatchesPromotionTarget } from '../utils/promotionEngine';
import type { BusinessConfig, CartItem, Promotion } from '../types';

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
};

const line = (overrides: Partial<CartItem> & Record<string, unknown>): CartItem => ({
    id: 'p-default',
    name: 'Item',
    price: 1000,
    category: 'Calzado',
    quantity: 1,
    cartId: `c-${Math.random().toString(36).slice(2)}`,
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
    ...overrides,
} as CartItem);

const promo = (overrides: Partial<Promotion>): Promotion => ({
    id: 'promo',
    name: 'Promo',
    type: 'DISCOUNT',
    priority: 10,
    targetType: 'ALL',
    benefitValue: 10,
    schedule: { days: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], startTime: '00:00', endTime: '23:59', isActive: true },
    ...overrides,
});

const config: BusinessConfig = {
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
} as unknown as BusinessConfig;

// --- T1: BRAND ---------------------------------------------------------------
const brandPromo = promo({
    id: 'promo-brand',
    targetType: 'BRAND',
    targetValue: 'Marca X',
    targetRefs: ['item-marca-x-1', 'SKU-123', '7501234567890'],
});

const shoeBrandX = line({ id: 'item-marca-x-1', name: 'Zapatilla X', category: 'Calzado' });
const shirtBrandX = line({ id: 'item-otro', name: 'Camisa X', category: 'Ropa', variantSku: 'SKU-123' });
const sneakerByBarcode = line({ id: 'item-sin-ref', name: 'Tenis', category: 'Calzado', barcode: '7501234567890' });
const brandY = line({ id: 'item-marca-y', name: 'Zapatilla Y', category: 'Calzado' });

check('BRAND por id interno', itemMatchesPromotionTarget(brandPromo, shoeBrandX, config), true);
check('BRAND por SKU de la línea', itemMatchesPromotionTarget(brandPromo, shirtBrandX, config), true);
check('BRAND por código de barra', itemMatchesPromotionTarget(brandPromo, sneakerByBarcode, config), true);
check('BRAND no toca otra marca', itemMatchesPromotionTarget(brandPromo, brandY, config), false);

// Respaldo por brandId cuando targetRefs no trae nada.
const brandPromoByValue = promo({ id: 'promo-brand-value', targetType: 'BRAND', targetValue: 'BR-X' });
check('BRAND por brandId', itemMatchesPromotionTarget(brandPromoByValue, line({ id: 'a', brandId: 'BR-X' }), config), true);
check('BRAND por brandId distinto', itemMatchesPromotionTarget(brandPromoByValue, line({ id: 'b', brandId: 'BR-Y' }), config), false);

// --- T1: VARIANT -------------------------------------------------------------
const variantPromo = promo({ id: 'promo-variant', targetType: 'VARIANT', targetRefs: ['SKU-42-DORADO'] });
const goldVariant = line({ id: 'p-42-dorado', variantSku: 'SKU-42-DORADO' });
const blackVariant = line({ id: 'p-42-negro', variantSku: 'SKU-42-NEGRO' });

check('VARIANT aplica a la variante listada', itemMatchesPromotionTarget(variantPromo, goldVariant, config), true);
check('VARIANT no aplica a otra variante del mismo producto', itemMatchesPromotionTarget(variantPromo, blackVariant, config), false);

// --- T1: efecto en el precio del ticket --------------------------------------
const cart = [shoeBrandX, shirtBrandX, sneakerByBarcode, brandY];
const priced = applyPromotions(cart, { ...config, promotions: [brandPromo] }, 't1');
const pricesById = Object.fromEntries(priced.map(i => [i.id, i.price]));

check('descuenta las 3 líneas de la marca', [
    pricesById['item-marca-x-1'], pricesById['item-otro'], pricesById['item-sin-ref'],
], [900, 900, 900]);
check('deja intacta la línea de otra marca', pricesById['item-marca-y'], 1000);

const variantPriced = applyPromotions([goldVariant, blackVariant], { ...config, promotions: [variantPromo] }, 't1');
const variantPrices = Object.fromEntries(variantPriced.map(i => [i.id, i.price]));
check('VARIANT descuenta sólo la variante listada', [variantPrices['p-42-dorado'], variantPrices['p-42-negro']], [900, 1000]);

console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
