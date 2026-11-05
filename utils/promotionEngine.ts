import { CartItem, BusinessConfig, Promotion, Customer } from '../types';
import { productReferenceCandidates as getProductReferenceCandidates } from './productReferences';

const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeMatchToken = (value: unknown): string => {
    const raw = typeof value === 'string'
        ? value.trim()
        : value != null
            ? String(value).trim()
            : '';

    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
};

const normalizeVariantToken = (value: unknown): string => (
    normalizeMatchToken(value).replace(/\s+/g, '')
);

type VariantReferenceType = 'SKU' | 'VARIANT_ID' | 'BARCODE';
type VariantPromotionMatch = {
    matchedVariantRef: string;
    matchedTargetRef: string;
    matchedVariantRefType: VariantReferenceType;
};

const collectVariantLineReferences = (item: CartItem): Array<{ value: string; type: VariantReferenceType }> => {
    const record = item as CartItem & Record<string, any>;
    const selectedVariant = record.selectedVariant && typeof record.selectedVariant === 'object'
        ? record.selectedVariant as Record<string, any>
        : {};
    const values: Array<{ value: unknown; type: VariantReferenceType }> = [
        { value: record.variantSku, type: 'SKU' },
        { value: selectedVariant.sku, type: 'SKU' },
        { value: record.variantId ?? record.variant_id, type: 'VARIANT_ID' },
        { value: selectedVariant.id ?? selectedVariant.variantId ?? selectedVariant.variant_id, type: 'VARIANT_ID' },
        { value: record.variantBarcode ?? record.variant_barcode, type: 'BARCODE' },
        ...([record.variantBarcodes, record.variant_barcodes, selectedVariant.barcode, selectedVariant.barcodes]
            .flatMap((value) => Array.isArray(value) ? value : [value])
            .map((value) => ({ value, type: 'BARCODE' as const }))),
    ];
    const seen = new Set<string>();

    return values.flatMap(({ value, type }) => {
        const normalized = normalizeVariantToken(value);
        if (!normalized || seen.has(normalized)) return [];
        seen.add(normalized);
        return [{ value: String(value).trim(), type }];
    });
};

const parentProductIdentityMatches = (item: CartItem, targetValue: unknown): boolean => {
    const record = item as CartItem & Record<string, any>;
    const nestedProduct = record.product && typeof record.product === 'object'
        ? record.product as Record<string, any>
        : {};
    const target = normalizeMatchToken(targetValue);
    if (!target) return false;

    return [
        record.id,
        record.itemId,
        record.item_id,
        record.productId,
        record.product_id,
        record.sourceProductId,
        record.source_product_id,
        record.erpProductId,
        record.erp_product_id,
        nestedProduct.id,
        nestedProduct.itemId,
        nestedProduct.item_id,
        nestedProduct.productId,
        nestedProduct.product_id,
        nestedProduct.sourceProductId,
        nestedProduct.source_product_id,
        nestedProduct.erpProductId,
        nestedProduct.erp_product_id,
    ].some((candidate) => normalizeMatchToken(candidate) === target);
};

const resolveVariantPromotionMatch = (promotion: Promotion, item: CartItem): VariantPromotionMatch | null => {
    if (promotion.targetType !== 'VARIANT') return null;
    if (!promotion.targetValue || !parentProductIdentityMatches(item, promotion.targetValue)) return null;

    const targetRefs = Array.isArray(promotion.targetRefs) ? promotion.targetRefs : [];
    const normalizedTargets = new Map<string, string>();
    targetRefs.forEach((targetRef) => {
        const token = normalizeVariantToken(targetRef);
        if (token && !normalizedTargets.has(token)) normalizedTargets.set(token, String(targetRef).trim());
    });
    if (normalizedTargets.size === 0) return null;

    for (const candidate of collectVariantLineReferences(item)) {
        const matchedTargetRef = normalizedTargets.get(normalizeVariantToken(candidate.value));
        if (!matchedTargetRef) continue;
        return {
            matchedVariantRef: candidate.value,
            matchedTargetRef,
            matchedVariantRefType: candidate.type,
        };
    }

    return null;
};

const extractReferenceStrings = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.flatMap((entry) => extractReferenceStrings(entry));
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return [
            record.id,
            record.value,
            record.code,
            record.sku,
            record.barcode,
            record.itemId,
            record.item_id,
            record.productId,
            record.product_id,
            record.sourceProductId,
            record.source_product_id,
            record.erpProductId,
            record.erp_product_id,
            record.sourceItemId,
            record.source_item_id,
            record.name,
            record.label,
            record.category,
            record.categoria,
            record.categoryId,
            record.category_id,
        ].flatMap((entry) => extractReferenceStrings(entry));
    }

    const trimmed = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
    return trimmed ? [trimmed] : [];
};

const uniqueReferences = (values: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    values.forEach((value) => {
        const token = normalizeMatchToken(value);
        if (!token || seen.has(token)) return;
        seen.add(token);
        result.push(value);
    });
    return result;
};

