import type { CartItem, BusinessConfig, Promotion, Customer } from '../types';

/**
 * Normaliza un identificador para compararlo sin depender de mayúsculas ni espacios.
 * El ERP hidrata `targetRefs` con ids, SKUs, códigos externos y códigos de barra tal
 * como los tiene en su catálogo, así que la comparación estricta por cadena fallaría
 * por diferencias de formato que no significan nada para el negocio.
 */
const normalizeRef = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length > 0 ? text.toUpperCase() : null;
};

/**
 * Identificadores con los que una línea del ticket puede ser referida por una promoción.
 *
 * Sólo se usan identificadores de la propia línea (no de todas las variantes del
 * producto): si se incluyeran los SKUs de las demás variantes, una promoción VARIANT
 * de la variante B descontaría la línea de la variante A del mismo producto.
 *
 * `sku` y `externalCode` no están declarados en `Product`/`CartItem` porque el snapshot
 * del ERP no los tipa todavía; se leen de forma defensiva para no romper el contrato.
 */
const collectItemRefs = (item: CartItem): Set<string> => {
    const refs = new Set<string>();
    const add = (value: unknown) => {
        const normalized = normalizeRef(value);
        if (normalized) refs.add(normalized);
    };
    const extra = item as unknown as Record<string, unknown>;

    add(item.id);
    add(item.variantSku);
    add(item.barcode);
    add(extra.sku);
    add(extra.externalCode);
    add(extra.external_code);

    return refs;
};

const matchesAnyTargetRef = (promo: Promotion, item: CartItem): boolean => {
    const targetRefs = Array.isArray(promo.targetRefs) ? promo.targetRefs : [];
    if (targetRefs.length === 0) return false;

    const itemRefs = collectItemRefs(item);
    return targetRefs.some(ref => {
        const normalized = normalizeRef(ref);
        return normalized !== null && itemRefs.has(normalized);
    });
};

/**
 * Resuelve si la línea participa de la promoción.
 *
 * - `VARIANT`: coincide si `targetRefs` contiene el SKU, código externo o código de
 *   barra de la línea. Se acepta también `targetValue` como respaldo, porque las
 *   promociones de una sola variante se configuran así y `VARIANT` no existía antes
 *   (no hay comportamiento heredado que preservar).
 * - `BRAND`: misma comprobación por `targetRefs` (el ERP mete ahí los ids, SKUs,
 *   códigos externos y códigos de barra de todos los ítems de la marca) y, como
 *   respaldo, compara `item.brandId`/`brand_id` con `targetValue`.
 */
export const itemMatchesPromotionTarget = (promo: Promotion, item: CartItem, config: BusinessConfig): boolean => {
    if (promo.targetType === 'ALL') return true;
    if (promo.targetType === 'PRODUCT' && promo.targetValue === item.id) return true;
    if (promo.targetType === 'CATEGORY' && promo.targetValue === item.category) return true;

    if (promo.targetType === 'VARIANT') {
        if (matchesAnyTargetRef(promo, item)) return true;
        return normalizeRef(promo.targetValue) !== null
            && normalizeRef(promo.targetValue) === normalizeRef(item.variantSku);
    }

    if (promo.targetType === 'BRAND') {
        if (matchesAnyTargetRef(promo, item)) return true;
        const extra = item as unknown as Record<string, unknown>;
        const itemBrand = normalizeRef(item.brandId ?? extra.brand_id);
        return itemBrand !== null && itemBrand === normalizeRef(promo.targetValue);
    }

    if (promo.targetType === 'GROUP') {
        const group = config.productGroups?.find(g => g.id === promo.targetValue);
        if (group && group.productIds.includes(item.id)) return true;
    }

    if (promo.targetType === 'SEASON') {
        const season = config.seasons?.find(s => s.id === promo.targetValue);
        if (season && season.productIds.includes(item.id)) return true;
    }

    return false;
};

// Tipos que ya otorgan un descuento al artículo: cuentan como "otra promoción" y por
// lo tanto no participan en la promoción de segundo par (sin acumulación).
const SECOND_PAIR_EXCLUDING_TYPES = new Set(['DISCOUNT', 'HAPPY_HOUR', 'CONDITIONAL_TARGET', 'BOGO']);

