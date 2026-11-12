/**
 * KioskProductBrowser
 *
 * Product scanning and browsing interface for self-checkout.
 * Touch-first layout optimized for vertical kiosks.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  X,
  Scale,
  Minus,
  ChevronRight,
  Tag,
  CreditCard,
  Sparkles
} from 'lucide-react';
import { Product, CartItem, BusinessConfig, ProductPrice, Tariff, Warehouse, Customer, RedeemedCouponRef } from '../../types';
import { hasProductPromotion } from '../../utils/promotionEngine';
import { parseScaleBarcode } from '../../utils/barcodeParser';
import { db } from '../../utils/db';
import { resolveProductImageSrc } from '../../utils/entityImage';
import { resolveProductActiveWarehouseIds } from '../../utils/masterIdentity';
import { productIdentityCandidates, resolveOperationalProductId } from '../../utils/productReferences';
import PromoBottomSheet from '../PromoBottomSheet';
import SecurityOverlay from './SecurityOverlay';
import { useKioskSecurityContext } from './KioskContext';

const normalizeToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : value != null ? String(value).trim().toLowerCase() : '';

const productSalesIdentityKey = (product: Product): string => {
  const operationalId = resolveOperationalProductId(product);
  if (operationalId) return `op:${operationalId}`;

  const normalizedId = normalizeToken(product.id);
  const identityCandidate = productIdentityCandidates(product)
    .map(normalizeToken)
    .find((value) => value && value !== normalizedId);
  if (identityCandidate) return `identity:${identityCandidate}`;

  const barcode = normalizeToken(product.barcode);
  if (barcode) return `barcode:${barcode}`;

  const sku = normalizeToken((product as any).sku);
  if (sku) return `sku:${sku}`;

  const code = normalizeToken((product as any).code);
  if (code) return `code:${code}`;

  const name = normalizeToken(product.name);
  const category = normalizeToken(product.category);
  if (name) return `namecat:${name}::${category}`;

  return `id:${normalizedId}`;
};

const isSeedCatalogProduct = (product: Product): boolean => {
  const id = normalizeToken(product.id);
  return /^prod-\d+$/.test(id) || /^p\d+$/.test(id) || /^f\d+$/.test(id);
};

const productBusinessKeys = (product: Product): string[] => {
  const keys = new Set<string>();
  const barcode = normalizeToken(product.barcode);
  const sku = normalizeToken((product as any).sku);
  const code = normalizeToken((product as any).code);
  const itemCode = normalizeToken((product as any).item_code);
  const name = normalizeToken(product.name);
  const category = normalizeToken(product.category);

  if (barcode) keys.add(`barcode:${barcode}`);
  if (sku) keys.add(`sku:${sku}`);
  if (code) keys.add(`code:${code}`);
  if (itemCode) keys.add(`item_code:${itemCode}`);
  if (name) keys.add(`namecat:${name}::${category}`);

  return Array.from(keys);
};

const scoreProductForSales = (product: Product, warehouses: Warehouse[]): number => {
  const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses).length;
  const stockBalanceCount = Object.keys(product.stockBalances || {}).length;
  const updatedAtScore = new Date((product as any).updatedAt || (product as any).createdAt || 0).getTime() || 0;
  const seedPenalty = isSeedCatalogProduct(product) ? -50_000 : 0;

  return (
    seedPenalty +
    activeWarehouses * 1000 +
    stockBalanceCount * 100 +
    (product.is_sellable !== false ? 10 : 0) +
    (Number.isFinite(Number(product.price)) ? 1 : 0) +
    updatedAtScore / 1_000_000_000_000
  );
};

interface KioskProductBrowserProps {
  products: Product[];
  warehouses: Warehouse[];
  cart: CartItem[];
  onAddToCart: (product: Product, quantity?: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onCheckout: () => void;
  onCancel: () => void;
  config: BusinessConfig;
  terminalId?: string;
  customerConfidenceIndex?: number;
  selectedCustomer?: Customer | null;
  redeemedCoupon?: RedeemedCouponRef | null;
}

const KioskProductBrowser: React.FC<KioskProductBrowserProps> = ({
  products,
  warehouses,
  cart,
  onAddToCart,
  onRemoveFromCart,
  onCheckout,
  onCancel,
  config,
  terminalId,
  customerConfidenceIndex = 0.75,
  selectedCustomer,
  redeemedCoupon
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [activeAddProductId, setActiveAddProductId] = useState<string | null>(null);
  const [cartPulse, setCartPulse] = useState(false);
  const [language, setLanguage] = useState<'ES' | 'EN'>('ES');
  const [logoLoadError, setLogoLoadError] = useState(false);

  const [showPromoSheet, setShowPromoSheet] = useState(false);
  const [selectedPromoProduct, setSelectedPromoProduct] = useState<Product | null>(null);

  const [weightInstructionOpen, setWeightInstructionOpen] = useState(false);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weighingProduct, setWeighingProduct] = useState<Product | null>(null);
  const [currentWeight, setCurrentWeight] = useState(0);
  const [isWeighing, setIsWeighing] = useState(false);

  const cartContainerRef = useRef<HTMLDivElement>(null);
  const cartEndRef = useRef<HTMLDivElement>(null);
  const {
    isLocked,
    needsVerification,
    auditTriggered,
    lockReason,
    lockMessage,
    conflictProductId,
    conflictProductName,
    expectedWeightKg,
    sensorWeightKg,
    supervisorAuthorized,
    markNeedsVerification,
    syncVerificationState,
    checkVerificationBeforePayment,
    shouldAuditTransaction,
    mockSensorWeightKg,
    evaluateScaleDiscrepancy,
    submitSupervisorPin,
    approveTransaction,
    clearSecurityState
  } = useKioskSecurityContext();

  useEffect(() => {
    setTimeout(() => {
      cartEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  }, [cart.length]);

  useEffect(() => {
    syncVerificationState(cart);
    if (cart.length === 0 && !isLocked) {
      clearSecurityState();
    }
  }, [cart, isLocked, syncVerificationState, clearSecurityState]);

  useEffect(() => {
    if (weightModalOpen && weighingProduct) {
      setIsWeighing(true);
      setCurrentWeight(0);

      const interval = setInterval(() => {
        setCurrentWeight(prev => prev + (Math.random() * 0.5));
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        const finalWeight = Number((Math.random() * 2 + 0.5).toFixed(3));
        setCurrentWeight(finalWeight);
        setIsWeighing(false);
      }, 2500);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [weightModalOpen, weighingProduct]);

  const [productPrices, setProductPrices] = useState<ProductPrice[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refreshProductPrices = async () => {
      try {
        const fresh = await db.get('productPrices') as ProductPrice[] | null;
        if (!cancelled && Array.isArray(fresh)) {
          setProductPrices(fresh);
        }
      } catch (error) {
        console.warn('⚠️ KioskProductBrowser: Could not load productPrices collection:', error);
      }
    };

    void refreshProductPrices();
    window.addEventListener('productPricesUpdated', refreshProductPrices);
    return () => {
      cancelled = true;
      window.removeEventListener('productPricesUpdated', refreshProductPrices);
    };
  }, []);

  const normalizeScopeKey = useCallback((value: unknown) => normalizeToken(value), []);
  const terminal = (config.terminals || []).find(t => t.id === terminalId);
  const activeTerminalConfig = terminal?.config;
  const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;

  const allowedTariffs = useMemo(() => {
    const allowedIds = activeTerminalConfig?.pricing?.allowedTariffIds || [];
    const tariffs = config.tariffs || [];
    if (allowedIds.length === 0) return tariffs;
    const filteredTariffs = tariffs.filter(t => allowedIds.includes(t.id));
    return filteredTariffs.length > 0 ? filteredTariffs : tariffs;
  }, [activeTerminalConfig?.pricing?.allowedTariffIds, config.tariffs]);

  const activeTariffId = useMemo(
    () => activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs?.[0]?.id || '',
    [activeTerminalConfig?.pricing?.defaultTariffId, allowedTariffs, config.tariffs]
  );

  const productPriceIndex = useMemo(() => {
    const index = new Map<string, number>();

    for (const record of productPrices) {
      if (!record || typeof record !== 'object') continue;
      const price = Number(record.price);
      if (!Number.isFinite(price)) continue;

      const productTokens = [
        record.productId,
        record.itemId,
        record.erpProductId,
        record.sourceProductId,
      ].map(normalizeToken).filter(Boolean);

      const tariffTokens = [
        record.tariffId,
        record.tariffCode,
      ].map(normalizeToken).filter(Boolean);

      for (const productToken of productTokens) {
        for (const tariffToken of tariffTokens) {
          index.set(`${productToken}::${tariffToken}`, price);
        }
      }
    }

    return index;
  }, [productPrices]);

  const getTariffPrice = useCallback((product: Product) => {
    const selectedTariff = (config.tariffs || []).find((tariff) => tariff.id === activeTariffId) as Tariff | undefined;
    const activeTokens = new Set(
      [activeTariffId, selectedTariff?.id, (selectedTariff as any)?.code]
        .map(normalizeToken)
        .filter(Boolean)
    );

    const productTokens = new Set(
      [
        product.id,
        resolveOperationalProductId(product),
        ...productIdentityCandidates(product),
      ].map(normalizeToken).filter(Boolean)
    );

    for (const productToken of productTokens) {
      for (const activeToken of activeTokens) {
        const indexedPrice = productPriceIndex.get(`${productToken}::${activeToken}`);
        if (typeof indexedPrice === 'number' && Number.isFinite(indexedPrice)) {
          return indexedPrice;
        }
      }
    }

    const matchedEntry = (product.tariffs || []).find((entry: any) => {
      const entryTokens = [
        entry?.tariffId,
        entry?.tariff_id,
        entry?.id,
        entry?.code,
        entry?.tariffCode,
        entry?.tariff_code,
      ].map(normalizeToken).filter(Boolean);

      return entryTokens.some((token) => activeTokens.has(token));
    });

    const tariffPrice = matchedEntry?.price;
    return typeof tariffPrice === 'number' && Number.isFinite(tariffPrice) ? tariffPrice : null;
  }, [activeTariffId, config.tariffs, productPriceIndex]);

  const productHasActiveTariff = useCallback((product: Product) => getTariffPrice(product) !== null, [getTariffPrice]);
  const getProductPrice = useCallback((product: Product) => getTariffPrice(product) ?? 0, [getTariffPrice]);

  const categoryLookup = useMemo(() => {
    const aliasToCanonical = new Map<string, string>();
    const canonicalToDisplay = new Map<string, string>();

    for (const category of config.posCategories || []) {
      const aliases = [category.id, category.code, category.name]
        .map(normalizeScopeKey)
        .filter(Boolean);
      const canonical = normalizeScopeKey(category.name || category.code || category.id);
      const displayName = category.name || category.code || category.id;
      if (!canonical || !displayName) continue;

      canonicalToDisplay.set(canonical, displayName);
      aliases.forEach((alias) => aliasToCanonical.set(alias, canonical));
    }

    return { aliasToCanonical, canonicalToDisplay };
  }, [config.posCategories, normalizeScopeKey]);

  const canonicalizeCategory = useCallback((value: unknown) => {
    const normalized = normalizeScopeKey(value);
    return categoryLookup.aliasToCanonical.get(normalized) || normalized;
  }, [categoryLookup.aliasToCanonical, normalizeScopeKey]);

  const displayCategory = useCallback((value: unknown) => {
    const canonical = canonicalizeCategory(value);
    if (!canonical) return '';
    return categoryLookup.canonicalToDisplay.get(canonical) || (typeof value === 'string' ? value.trim() : canonical);
  }, [canonicalizeCategory, categoryLookup.canonicalToDisplay]);

  const effectiveAllowedCategorySet = useMemo(() => {
    const configuredCategories = new Set(
      (activeTerminalConfig?.catalog?.allowedCategories || [])
        .map((category) => canonicalizeCategory(category))
        .filter(Boolean)
    );
    if (configuredCategories.size === 0) return configuredCategories;

    const localSellableCategories = new Set(
      (products || [])
        .filter((product) => product && product.is_sellable !== false)
        .map((product) => canonicalizeCategory(product.category))
        .filter(Boolean)
    );

    const matchedCategories = Array.from(configuredCategories).filter((category) => localSellableCategories.has(category));
    return matchedCategories.length > 0 ? configuredCategories : new Set<string>();
  }, [activeTerminalConfig?.catalog?.allowedCategories, canonicalizeCategory, products]);

  const warehouseAliasMap = useMemo(() => {
    const aliasMap = new Map<string, Set<string>>();

    const registerWarehouse = (warehouse?: Partial<Warehouse> | null) => {
      if (!warehouse) return;
      const aliases = [
        warehouse.id,
        (warehouse as any).warehouseId,
        (warehouse as any).warehouse_id,
        (warehouse as any).inventoryLocalId,
        (warehouse as any).inventory_local_id,
        (warehouse as any).erpWarehouseId,
        (warehouse as any).erp_warehouse_id,
        (warehouse as any).sourceWarehouseId,
        (warehouse as any).source_warehouse_id,
        warehouse.code,
        warehouse.name,
      ].map(normalizeScopeKey).filter(Boolean);
      if (aliases.length === 0) return;

      const mergedAliases = new Set(aliases);
      aliases.forEach((alias) => {
        const existing = aliasMap.get(alias);
        existing?.forEach((item) => mergedAliases.add(item));
      });
      aliases.forEach((alias) => aliasMap.set(alias, new Set(mergedAliases)));
    };

    (warehouses || []).forEach(registerWarehouse);
    (activeTerminalConfig?.inventoryScope?.warehouses || []).forEach(registerWarehouse);
    registerWarehouse(activeTerminalConfig?.inventoryScope?.defaultWarehouse as Warehouse | undefined);

    return aliasMap;
  }, [
    warehouses,
    activeTerminalConfig?.inventoryScope?.warehouses,
    activeTerminalConfig?.inventoryScope?.defaultWarehouse,
    normalizeScopeKey,
  ]);

  const effectiveWarehouseKeys = useMemo(() => {
    const keys = new Set<string>();
    const addWarehouseValue = (value: unknown) => {
      const normalized = normalizeScopeKey(value);
      if (!normalized) return;
      keys.add(normalized);
      warehouseAliasMap.get(normalized)?.forEach((alias) => keys.add(alias));
    };

    addWarehouseValue(defaultSalesWarehouseId);
    addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.id);
    addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.code);
    addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.name);
    (activeTerminalConfig?.inventoryScope?.visibleWarehouseIds || []).forEach(addWarehouseValue);

    return keys;
  }, [
    activeTerminalConfig?.inventoryScope?.defaultWarehouse?.code,
    activeTerminalConfig?.inventoryScope?.defaultWarehouse?.id,
    activeTerminalConfig?.inventoryScope?.defaultWarehouse?.name,
    activeTerminalConfig?.inventoryScope?.visibleWarehouseIds,
    defaultSalesWarehouseId,
    normalizeScopeKey,
    warehouseAliasMap,
  ]);

  const productMatchesTerminalWarehouse = useCallback((product: Product) => {
    const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses)
      .map(normalizeScopeKey)
      .filter(Boolean);
    if (activeWarehouses.length === 0) return false;
    if (effectiveWarehouseKeys.size === 0) return true;
    return activeWarehouses.some((warehouseId) => effectiveWarehouseKeys.has(warehouseId));
  }, [effectiveWarehouseKeys, normalizeScopeKey, warehouses]);

  const getScopedProductStock = useCallback((product: Product) => {
    const matchedEntry = Object.entries(product.stockBalances || {})
      .find(([warehouseId]) => effectiveWarehouseKeys.has(normalizeScopeKey(warehouseId)));
    if (matchedEntry) return Number(matchedEntry[1] ?? 0);
    return Number(product.stock ?? 0);
  }, [effectiveWarehouseKeys, normalizeScopeKey]);

  const salesCatalogProducts = useMemo(() => {
    const nonSeedBusinessKeys = new Set<string>();

    for (const product of products) {
      if (!product || typeof product !== 'object' || Array.isArray(product)) continue;
      if (isSeedCatalogProduct(product)) continue;
      productBusinessKeys(product).forEach((key) => nonSeedBusinessKeys.add(key));
    }

    return products.filter((product) => {
      if (!product || typeof product !== 'object' || Array.isArray(product)) return false;
      if (!isSeedCatalogProduct(product)) return true;

      const businessKeys = productBusinessKeys(product);
      return !businessKeys.some((key) => nonSeedBusinessKeys.has(key));
    });
  }, [products]);

  const dedupedSalesProducts = useMemo(() => Array.from(
    salesCatalogProducts.reduce((map, product) => {
      if (!product || typeof product !== 'object' || Array.isArray(product)) return map;

      const key = productSalesIdentityKey(product);
      const existing = map.get(key);
      if (!existing || scoreProductForSales(product, warehouses) > scoreProductForSales(existing, warehouses)) {
        map.set(key, product);
      }
      return map;
    }, new Map<string, Product>()).values()
  ), [salesCatalogProducts, warehouses]);

  const sellableProducts = useMemo(
    () => dedupedSalesProducts.filter((product) => {
      if (!product || product.is_sellable === false) return false;
      if (!productHasActiveTariff(product)) return false;
      if (resolveProductActiveWarehouseIds(product, warehouses).length === 0) return false;

      const normalizedProductCategory = canonicalizeCategory(product.category);
      if (effectiveAllowedCategorySet.size > 0 && !effectiveAllowedCategorySet.has(normalizedProductCategory)) return false;

      return true;
    }),
    [canonicalizeCategory, dedupedSalesProducts, effectiveAllowedCategorySet, productHasActiveTariff, warehouses]
  );

  const categories = useMemo(() => {
    const availableCategoryMap = new Map<string, string>();
    for (const product of sellableProducts) {
      const normalizedCategory = canonicalizeCategory(product?.category);
      const rawCategory = displayCategory(product?.category);
      if (!rawCategory || availableCategoryMap.has(normalizedCategory)) continue;
      availableCategoryMap.set(normalizedCategory, rawCategory);
    }

    return ['Todos', ...Array.from(availableCategoryMap.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))];
  }, [canonicalizeCategory, displayCategory, sellableProducts]);

  const filteredProducts = useMemo(
    () => sellableProducts.filter((product) => {
      const normalizedSearch = searchQuery.trim().toLowerCase();
      const matchesSearch = !normalizedSearch
        || (product.name || '').toLowerCase().includes(normalizedSearch)
        || String(product.barcode || '').toLowerCase().includes(normalizedSearch)
        || String((product as any).sku || '').toLowerCase().includes(normalizedSearch)
        || String((product as any).item_code || '').toLowerCase().includes(normalizedSearch)
        || String((product as any).code || '').toLowerCase().includes(normalizedSearch);
      const matchesCategory = selectedCategory === 'Todos' || canonicalizeCategory(product.category) === canonicalizeCategory(selectedCategory);
      return matchesSearch && matchesCategory;
    }),
    [canonicalizeCategory, searchQuery, selectedCategory, sellableProducts]
  );

  const suggestions = useMemo(
    () => sellableProducts.filter(product => !cart.some(item => item.id === product.id)).slice(0, 4),
    [sellableProducts, cart]
  );

  const getProductAvailability = useCallback((product: Product, quantityToAdd = 1) => {
    if (!productHasActiveTariff(product)) {
      return { canSell: false, reason: 'No disponible en la tarifa activa', availableStock: 0 };
    }
    if (!productMatchesTerminalWarehouse(product)) {
      return { canSell: false, reason: 'No disponible en este almacén', availableStock: 0 };
    }

    const trackInventory = product.operationalFlags?.trackInventory ?? config.features?.stockTracking ?? false;
    const productAllowsNegative = product.operationalFlags?.allowNegativeStock ?? false;
    const terminalAllowsNegative = activeTerminalConfig?.workflow?.inventory?.allowNegativeStock ?? false;
    const allowsNegative = productAllowsNegative && terminalAllowsNegative;
    const availableStock = getScopedProductStock(product);

    if (trackInventory && !allowsNegative) {
      const inCartQty = cart
        .filter(item => item.id === product.id)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      if (inCartQty + quantityToAdd > availableStock) {
        return { canSell: false, reason: `Stock insuficiente. Disponible: ${Math.max(0, availableStock - inCartQty)}`, availableStock };
      }
    }

    return { canSell: true, reason: '', availableStock };
  }, [
    activeTerminalConfig?.workflow?.inventory?.allowNegativeStock,
    cart,
    config.features?.stockTracking,
    getScopedProductStock,
    productHasActiveTariff,
    productMatchesTerminalWarehouse,
  ]);

  const buildPricedProduct = useCallback((product: Product): Product => ({
    ...product,
    price: getProductPrice(product),
  }), [getProductPrice]);

  const triggerAddFeedback = (productName: string, productId: string) => {
    setLastScanned(productName);
    setActiveAddProductId(productId);
    setCartPulse(true);

    setTimeout(() => setCartPulse(false), 500);
    setTimeout(() => setActiveAddProductId(null), 650);
    setTimeout(() => setLastScanned(null), 2000);
  };

  const handleProductClick = useCallback((product: Product) => {
    const availability = getProductAvailability(product);
    if (!availability.canSell) {
      triggerAddFeedback(availability.reason, product.id);
      return;
    }

    if (product.type === 'SERVICE') {
      setWeighingProduct(product);
      setWeightInstructionOpen(true);
      return;
    }

    const pricedProduct = buildPricedProduct(product);
    onAddToCart(pricedProduct);
    markNeedsVerification(pricedProduct);
    triggerAddFeedback(product.name, product.id);
  }, [buildPricedProduct, getProductAvailability, markNeedsVerification, onAddToCart]);

  const startWeighingFlow = () => {
    setWeightInstructionOpen(false);
    setWeightModalOpen(true);
  };

  const cancelWeighingFlow = () => {
    setWeightInstructionOpen(false);
    setWeightModalOpen(false);
    setWeighingProduct(null);
    setCurrentWeight(0);
    setIsWeighing(false);
  };

  const confirmWeight = () => {
    if (!weighingProduct) return;

    const availability = getProductAvailability(weighingProduct, currentWeight);
    if (!availability.canSell) {
      triggerAddFeedback(availability.reason, weighingProduct.id);
      return;
    }

    const pricedProduct = buildPricedProduct(weighingProduct);
    onAddToCart(pricedProduct, currentWeight);
    markNeedsVerification(pricedProduct);
    triggerAddFeedback(`${weighingProduct.name} (${currentWeight}kg)`, weighingProduct.id);

    setWeightModalOpen(false);
    setWeighingProduct(null);
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const total = subtotal;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const moneySymbol = config.currencySymbol || '$';
  const formatMoney = (amount: number) => `${moneySymbol}${amount.toFixed(2)}`;
  const kioskLogoSrc = !logoLoadError ? '/favicon.png' : '';

  const handleDecrease = (item: CartItem) => {
    if (item.quantity <= 1) {
      onRemoveFromCart(item.id);
      return;
    }
    onAddToCart(item, -1);
  };

  const handleIncrease = (item: CartItem) => {
    onAddToCart(item, 1);
  };

  const handleCheckoutAttempt = () => {
    if (cart.length === 0) return;
    if (checkVerificationBeforePayment(cart)) return;

    const auditHit = shouldAuditTransaction({
      monto_total: total,
      cantidad_items: itemCount,
      indice_confianza_cliente: customerConfidenceIndex,
      transaction_signature: cart.map(item => `${item.id}:${Number(item.quantity || 0).toFixed(3)}`).sort().join('|')
    });
    if (auditHit) return;

    const sensorWeight = mockSensorWeightKg(cart);
    const weightMismatch = evaluateScaleDiscrepancy(cart, sensorWeight);
    if (weightMismatch) return;

    onCheckout();
  };

  const handleCancelPurchase = () => {
    clearSecurityState();
    onCancel();
  };

  const handleHardwareScan = useCallback((rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    if (config.scaleLabelConfig?.isEnabled) {
      const scaleItem = parseScaleBarcode(code, config.scaleLabelConfig);
      if (scaleItem) {
        const weightedProduct = sellableProducts.find(
          (product) => product.barcode === scaleItem.plu || product.id === scaleItem.plu
        );

        if (weightedProduct) {
          const unitPrice = getProductPrice(weightedProduct);
          const quantity = scaleItem.type === 'WEIGHT'
            ? scaleItem.value
            : (unitPrice > 0 ? scaleItem.value / unitPrice : 1);
          const availability = getProductAvailability(weightedProduct, quantity);
          if (!availability.canSell) {
            triggerAddFeedback(availability.reason, weightedProduct.id);
            return;
          }
          const pricedProduct = buildPricedProduct(weightedProduct);

          onAddToCart(pricedProduct, quantity);
          markNeedsVerification(pricedProduct);
          triggerAddFeedback(
            scaleItem.type === 'WEIGHT' || unitPrice > 0
              ? `${weightedProduct.name} (${quantity.toFixed(3)}kg)`
              : weightedProduct.name,
            weightedProduct.id
          );
          return;
        }
      }
    }

    const product = sellableProducts.find(
      (candidate) => (
        candidate.barcode === code ||
        candidate.id === code ||
        (candidate as any).sku === code ||
        (candidate as any).item_code === code ||
        (candidate as any).code === code
      )
    );

    if (product) {
      handleProductClick(product);
    }
  }, [buildPricedProduct, config.scaleLabelConfig, getProductAvailability, getProductPrice, handleProductClick, markNeedsVerification, onAddToCart, sellableProducts, triggerAddFeedback]);

  useEffect(() => {
    const onHardwareScan = (event: Event) => {
      const barcode = (event as CustomEvent<{ barcode?: string }>).detail?.barcode;
      if (!barcode) return;
      handleHardwareScan(barcode);
    };

    window.addEventListener('barcodeScanned', onHardwareScan as EventListener);
    return () => window.removeEventListener('barcodeScanned', onHardwareScan as EventListener);
  }, [handleHardwareScan]);

  return (
    <div className="fixed inset-0 w-screen h-screen flex bg-slate-50 overflow-hidden">
      <section className="flex-[7] min-w-0 h-full flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 text-white font-black flex items-center justify-center overflow-hidden shadow-sm">
              {kioskLogoSrc ? (
                <img
                  src={kioskLogoSrc}
                  alt="Logo Alfa POS"
                  className="w-full h-full object-contain"
                  onError={() => setLogoLoadError(true)}
                />
              ) : (
                <span>C</span>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Self Checkout</p>
              <p className="text-xl font-black text-slate-800">{config.companyInfo?.name || 'Alfa POS'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 rounded-2xl p-1">
            <button
              onClick={() => setLanguage('ES')}
              className={`px-4 min-h-[52px] rounded-xl font-bold text-sm transition-colors ${language === 'ES' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              ES
            </button>
            <button
              onClick={() => setLanguage('EN')}
              className={`px-4 min-h-[52px] rounded-xl font-bold text-sm transition-colors ${language === 'EN' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              EN
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 pb-40">
          <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredProducts.slice(0, 30).map(product => {
              const imageSrc = resolveProductImageSrc(product);
              const price = getProductPrice(product);
              const availability = getProductAvailability(product);
              const isUnavailable = !availability.canSell;

              return (
                <button
                  key={product.id}
                  onClick={() => handleProductClick(product)}
                  disabled={isUnavailable}
                  className={`bg-white rounded-3xl border text-left overflow-hidden group flex flex-col h-[360px] transition-all active:scale-[0.98] ${isUnavailable ? 'opacity-70 cursor-not-allowed grayscale-[0.35]' : ''} ${activeAddProductId === product.id ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200 hover:border-blue-200 hover:shadow-xl hover:-translate-y-1'}`}
                >
                  <div className="relative h-[62%] bg-slate-50 border-b border-slate-100 p-5 flex items-center justify-center">
                    {product.type === 'SERVICE' && (
                      <div className="absolute top-3 left-3 bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1">
                        <Scale size={12} />
                        Requiere pesaje
                      </div>
                    )}

                    {isUnavailable && (
                      <div className="absolute top-3 left-3 z-20 bg-slate-900/80 text-white px-2.5 py-1 rounded-full text-xs font-black">
                        {availability.reason || 'No disponible'}
                      </div>
                    )}

                    {hasProductPromotion(product, config, terminalId || 'T1') && (
                      <div
                        className="absolute top-0 right-0 cursor-pointer z-20"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPromoProduct(product);
                          setShowPromoSheet(true);
                        }}
                      >
                        <div className="bg-red-500 text-white text-xs font-black px-3 py-1.5 rounded-bl-2xl shadow-md flex items-center gap-1.5 animate-in slide-in-from-top-2 hover:bg-red-600 transition-colors">
                          <Tag size={12} className="fill-white" />
                          OFERTA
                        </div>
                      </div>
                    )}

                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={product.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          if (e.currentTarget.parentElement) {
                            e.currentTarget.parentElement.innerHTML += `<span class=\"text-7xl\">${product.category === 'Bebidas' ? '🥤' : '📦'}</span>`;
                          }
                        }}
                      />
                    ) : (
                      <span className="text-7xl">{product.category === 'Bebidas' ? '🥤' : '📦'}</span>
                    )}
                  </div>

                  <div className="h-[38%] p-5 flex flex-col">
                    <h3 className="font-black text-slate-800 text-xl leading-tight line-clamp-2">{product.name}</h3>
                    <p className="text-sm text-slate-400 mt-1">{displayCategory(product.category)}</p>

                    <div className="mt-auto flex items-center justify-between">
                      <div className="text-2xl font-black text-slate-900">
                        {formatMoney(price)}
                        {product.type === 'SERVICE' && <span className="text-xs font-bold text-slate-400 ml-1">/kg</span>}
                      </div>
                      <div className={`w-12 h-12 text-white rounded-2xl flex items-center justify-center shadow-md ${isUnavailable ? 'bg-slate-300' : 'bg-blue-600'}`}>
                        <Plus size={24} />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center py-20">
              <div className="text-7xl mb-4">🔍</div>
              <p className="text-2xl font-black text-slate-400">No se encontraron productos</p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white/95 backdrop-blur p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={22} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar producto o codigo"
              className="w-full pl-14 pr-6 min-h-[64px] bg-slate-100 border-2 border-transparent focus:bg-white focus:border-blue-500 rounded-2xl text-lg font-semibold outline-none transition-all"
            />
          </div>

          <div className="overflow-x-auto no-scrollbar">
            <div className="flex gap-3 pb-1">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-5 min-h-[60px] rounded-2xl font-black whitespace-nowrap transition-all ${selectedCategory === cat
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {lastScanned && (
        <div className="pointer-events-none fixed left-1/2 top-[108px] z-30 -translate-x-1/2">
          <div className="rounded-2xl bg-emerald-500/95 px-6 py-3 text-center text-white shadow-2xl shadow-emerald-500/25 animate-in fade-in zoom-in-95">
            <p className="text-lg font-black">Producto agregado: {lastScanned}</p>
          </div>
        </div>
      )}

      <aside className={`flex-[3] min-w-[360px] bg-white border-l border-slate-200 h-full flex flex-col shadow-2xl ${cartPulse ? 'animate-pulse' : ''}`}>
        <div className="bg-blue-700 text-white p-6">
          <div className="flex items-center gap-3 mb-1">
            <ShoppingCart size={30} strokeWidth={2.5} />
            <h2 className="text-3xl font-black">Tu Carrito</h2>
          </div>
          <p className="text-blue-100 text-lg font-semibold">{itemCount} {itemCount === 1 ? 'articulo' : 'articulos'}</p>
          {(selectedCustomer || redeemedCoupon) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedCustomer && (
                <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                  Cliente: {selectedCustomer.name}
                </span>
              )}
              {redeemedCoupon && (
                <span className="inline-flex items-center rounded-full bg-emerald-300 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-950">
                  Cupon: {redeemedCoupon.code}
                </span>
              )}
            </div>
          )}
          {(needsVerification || auditTriggered) && (
            <div className="mt-3 inline-flex items-center gap-2 text-xs font-black uppercase px-3 py-1 rounded-full bg-amber-200 text-amber-900">
              {needsVerification ? 'Mantenida para verificación' : 'Auditoría aleatoria pendiente'}
            </div>
          )}
        </div>

        <div ref={cartContainerRef} className="flex-1 overflow-y-auto p-5">
          {cart.length === 0 ? (
            <div className="text-center py-12 space-y-5">
              <div className="text-6xl">🛒</div>
              <p className="text-xl font-black text-slate-500">Carrito vacio</p>
              <p className="text-sm text-slate-400">Toca un producto para agregarlo</p>

              {suggestions.length > 0 && (
                <div className="text-left mt-8">
                  <div className="flex items-center gap-2 mb-3 text-amber-600 font-black text-sm uppercase tracking-wide">
                    <Sparkles size={16} />
                    Sugerencias del dia
                  </div>
                  <div className="space-y-2">
                    {suggestions.map(suggestion => (
                      <button
                        key={suggestion.id}
                        onClick={() => handleProductClick(suggestion)}
                        className="w-full px-3 py-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-blue-200 hover:bg-blue-50 text-left transition-colors"
                      >
                        <p className="font-bold text-slate-800 truncate">{suggestion.name}</p>
                        <p className="text-sm font-black text-slate-500">{formatMoney(getProductPrice(suggestion))}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {cart.map(item => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4 bg-white shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-black text-slate-800 text-lg leading-tight line-clamp-2">{item.name}</h4>
                      <p className="text-sm text-slate-500 mt-1">{formatMoney(item.originalPrice || item.price)} x {item.quantity}</p>
                    </div>
                    <button
                      onClick={() => onRemoveFromCart(item.id)}
                      className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 flex items-center justify-center transition-colors"
                      title="Eliminar"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-2xl font-black ${item.price < (item.originalPrice || item.price) ? 'text-green-600' : 'text-slate-800'}`}>
                      {formatMoney(item.price * item.quantity)}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDecrease(item)}
                        className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center"
                      >
                        <Minus size={20} />
                      </button>
                      <div className="w-10 text-center text-xl font-black text-slate-800">{item.quantity}</div>
                      <button
                        onClick={() => handleIncrease(item)}
                        className="w-12 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={cartEndRef} className="h-4" />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-5 space-y-4 bg-white">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div className="flex items-center justify-between text-lg">
              <span className="font-bold text-slate-500">Subtotal</span>
              <span className="font-black text-slate-800">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-3xl">
              <span className="font-black text-slate-900">Total</span>
              <span className="font-black text-slate-900">{formatMoney(total)}</span>
            </div>
          </div>

          <button
            onClick={handleCheckoutAttempt}
            disabled={cart.length === 0}
            className="w-full min-h-[78px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-2xl font-black text-3xl shadow-lg transition-all flex items-center justify-center gap-3"
          >
            <CreditCard size={30} />
            PAGAR AHORA
          </button>

          <button
            onClick={handleCancelPurchase}
            className="w-full min-h-[62px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-black text-lg transition-colors"
          >
            Cancelar compra
          </button>
        </div>
      </aside>

      {weightInstructionOpen && weighingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl text-center">
            <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Scale size={50} className="text-orange-600" />
            </div>
            <h3 className="text-3xl font-black text-slate-900 mb-2">Producto con pesaje</h3>
            <p className="text-slate-600 text-lg mb-6">
              Coloca <span className="font-black">{weighingProduct.name}</span> en la balanza para registrar el peso.
            </p>

            <div className="flex gap-3">
              <button
                onClick={cancelWeighingFlow}
                className="flex-1 min-h-[58px] rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black"
              >
                Cancelar
              </button>
              <button
                onClick={startWeighingFlow}
                className="flex-1 min-h-[58px] rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black flex items-center justify-center gap-2"
              >
                Comenzar pesaje
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {weightModalOpen && weighingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl transform transition-all scale-100">
            <div className="text-center">
              <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Scale size={48} className="text-blue-600" />
              </div>

              <h3 className="text-2xl font-black text-gray-800 mb-2">
                {isWeighing ? 'Pesando producto...' : 'Peso confirmado'}
              </h3>
              <p className="text-gray-500 mb-8">{weighingProduct.name}</p>

              <div className="bg-gray-50 rounded-2xl p-8 mb-8 border-2 border-gray-100">
                <div className="text-6xl font-black text-gray-900 font-mono tracking-tighter">
                  {currentWeight.toFixed(3)}
                  <span className="text-2xl text-gray-400 ml-2">kg</span>
                </div>
                <div className="mt-2 text-blue-600 font-bold">Total: {formatMoney(currentWeight * weighingProduct.price)}</div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={cancelWeighingFlow}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmWeight}
                  disabled={isWeighing}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isWeighing ? <span className="animate-pulse">Calculando...</span> : <><span>Confirmar</span><ChevronRight size={20} /></>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PromoBottomSheet
        isOpen={showPromoSheet}
        onClose={() => setShowPromoSheet(false)}
        product={selectedPromoProduct}
        onAddToCart={(p) => handleProductClick(p)}
        config={config}
      />

      <SecurityOverlay
        isOpen={isLocked}
        lockReason={lockReason}
        lockMessage={lockMessage}
        conflictProductName={conflictProductName}
        expectedWeightKg={expectedWeightKg}
        sensorWeightKg={sensorWeightKg}
        canRemoveItem={Boolean(conflictProductId)}
        supervisorAuthorized={supervisorAuthorized}
        onValidateSupervisorPin={submitSupervisorPin}
        onApproveTransaction={() => {
          approveTransaction(cart);
        }}
        onRemoveConflictItem={() => {
          if (conflictProductId) {
            onRemoveFromCart(conflictProductId);
          }
          approveTransaction();
        }}
        onResetCart={() => {
          clearSecurityState();
          onCancel();
        }}
      />
    </div>
  );
};

export default KioskProductBrowser;