const asReferenceList = (values: unknown[]): string[] => uniqueReferences(values.flatMap((value) => extractReferenceStrings(value)));

const productReferenceTokens = (product: any): Set<string> => (
    new Set(getProductReferenceCandidates(product).map(normalizeMatchToken).filter(Boolean))
);

const productMatchesAnyReference = (product: any, values: unknown[]): boolean => {
    const productTokens = productReferenceTokens(product);
    if (productTokens.size === 0) return false;

    return asReferenceList(values).some((value) => productTokens.has(normalizeMatchToken(value)));
};

const productMatchesReferenceList = (product: any, values?: unknown[]): boolean => {
    if (!Array.isArray(values) || values.length === 0) return false;
    return productMatchesAnyReference(product, values);
};

const productCategoryCandidates = (product: any): string[] => (
    asReferenceList([
        product?.category,
        product?.categoria,
        product?.posCategoryName,
        product?.pos_category_name,
        product?.posCategoryId,
        product?.pos_category_id,
        product?.categoryId,
        product?.category_id,
    ])
);

const comparableCategoryTokens = (value: unknown): string[] => {
    const token = normalizeMatchToken(value);
    if (!token) return [];

    const singularOrPlural = token.length > 3
        ? (token.endsWith('s') ? token.slice(0, -1) : `${token}s`)
        : token;

    return Array.from(new Set([token, singularOrPlural].filter(Boolean)));
};

const productMatchesCategory = (product: any, categoryRef: unknown): boolean => {
    const targetTokens = new Set(comparableCategoryTokens(categoryRef));
    if (targetTokens.size === 0) return false;

    return productCategoryCandidates(product).some((candidate) => (
        comparableCategoryTokens(candidate).some((token) => targetTokens.has(token))
    ));
};

const asNumber = (value: unknown, fallback = 0): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const promotionTriggerConfig = (promotion: Promotion): Record<string, any> => {
    const record = promotion as any;
    const config = record.trigger_config ?? record.triggerConfig;
    return config && typeof config === 'object' ? config : {};
};

const itemPromotionBasePrice = (item: CartItem): number => (
    item.adjustmentSource === 'TARIFF'
        ? item.price
        : (item.originalPrice || item.price)
);

const cartPromotionBaseTotal = (cart: CartItem[]): number => (
    cart.reduce((sum, item) => sum + (itemPromotionBasePrice(item) * item.quantity), 0)
);

const promotionSelectionGroupsMatch = (cart: CartItem[], groups: any[]): boolean => {
    if (!Array.isArray(groups) || groups.length === 0) return false;

    return groups.every((group) => {
        const categoryId = group?.category_id ?? group?.categoryId;
        const requiredQuantity = asNumber(group?.required_quantity ?? group?.requiredQuantity, 0);
        if (!categoryId || requiredQuantity <= 0) return false;

        const categoryQuantity = cart.reduce((sum, item) => (
            productMatchesCategory(item, categoryId) ? sum + item.quantity : sum
        ), 0);

        return categoryQuantity >= requiredQuantity;
    });
};

const itemMatchesSelectionGroups = (item: CartItem, groups: any[]): boolean => (
    Array.isArray(groups) && groups.some((group) => productMatchesCategory(item, group?.category_id ?? group?.categoryId))
);

const mixAndMatchEligibleTotal = (cart: CartItem[], groups: any[]): number => (
    cart.reduce((sum, item) => (
        itemMatchesSelectionGroups(item, groups)
            ? sum + (itemPromotionBasePrice(item) * item.quantity)
            : sum
    ), 0)
);

const tieredQuantityDiscountPercent = (promotion: Promotion, quantity: number): number => {
    const ranges = promotionTriggerConfig(promotion).tiered_quantity_ranges;
    if (!Array.isArray(ranges)) return 0;

    const matchingRanges = ranges
        .map((range) => ({
            minQty: asNumber(range?.min_qty ?? range?.minQty, 0),
            maxQty: asNumber(range?.max_qty ?? range?.maxQty, 0),
            discountPercent: asNumber(range?.discount_percent ?? range?.discountPercent, 0),
        }))
        .filter((range) => (
            quantity >= range.minQty
            && (range.maxQty === 0 || quantity <= range.maxQty)
            && range.discountPercent > 0
        ));

    if (matchingRanges.length === 0) return 0;
    matchingRanges.sort((a, b) => b.minQty - a.minQty);
    return matchingRanges[0].discountPercent;
};

const promotionTargetsByTriggerConfig = (promotion: Promotion, product: any): boolean => {
    const config = promotionTriggerConfig(promotion);

    if (promotion.type === 'GIFT_WITH_PURCHASE') {
        return productMatchesAnyReference(product, [config.gift_product_id ?? config.giftProductId]);
    }

    if (promotion.type === 'PREPAID_PACKAGE') {
        return productMatchesAnyReference(product, [config.service_id ?? config.serviceId]);
    }

    if (promotion.type === 'MIX_AND_MATCH') {
        return itemMatchesSelectionGroups(product, config.selection_groups ?? config.selectionGroups);
    }

    return false;
};