const itemHasExistingDiscount = (item: CartItem): boolean => (
    typeof item.originalPrice === 'number' && item.price < item.originalPrice
);

const itemHasAnotherPromotion = (
    item: CartItem,
    activePromotions: Promotion[],
    config: BusinessConfig,
    currentPromotionId: string,
): boolean => activePromotions.some(promo => (
    promo.id !== currentPromotionId
    && SECOND_PAIR_EXCLUDING_TYPES.has(promo.type)
    && itemMatchesPromotionTarget(promo, item, config)
));

/**
 * Promoción de segundo par (Opción B corregida por el cliente).
 *
 * El descuento aplica a la mitad de los pares elegibles de toda la compra, redondeando
 * hacia abajo, siempre a los de menor precio. No se forman parejas: 2 pares descuentan 1,
 * 3 descuentan 1, 4 descuentan los 2 más baratos y 5 descuentan los 2 más baratos.
 *
 * La mercancía ya rebajada (descuento manual, precio de oferta u otra promoción) no cuenta
 * para activar la promoción ni recibe el descuento. El descuento se refleja en la línea
 * afectada, de modo que el ticket muestra en qué par se aplicó.
 */
const applySecondPairPromotions = (
    cart: CartItem[],
    activePromotions: Promotion[],
    config: BusinessConfig,
): CartItem[] => {
    const secondPairPromotions = activePromotions
        .filter(promo => promo.type === 'SECOND_PAIR')
        .sort((a, b) => (b.priority || 1) - (a.priority || 1));

    if (secondPairPromotions.length === 0) return cart;

    let nextCart = cart;

    for (const promo of secondPairPromotions) {
        const minimumQuantity = promo.trigger?.type === 'ITEM_QTY' && Number(promo.trigger.value) > 0
            ? Math.max(2, Math.floor(Number(promo.trigger.value)))
            : 2;
        const discountRate = Math.max(0, Math.min(100, Number(promo.benefitValue) || 0)) / 100;

        const eligible = nextCart
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => (
                !item.appliedPromotionId
                && item.quantity > 0
                && (item.price || 0) > 0
                && !itemHasExistingDiscount(item)
                && itemMatchesPromotionTarget(promo, item, config)
                && !itemHasAnotherPromotion(item, activePromotions, config, promo.id)
            ));

        const totalUnits = eligible.reduce((sum, { item }) => sum + item.quantity, 0);
        if (discountRate <= 0 || totalUnits < minimumQuantity) continue;

        let unitsLeft = Math.floor(totalUnits / 2);
        if (unitsLeft <= 0) continue;

        const cheapestFirst = eligible
            .slice()
            .sort((a, b) => (a.item.price - b.item.price) || (a.index - b.index));

        const discountedUnitsByLine = new Map<number, number>();
        for (const { item, index } of cheapestFirst) {
            if (unitsLeft <= 0) break;
            const units = Math.min(unitsLeft, item.quantity);
            discountedUnitsByLine.set(index, units);
            unitsLeft -= units;
        }

        nextCart = nextCart.map((item, index) => {
            const discountedUnits = discountedUnitsByLine.get(index) || 0;
            if (discountedUnits <= 0) return item;

            const originalPrice = item.originalPrice ?? item.price;
            const discountedUnitPrice = originalPrice * (1 - discountRate);
            const newPrice = (
                (originalPrice * (item.quantity - discountedUnits))
                + (discountedUnitPrice * discountedUnits)
            ) / item.quantity;

            return { ...item, price: newPrice, originalPrice, appliedPromotionId: promo.id };
        });
    }

    return nextCart;
};

export const applyPromotions = (cart: CartItem[], config: BusinessConfig, terminalId: string, customer?: Customer): CartItem[] => {
    const activePromotions = config.promotions?.filter(p => {
        // 1. Check Active Status
        if (!p.schedule.isActive) return false;

        // 2. Check Schedule (Day of Week)
        const today = new Date();
        const daysMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        const currentDayKey = daysMap[today.getDay()];
        if (!p.schedule.days.includes(currentDayKey)) return false;

        // 3. Check Time Range
        const now = today.getHours() * 60 + today.getMinutes();
        const [startH, startM] = p.schedule.startTime.split(':').map(Number);
        const [endH, endM] = p.schedule.endTime.split(':').map(Number);
        const start = startH * 60 + startM;
        const end = endH * 60 + endM;
        if (now < start || now > end) return false;

        // 3.5 Check Date Range (NEW)
        if (p.schedule.startDate) {
            const startDate = new Date(p.schedule.startDate);
            startDate.setHours(0, 0, 0, 0);
            if (today < startDate) return false;
        }
        if (p.schedule.endDate) {
            const endDate = new Date(p.schedule.endDate);
            endDate.setHours(23, 59, 59, 999);
            if (today > endDate) return false;
        }

        // 4. Check Terminal Scope
        if (p.terminalIds && p.terminalIds.length > 0 && terminalId) {
            if (!p.terminalIds.includes(terminalId)) return false;
        }

        // 5. Check Loyalty Conditions (NEW)
        if (p.conditions && p.conditions.length > 0) {
            for (const condition of p.conditions) {
                if (condition.type === 'HAS_WALLET') {
                    if (!customer || !customer.wallet || customer.wallet.status !== 'ACTIVE') return false;
                }
                if (condition.type === 'CUSTOMER_TIER') {
                    if (!customer || customer.tier !== condition.value) return false;
                }
                if (condition.type === 'HAS_POINTS_MIN') {
                    const minPoints = parseInt(condition.value, 10);
                    if (!customer || (customer.loyaltyPoints || 0) < minPoints) return false;
                }
            }
        }

        return true;
    }) || [];

    if (activePromotions.length === 0) return cart;

    // Clone cart to avoid mutation
    let processedCart: CartItem[] = cart.map(item => ({ ...item, originalPrice: item.originalPrice || item.price }));

    // Segundo par: es una regla por compra (cruza líneas), así que se resuelve antes del
    // recorrido por línea. Las líneas que recibe quedan marcadas y no vuelven a descontarse.
    processedCart = applySecondPairPromotions(processedCart, activePromotions, config);

    // Apply Promotions
    // Priority: We apply the first matching promotion for simplicity in this prototype.
    // In a real system, we might want "Best Offer" logic or "Stackable" flags.

    processedCart = processedCart.map(item => {
        // Sin acumulación: la línea ya recibió el descuento del segundo par.
        if (item.appliedPromotionId) return item;

        // Find ALL applicable promotions for this item
        const applicablePromos = activePromotions.filter(p => {
            if (p.type === 'SECOND_PAIR') return false;
            return itemMatchesPromotionTarget(p, item, config);
        });

        if (applicablePromos.length === 0) return item;

        // Sort by Priority (Descending) -> Highest priority wins
        applicablePromos.sort((a, b) => (b.priority || 1) - (a.priority || 1));

        // Filter for the highest priority tier
        const highestPriority = applicablePromos[0].priority || 1;
        const topTierPromos = applicablePromos.filter(p => (p.priority || 1) === highestPriority);

        // Find the "Best Offer" among the top tier (Lowest Price)
        let bestPrice = item.price;
        let bestPromo = null;

        for (const promo of topTierPromos) {
            let tempPrice = item.price;
            switch (promo.type) {
                case 'DISCOUNT':
                    tempPrice = item.originalPrice! * (1 - promo.benefitValue / 100);
                    break;
                case 'HAPPY_HOUR':
                    tempPrice = promo.benefitValue;
                    break;
                case 'BOGO':
                    if (item.quantity >= 2) {
                        const freeItems = Math.floor(item.quantity / 2);
                        const paidItems = item.quantity - freeItems;
                        tempPrice = (item.originalPrice! * paidItems) / item.quantity;
                    }
                    break;
                case 'CONDITIONAL_TARGET':
                    // ... (Logic handled below, but we need to simulate it here for comparison)
                    // For simplicity, we'll skip complex conditional comparison in this loop 
                    // and assume if it triggers, it might be good. 
                    // Ideally, we refactor the price calculation into a helper function.
                    break;
            }

            if (tempPrice < bestPrice) {
                bestPrice = tempPrice;
                bestPromo = promo;
            }
        }

        // If we found a promo that lowers the price, use it. 
        // If no promo lowers the price (e.g. BOGO with qty 1), we stick with original.
        const applicablePromo = bestPromo || topTierPromos[0]; // Fallback to first if none lower price (or all equal)

        let newPrice = item.originalPrice!;

        switch (applicablePromo.type) {
            case 'DISCOUNT':
                newPrice = item.originalPrice! * (1 - applicablePromo.benefitValue / 100);
                break;
            case 'HAPPY_HOUR':
                // Fixed price
                newPrice = applicablePromo.benefitValue;
                break;
            case 'BOGO':
                // Logic: Buy X Get Y Free.
                // Simplified: If quantity >= 2, every 2nd item is free.
                // Effective price = (Price * (Qty - FreeQty)) / Qty
                if (item.quantity >= 2) {
                    const freeItems = Math.floor(item.quantity / 2);
                    const paidItems = item.quantity - freeItems;
                    newPrice = (item.originalPrice! * paidItems) / item.quantity;
                }
                break;

            case 'CONDITIONAL_TARGET': {
                // 1. Calculate Total Spend (based on original prices)
                const totalSpend = processedCart.reduce((sum, i) => sum + (i.originalPrice! * i.quantity), 0);

                // 2. Check Trigger
                if (applicablePromo.trigger && totalSpend >= applicablePromo.trigger.value) {
                    // 3. Find Target Item
                    let candidates = [...processedCart];

                    // Filter by Category if needed
                    if (applicablePromo.targetStrategy?.mode === 'CATEGORY_CHEAPEST') {
                        candidates = candidates.filter(i => i.category === applicablePromo.targetStrategy?.filterValue);
                    }

                    if (candidates.length > 0) {
                        // Sort candidates
                        candidates.sort((a, b) => {
                            if (applicablePromo.targetStrategy?.mode === 'MOST_EXPENSIVE_ITEM') {
                                return b.originalPrice! - a.originalPrice!;
                            }
                            return a.originalPrice! - b.originalPrice!; // CHEAPEST
                        });

                        const targetItem = candidates[0];

                        // If this is the target item, apply discount
                        // Using 'id' as unique identifier for the line item (assuming 1 line per product)
                        if (item.id === targetItem.id) {
                            newPrice = item.originalPrice! * (1 - applicablePromo.benefitValue / 100);
                        }
                    }
                }
                break;
            }
        }

        // Ensure we don't increase price (unless it's a weird happy hour)
        if (newPrice < item.originalPrice!) {
            return {
                ...item,
                price: newPrice,
                appliedPromotionId: applicablePromo.id
            };
        }

        return item;
    });

    return processedCart;
};