const promotionAppliesToCartItem = (promotion: Promotion, item: CartItem, config: BusinessConfig): boolean => {
    if (promotion.type === 'PAYMENT_METHOD_DISCOUNT' || promotion.type === 'NEXT_PURCHASE_COUPON') {
        return false;
    }

    if (
        promotion.type === 'GIFT_WITH_PURCHASE'
        || promotion.type === 'PREPAID_PACKAGE'
        || promotion.type === 'MIX_AND_MATCH'
    ) {
        return promotionTargetsByTriggerConfig(promotion, item);
    }

    return promotionTargetsProduct(promotion, item, config) || promotionTargetsByTriggerConfig(promotion, item);
};

const terminalReferenceCandidates = (config: BusinessConfig, terminalId: string): string[] => {
    const normalizedRequestedId = String(terminalId || '').trim();
    const terminals = Array.isArray(config.terminals) ? config.terminals : [];
    const matchedTerminal = terminals.find((terminal) => {
        const localId = String(terminal?.id || '').trim();
        const erpTerminalId = String(terminal?.config?.erpTerminalId || terminal?.config?.erpBinding?.terminalId || '').trim();
        const terminalName = String(terminal?.config?.terminalName || terminal?.config?.erpBinding?.terminalName || '').trim();
        const stationNumber = String(terminal?.config?.stationNumber || terminal?.config?.erpBinding?.stationNumber || '').trim();
        const terminalConfig = terminal?.config as any;
        const deviceId = String(terminalConfig?.currentDeviceId || terminalConfig?.deviceId || terminalConfig?.erpBinding?.deviceId || '').trim();

        return [localId, erpTerminalId, terminalName, stationNumber, deviceId].filter(Boolean).includes(normalizedRequestedId);
    });

    if (!matchedTerminal) {
        return normalizedRequestedId ? [normalizedRequestedId] : [];
    }

    return [
        normalizedRequestedId,
        String(matchedTerminal.id || '').trim(),
        String(matchedTerminal.config?.erpTerminalId || '').trim(),
        String(matchedTerminal.config?.terminalName || '').trim(),
        String(matchedTerminal.config?.stationNumber || '').trim(),
        String((matchedTerminal as any).name || '').trim(),
        String((matchedTerminal as any).label || '').trim(),
        String((matchedTerminal as any).code || '').trim(),
        String(matchedTerminal.config?.currentDeviceId || '').trim(),
        String((matchedTerminal.config as any)?.deviceId || '').trim(),
        String(matchedTerminal.config?.erpBinding?.terminalId || '').trim(),
        String(matchedTerminal.config?.erpBinding?.terminalName || '').trim(),
        String(matchedTerminal.config?.erpBinding?.stationNumber || '').trim(),
        String((matchedTerminal.config?.erpBinding as any)?.deviceId || '').trim(),
    ].filter(Boolean);
};

const promotionMatchesTerminalScope = (promotion: Promotion, config: BusinessConfig, terminalId: string): boolean => {
    // El ERP puede enviar el alcance como `terminalIds` o `terminal_ids`. Al leer
    // solo la forma camelCase, una promoción limitada a una caja se aplicaba en
    // todas (se veía como "aplica a todas" sin serlo).
    const scope = (promotion as unknown as { terminal_ids?: unknown }).terminal_ids;
    const declared = Array.isArray(promotion.terminalIds) && promotion.terminalIds.length > 0
        ? promotion.terminalIds
        : (Array.isArray(scope) ? scope as unknown[] : []);

    if (declared.length === 0 || !terminalId) {
        return true;
    }

    const promotionTerminalIds = new Set(asReferenceList(declared).map(normalizeMatchToken));

    return terminalReferenceCandidates(config, terminalId).some((candidate) => promotionTerminalIds.has(normalizeMatchToken(candidate)));
};

const promotionMatchesResolvedRefs = (promotion: Promotion, product: any): boolean => {
    const refs = Array.isArray(promotion.targetRefs) ? promotion.targetRefs.filter(Boolean) : [];
    if (refs.length === 0) return false;
    return productMatchesReferenceList(product, refs);
};

const promotionMatchesTargetReference = (promotion: Promotion, product: any): boolean => (
    productMatchesAnyReference(product, [promotion.targetValue])
    || productMatchesAnyReference(product, [promotion.targetLabel])
    || promotionMatchesResolvedRefs(promotion, product)
);

const promotionMatchesCategoryTarget = (promotion: Promotion, product: any): boolean => (
    productMatchesCategory(product, promotion.targetValue)
    || productMatchesCategory(product, promotion.targetLabel)
    || (Array.isArray(promotion.targetRefs) && promotion.targetRefs.some((ref) => productMatchesCategory(product, ref)))
);

/**
 * Coincide `promotion.targetRefs` contra los refs de la variante de la línea
 * (SKU, id de variante y código de barra), sin exigir `targetValue`.
 */
const variantLineMatchesResolvedRefs = (promotion: Promotion, item: CartItem): boolean => {
    const targetRefs = Array.isArray(promotion.targetRefs) ? promotion.targetRefs : [];
    if (targetRefs.length === 0) return false;
    const normalizedTargets = new Set(targetRefs.map(normalizeVariantToken).filter(Boolean));
    if (normalizedTargets.size === 0) return false;
    return collectVariantLineReferences(item).some(ref => normalizedTargets.has(normalizeVariantToken(ref.value)));
};

/**
 * Objetivo BRAND (EGO Club T1): el ERP hidrata `targetRefs` con los ids/SKUs/códigos
 * de todos los ítems de la marca; como respaldo se compara `brandId`/`brand_id`.
 */
const promotionMatchesBrandTarget = (promotion: Promotion, product: any): boolean => {
    if (promotionMatchesResolvedRefs(promotion, product)) return true;
    if (variantLineMatchesResolvedRefs(promotion, product)) return true;
    const brand = normalizeMatchToken(product?.brandId ?? product?.brand_id);
    if (!brand) return false;
    return brand === normalizeMatchToken(promotion.targetValue)
        || brand === normalizeMatchToken(promotion.targetLabel);
};

const productBelongsToReferenceGroup = (product: any, productIds?: unknown[]): boolean => (
    productMatchesReferenceList(product, Array.isArray(productIds) ? productIds : [])
);

const entityReferenceCandidates = (entity: any): string[] => (
    asReferenceList([
        entity?.id,
        entity?.code,
        entity?.name,
        entity?.label,
        entity?.externalCode,
        entity?.external_code,
        entity?.erpId,
        entity?.erp_id,
    ])
);

const promotionTargetCandidateRefs = (promotion: Promotion): string[] => (
    asReferenceList([promotion.targetValue, promotion.targetLabel])
);

const entityMatchesPromotionTarget = (entity: any, promotion: Promotion): boolean => {
    const entityTokens = new Set(entityReferenceCandidates(entity).map(normalizeMatchToken));
    if (entityTokens.size === 0) return false;
    return promotionTargetCandidateRefs(promotion).some((ref) => entityTokens.has(normalizeMatchToken(ref)));
};

const findPromotionGroup = (promotion: Promotion, config: BusinessConfig): any | undefined => (
    (config.productGroups || []).find((group: any) => entityMatchesPromotionTarget(group, promotion))
);

const findPromotionSeason = (promotion: Promotion, config: BusinessConfig): any | undefined => (
    (config.seasons || []).find((season: any) => entityMatchesPromotionTarget(season, promotion))
);

const normalizeScheduleDayKey = (value: unknown): string => {
    const token = normalizeMatchToken(value);
    const map: Record<string, string> = {
        '0': 'D',
        '1': 'L',
        '2': 'M',
        '3': 'X',
        '4': 'J',
        '5': 'V',
        '6': 'S',
        d: 'D',
        dom: 'D',
        domingo: 'D',
        sunday: 'D',
        sun: 'D',
        l: 'L',
        lun: 'L',
        lunes: 'L',
        monday: 'L',
        mon: 'L',
        m: 'M',
        mar: 'M',
        martes: 'M',
        tuesday: 'M',
        tue: 'M',
        x: 'X',
        mie: 'X',
        miercoles: 'X',
        wednesday: 'X',
        wed: 'X',
        j: 'J',
        jue: 'J',
        jueves: 'J',
        thursday: 'J',
        thu: 'J',
        v: 'V',
        vie: 'V',
        viernes: 'V',
        friday: 'V',
        fri: 'V',
        s: 'S',
        sab: 'S',
        sabado: 'S',
        saturday: 'S',
        sat: 'S',
    };
    return map[token] || '';
};

const promotionMatchesCurrentDay = (promotion: Promotion): boolean => {
    const days = Array.isArray(promotion.schedule?.days) ? promotion.schedule.days : [];
    const normalizedDays = days
        .map((day) => normalizeScheduleDayKey(day))
        .filter(Boolean);

    if (normalizedDays.length === 0) return true;

    const today = new Date();
    const daysMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    return normalizedDays.includes(daysMap[today.getDay()]);
};

const minutesFromTime = (value: unknown): number | null => {
    const raw = typeof value === 'string' ? value.trim() : '';
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
};

const promotionMatchesCurrentTime = (promotion: Promotion): boolean => {
    const start = minutesFromTime(promotion.schedule?.startTime);
    const end = minutesFromTime(promotion.schedule?.endTime);
    if (start == null || end == null) return true;

    const today = new Date();
    const now = today.getHours() * 60 + today.getMinutes();
    return start <= end
        ? now >= start && now <= end
        : now >= start || now <= end;
};