/**
 * Checks if a product has any active promotion applicable.
 * Used for UI badges.
 */
export const hasProductPromotion = (product: any, config: BusinessConfig, terminalId: string): boolean => {
    if (!config.promotions) return false;

    // 1. Filter Active Promotions (Same logic as above)
    const activePromotions = config.promotions.filter(p => {
        if (!p.schedule.isActive) return false;

        const today = new Date();
        const daysMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        const currentDayKey = daysMap[today.getDay()];
        if (!p.schedule.days.includes(currentDayKey)) return false;

        const now = today.getHours() * 60 + today.getMinutes();
        const [startH, startM] = p.schedule.startTime.split(':').map(Number);
        const [endH, endM] = p.schedule.endTime.split(':').map(Number);
        const start = startH * 60 + startM;
        const end = endH * 60 + endM;
        if (now < start || now > end) return false;

        // Date Range (NEW)
        if (p.schedule.startDate) {
            const startDate = new Date(p.schedule.startDate);
            startDate.setHours(0, 0, 0, 0);
            if (today < startDate) return false;
        }
        if (p.schedule.endDate) {
            const endDate = new Date(p.schedule.endDate);
            endDate.setHours(23, 59, 59, 999);
            if (today > endDate) return false;
        }

        // Terminal scope check
        if (p.terminalIds && p.terminalIds.length > 0 && terminalId) {
            if (!p.terminalIds.includes(terminalId)) return false;
        }

        return true;
    });

    // 2. Check if any active promotion targets this product
    return activePromotions.some(p => itemMatchesPromotionTarget(p, product as CartItem, config));
};