const promotionMatchesDateRange = (promotion: Promotion): boolean => {
    const today = new Date();
    if (promotion.schedule?.startDate) {
        const startDate = new Date(promotion.schedule.startDate);
        if (!Number.isNaN(startDate.getTime())) {
            startDate.setHours(0, 0, 0, 0);
            if (today < startDate) return false;
        }
    }
    if (promotion.schedule?.endDate) {
        const endDate = new Date(promotion.schedule.endDate);
        if (!Number.isNaN(endDate.getTime())) {
            endDate.setHours(23, 59, 59, 999);
            if (today > endDate) return false;
        }
    }
    return true;
};

/** Normaliza el nivel del cliente a la forma que usa el ERP ("GOLD", "BLACK", "STANDARD"). */
export const normalizeLoyaltyTier = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toUpperCase();
    return text.length > 0 ? text : null;
};

/** Niveles declarados en la audiencia de la promoción, normalizados. */
const promotionAudienceTiers = (promo: Promotion): string[] => {
    const tiers = promo.audience?.tiers;
    if (!Array.isArray(tiers)) return [];
    return tiers.map(tier => normalizeLoyaltyTier(tier)).filter((tier): tier is string => tier !== null);
};

/**
 * Audiencia por nivel EGO Club (T2).
 *
 * Sin `audience.tiers` (o con la lista vacía) la promoción aplica a todos. Con
 * audiencia declarada y ticket sin cliente identificado NO aplica: no se asume
 * STANDARD por defecto.
 */
export const promotionMatchesAudience = (promo: Promotion, customer?: Customer): boolean => {
    const tiers = promotionAudienceTiers(promo);
    if (tiers.length === 0) return true;

    const customerTier = normalizeLoyaltyTier(customer?.tier);
    if (!customerTier) return false;

    return tiers.includes(customerTier);
};

const promotionIsCurrentlyEligible = (promotion: Promotion, config: BusinessConfig, terminalId: string, customer?: Customer): boolean => {
    if (!isPromotionActive(promotion)) return false;
    if (!promotionMatchesCurrentDay(promotion)) return false;
    if (!promotionMatchesCurrentTime(promotion)) return false;
    if (!promotionMatchesDateRange(promotion)) return false;
    if (!promotionMatchesTerminalScope(promotion, config, terminalId)) return false;
    if (!promotionMatchesAudience(promotion, customer)) return false;

    if (promotion.conditions && promotion.conditions.length > 0) {
        for (const condition of promotion.conditions) {
            if (condition.type === 'HAS_WALLET' && (!customer || !customer.wallet || customer.wallet.status !== 'ACTIVE')) return false;
            if (condition.type === 'CUSTOMER_TIER' && (!customer || customer.tier !== condition.value)) return false;
            if (condition.type === 'HAS_POINTS_MIN' && (!customer || (customer.loyaltyPoints || 0) < parseInt(condition.value, 10))) return false;
            // MIN_QUANTITY se evalúa por línea en `promotionMeetsQuantityRule`.
        }
    }

    return true;
};

/**
 * Reglas de cantidad mínima.
 *
 * El POS no tenía forma de expresar promociones como "segundo par 30%": solo
 * condiciones de cliente. Si el ERP no declara la cantidad, la promoción se
 * aplica desde la primera unidad (comportamiento anterior, sin cambios).
 *
 * Se aceptan las claves habituales del ERP para no atarse a una sola forma.
 */
const resolvePromotionMinQuantity = (promotion: Promotion): number => {
    const rawTrigger = promotion.triggerConfig ?? promotion.trigger_config;
    const trigger: Record<string, unknown> = rawTrigger && typeof rawTrigger === 'object' && !Array.isArray(rawTrigger)
        ? rawTrigger as Record<string, unknown>
        : {};
    const candidates = [
        trigger.minQuantity, trigger.min_quantity, trigger.minUnits, trigger.min_units,
        trigger.quantity, trigger.bundleSize, trigger.bundle_size,
    ];
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    const condition = (promotion.conditions || []).find(entry => entry?.type === 'MIN_QUANTITY');
    const fromCondition = Number(condition?.value);
    return Number.isFinite(fromCondition) && fromCondition > 0 ? Math.floor(fromCondition) : 0;
};

/**
 * Regla "Segundo par" del ERP.
 *
 * No es un descuento plano: con N pares elegibles descuenta floor(N/2) pares,
 * empezando por los más baratos, y exige un mínimo de pares (2 por defecto).
 * El POS la estaba tratando como DISCOUNT%, así que rebajaba todas las líneas.
 */
const SECOND_PAIR_RULE_KEYS = new Set(['SEGUNDO_PAR', 'SEGUNDO PAR', 'SECOND_PAIR', 'SECOND PAIR', 'SECOND_UNIT']);

const resolveSecondPairRule = (promotion: Promotion): { minPairs: number } | null => {
    const rawTrigger = promotion.triggerConfig ?? promotion.trigger_config;
    const trigger: Record<string, unknown> = rawTrigger && typeof rawTrigger === 'object' && !Array.isArray(rawTrigger)
        ? rawTrigger as Record<string, unknown>
        : {};
    const ruleTokens = [
        String((promotion as unknown as { type?: unknown }).type ?? ''),
        String(trigger.rule ?? ''),
        String(trigger.ruleType ?? ''),
        String(trigger.rule_type ?? ''),
        String(trigger.promotionRule ?? ''),
    ].map((value) => value.trim().toUpperCase());
    if (!ruleTokens.some((token) => SECOND_PAIR_RULE_KEYS.has(token))) return null;
    return { minPairs: Math.max(2, resolvePromotionMinQuantity(promotion) || 2) };
};

const promotionMeetsQuantityRule = (promotion: Promotion, item: CartItem): boolean => {
    const minQuantity = resolvePromotionMinQuantity(promotion);
    if (minQuantity <= 0) return true;
    return Math.abs(Number(item.quantity) || 0) >= minQuantity;
};

const promotionTargetsProduct = (promotion: Promotion, product: any, config: BusinessConfig): boolean => {
    if (promotion.targetType === 'ALL') return true;
    if (promotion.targetType === 'PRODUCT') return promotionMatchesTargetReference(promotion, product);
    if (promotion.targetType === 'VARIANT') {
        // Semántica de develop (parent product + variante) y respaldo de EGO Club T1:
        // sin `targetValue`, coincide por `targetRefs` contra los refs de la variante.
        return Boolean(resolveVariantPromotionMatch(promotion, product)) || variantLineMatchesResolvedRefs(promotion, product);
    }
    if (promotion.targetType === 'BRAND') return promotionMatchesBrandTarget(promotion, product);
    if (promotion.targetType === 'CATEGORY') return promotionMatchesCategoryTarget(promotion, product);

    if (promotion.targetType === 'GROUP') {
        const group = findPromotionGroup(promotion, config);
        if (group && productBelongsToReferenceGroup(product, group.productIds)) return true;
        return promotionMatchesTargetReference(promotion, product);
    }

    if (promotion.targetType === 'SEASON') {
        const season = findPromotionSeason(promotion, config);
        if (season && productBelongsToReferenceGroup(product, season.productIds)) return true;
        return promotionMatchesTargetReference(promotion, product);
    }

    return false;
};

/** Compatibilidad con el contrato de EGO Club (T1): una línea participa del objetivo. */
export const itemMatchesPromotionTarget = (promo: Promotion, item: CartItem, config: BusinessConfig): boolean => (
    promotionTargetsProduct(promo, item, config)
);

const isPromotionActive = (promotion: Promotion): boolean => promotion.schedule?.isActive !== false;

export const applyPromotions = (cart: CartItem[], config: BusinessConfig, terminalId: string, customer?: Customer): CartItem[] => {
    const activePromotions = config.promotions?.filter(p => promotionIsCurrentlyEligible(p, config, terminalId, customer)) || [];

    if (activePromotions.length === 0) return cart;

    // Clone cart to avoid mutation
    let processedCart = cart.map(item => ({ ...item }));

    // Promociones con regla de cantidad ("segundo par 30%"): el umbral se mide
    // sobre el ticket completo, no por línea, y se aplican una sola vez.
    const cartUnitsForPromotion = (promo: Promotion): number => (
        processedCart.reduce((sum, item) => {
            if (Math.abs(Number(item.quantity) || 0) === 0) return sum;
            if (!promotionAppliesToCartItem(promo, item, config)) return sum;
            return sum + Math.abs(Number(item.quantity) || 0);
        }, 0)
    );
    const consumedQuantityPromotions = new Set<string>();

    // Apply Promotions
    // Priority: We apply the first matching promotion for simplicity in this prototype.
    // In a real system, we might want "Best Offer" logic or "Stackable" flags.

    // --- Regla "segundo par": se resuelve a nivel de ticket ---
    for (const promo of activePromotions) {
        const rule = resolveSecondPairRule(promo);
        if (!rule) continue;

        const candidates = processedCart
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => (Number(item.quantity) || 0) > 0 && promotionAppliesToCartItem(promo, item, config));

        const totalPairs = candidates.reduce((sum, { item }) => sum + Math.abs(Number(item.quantity) || 0), 0);
        if (totalPairs < rule.minPairs) continue;

        // floor(N/2) pares con descuento, empezando por el más barato.
        let pairsToDiscount = Math.floor(totalPairs / 2);
        const cheapestFirst = [...candidates].sort((a, b) => a.item.price - b.item.price);

        for (const { item } of cheapestFirst) {
            if (pairsToDiscount <= 0) break;
            const quantity = Math.abs(Number(item.quantity) || 0);
            if (quantity > pairsToDiscount) continue; // solo pares completos
            const basePrice = item.originalPrice || item.price;
            const discountFactor = 1 - promo.benefitValue / 100;
            item.price = round2(basePrice * discountFactor);
            item.originalPrice = basePrice;
            item.adjustmentSource = 'PROMOTION';
            item.appliedPromotionId = promo.id;
            item.appliedPromotionName = promo.name;
            pairsToDiscount -= quantity;
        }
        consumedQuantityPromotions.add(promo.id);
    }

    processedCart = processedCart.map(item => {
        // Find ALL applicable promotions for this item
        const applicablePromos = activePromotions.filter(p => {
            if (!promotionAppliesToCartItem(p, item, config)) return false;
            const minQuantity = resolvePromotionMinQuantity(p);
            if (minQuantity <= 0) return promotionMeetsQuantityRule(p, item);
            if (consumedQuantityPromotions.has(p.id)) return false;
            return cartUnitsForPromotion(p) >= minQuantity;
        });

        if (
            item.adjustmentSource === 'MANUAL_DISCOUNT'
            || item.adjustmentSource === 'MANUAL_PRICE_OVERRIDE'
        ) {
            return item;
        }

        if (applicablePromos.length === 0) return item;

        const promotionBasePrice =
            item.adjustmentSource === 'TARIFF'
                ? item.price
                : (item.originalPrice || item.price);

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
                    tempPrice = promotionBasePrice * (1 - promo.benefitValue / 100);
                    break;
                case 'HAPPY_HOUR':
                    tempPrice = promo.benefitValue;
                    break;
                case 'BOGO':
                    if (item.quantity >= 2) {
                        const freeItems = Math.floor(item.quantity / 2);
                        const paidItems = item.quantity - freeItems;
                        tempPrice = (promotionBasePrice * paidItems) / item.quantity;
                    }
                    break;
                case 'CONDITIONAL_TARGET':
                    // ... (Logic handled below, but we need to simulate it here for comparison)
                    // For simplicity, we'll skip complex conditional comparison in this loop 
                    // and assume if it triggers, it might be good. 
                    // Ideally, we refactor the price calculation into a helper function.
                    break;
                case 'TIERED_QUANTITY': {
                    const discountPercent = tieredQuantityDiscountPercent(promo, item.quantity);
                    if (discountPercent > 0) {
                        tempPrice = promotionBasePrice * (1 - discountPercent / 100);
                    }
                    break;
                }
                case 'MIX_AND_MATCH': {
                    const triggerConfig = promotionTriggerConfig(promo);
                    const groups = triggerConfig.selection_groups ?? triggerConfig.selectionGroups;
                    const priceFixed = asNumber(triggerConfig.price_fixed ?? triggerConfig.priceFixed, 0);
                    const eligibleTotal = mixAndMatchEligibleTotal(processedCart, groups);
                    if (
                        priceFixed > 0
                        && eligibleTotal > priceFixed
                        && promotionSelectionGroupsMatch(processedCart, groups)
                        && itemMatchesSelectionGroups(item, groups)
                    ) {
                        tempPrice = promotionBasePrice * (priceFixed / eligibleTotal);
                    }
                    break;
                }
                case 'GIFT_WITH_PURCHASE': {
                    const triggerConfig = promotionTriggerConfig(promo);
                    const minimumTicketValue = asNumber(triggerConfig.minimum_ticket_value ?? triggerConfig.minimumTicketValue, 0);
                    if (
                        item.quantity > 0
                        && cartPromotionBaseTotal(processedCart) >= minimumTicketValue
                        && productMatchesAnyReference(item, [triggerConfig.gift_product_id ?? triggerConfig.giftProductId])
                    ) {
                        tempPrice = promotionBasePrice * Math.max(item.quantity - 1, 0) / item.quantity;
                    }
                    break;
                }
                case 'PREPAID_PACKAGE': {
                    const triggerConfig = promotionTriggerConfig(promo);
                    const totalSessions = asNumber(triggerConfig.total_sessions ?? triggerConfig.totalSessions, 0);
                    const pricePackage = asNumber(triggerConfig.price_package ?? triggerConfig.pricePackage, 0);
                    if (
                        totalSessions > 0
                        && pricePackage > 0
                        && item.quantity >= totalSessions
                        && productMatchesAnyReference(item, [triggerConfig.service_id ?? triggerConfig.serviceId])
                    ) {
                        tempPrice = pricePackage / totalSessions;
                    }
                    break;
                }
                case 'PAYMENT_METHOD_DISCOUNT':
                case 'NEXT_PURCHASE_COUPON':
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

        // Si la promoción exige cantidad, queda consumida: solo una línea del
        // ticket recibe el beneficio (el "segundo par", no los dos pares).
        if (resolvePromotionMinQuantity(applicablePromo) > 0) {
            consumedQuantityPromotions.add(applicablePromo.id);
        }

        let newPrice = promotionBasePrice;

        switch (applicablePromo.type) {
            case 'DISCOUNT':
                newPrice = promotionBasePrice * (1 - applicablePromo.benefitValue / 100);
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
                    newPrice = (promotionBasePrice * paidItems) / item.quantity;
                }
                break;

            case 'CONDITIONAL_TARGET':
                // 1. Calculate Total Spend (based on original prices)
                const totalSpend = processedCart.reduce((sum, i) => {
                    const basePrice = i.adjustmentSource === 'TARIFF' ? i.price : (i.originalPrice || i.price);
                    return sum + (basePrice * i.quantity);
                }, 0);

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
                                const priceA = a.adjustmentSource === 'TARIFF' ? a.price : (a.originalPrice || a.price);
                                const priceB = b.adjustmentSource === 'TARIFF' ? b.price : (b.originalPrice || b.price);
                                return priceB - priceA;
                            }
                            const priceA = a.adjustmentSource === 'TARIFF' ? a.price : (a.originalPrice || a.price);
                            const priceB = b.adjustmentSource === 'TARIFF' ? b.price : (b.originalPrice || b.price);
                            return priceA - priceB; // CHEAPEST
                        });

                        const targetItem = candidates[0];

                        // If this is the target item, apply discount
                        // Using 'id' as unique identifier for the line item (assuming 1 line per product)
                        if (item.id === targetItem.id) {
                            newPrice = promotionBasePrice * (1 - applicablePromo.benefitValue / 100);
                        }
                    }
                }
                break;
            case 'TIERED_QUANTITY': {
                const discountPercent = tieredQuantityDiscountPercent(applicablePromo, item.quantity);
                if (discountPercent > 0) {
                    newPrice = promotionBasePrice * (1 - discountPercent / 100);
                }
                break;
            }
            case 'MIX_AND_MATCH': {
                const triggerConfig = promotionTriggerConfig(applicablePromo);
                const groups = triggerConfig.selection_groups ?? triggerConfig.selectionGroups;
                const priceFixed = asNumber(triggerConfig.price_fixed ?? triggerConfig.priceFixed, 0);
                const eligibleTotal = mixAndMatchEligibleTotal(processedCart, groups);
                if (
                    priceFixed > 0
                    && eligibleTotal > priceFixed
                    && promotionSelectionGroupsMatch(processedCart, groups)
                    && itemMatchesSelectionGroups(item, groups)
                ) {
                    newPrice = promotionBasePrice * (priceFixed / eligibleTotal);
                }
                break;
            }
            case 'GIFT_WITH_PURCHASE': {
                const triggerConfig = promotionTriggerConfig(applicablePromo);
                const minimumTicketValue = asNumber(triggerConfig.minimum_ticket_value ?? triggerConfig.minimumTicketValue, 0);
                if (
                    item.quantity > 0
                    && cartPromotionBaseTotal(processedCart) >= minimumTicketValue
                    && productMatchesAnyReference(item, [triggerConfig.gift_product_id ?? triggerConfig.giftProductId])
                ) {
                    newPrice = promotionBasePrice * Math.max(item.quantity - 1, 0) / item.quantity;
                }
                break;
            }
            case 'PREPAID_PACKAGE': {
                const triggerConfig = promotionTriggerConfig(applicablePromo);
                const totalSessions = asNumber(triggerConfig.total_sessions ?? triggerConfig.totalSessions, 0);
                const pricePackage = asNumber(triggerConfig.price_package ?? triggerConfig.pricePackage, 0);
                if (
                    totalSessions > 0
                    && pricePackage > 0
                    && item.quantity >= totalSessions
                    && productMatchesAnyReference(item, [triggerConfig.service_id ?? triggerConfig.serviceId])
                ) {
                    newPrice = pricePackage / totalSessions;
                }
                break;
            }
            case 'PAYMENT_METHOD_DISCOUNT':
            case 'NEXT_PURCHASE_COUPON':
                break;
        }

        // Ensure we don't increase price (unless it's a weird happy hour)
        if (newPrice < promotionBasePrice) {
            const safeRate = promotionBasePrice > 0
                ? round4((promotionBasePrice - newPrice) / promotionBasePrice)
                : undefined;
            const variantMatch = resolveVariantPromotionMatch(applicablePromo, item);
            return {
                ...item,
                price: round2(newPrice),
                originalPrice: round2(promotionBasePrice),
                discountAmount: round2((promotionBasePrice - newPrice) * item.quantity),
                discountRate: safeRate,
                adjustmentSource: 'PROMOTION',
                appliedPromotionId: applicablePromo.id,
                appliedPromotionCode: applicablePromo.id,
                appliedPromotionName: applicablePromo.name,
                promotionTrace: {
                    promotionId: applicablePromo.id,
                    targetType: applicablePromo.targetType,
                    targetValue: applicablePromo.targetValue,
                    ...(variantMatch || {}),
                },
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
export const hasProductPromotion = (product: any, config: BusinessConfig, terminalId: string, customer?: Customer): boolean => {
    if (!config.promotions) return false;

    const activePromotions = config.promotions.filter(p => promotionIsCurrentlyEligible(p, config, terminalId, customer));

    // 2. Check if any active promotion targets this product
    return activePromotions.some(p => {
        return promotionAppliesToCartItem(p, product, config);
    });
};
