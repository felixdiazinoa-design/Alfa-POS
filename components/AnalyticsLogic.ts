import {
    AttendanceLog,
    CashMovement,
    Customer,
    InventoryLedgerEntry,
    Product,
    ProductStock,
    ProductVariant,
    PurchaseOrder,
    Reception,
    Transaction,
    Warehouse,
    Supplier
} from '../types';

export type InventoryStatusFilter = 'ALL' | 'WITH_STOCK' | 'OUT_OF_STOCK' | 'LOW_STOCK';

export interface InventoryAnalyticsFilters {
    warehouseId: string; // "ALL" for consolidated view
    departmentId: string;
    sectionId: string;
    familyId: string;
    subfamilyId: string;
    brandId: string;
    supplierId: string;
    stockState: InventoryStatusFilter;
    searchTerm?: string;
}

export interface InventoryVariantAnalyticsRow {
    variantId: string;
    variantLabel: string;
    quantity: number;
    avgCost: number;
    value: number;
}

export interface InventoryAnalyticsRow {
    id: string;
    name: string;
    code: string;
    quantity: number;
    avgCost: number;
    value: number;
    minStock: number;
    status: Exclude<InventoryStatusFilter, 'ALL'>;
    departmentId?: string;
    sectionId?: string;
    familyId?: string;
    subfamilyId?: string;
    brandId?: string;
    supplierId?: string;
    variants: InventoryVariantAnalyticsRow[];
    hasVariants: boolean;
}

interface QueryInventoryAnalyticsParams {
    products: Product[];
    productStocks: ProductStock[];
    warehouses: Warehouse[];
    inventoryLedger: InventoryLedgerEntry[];
    filters: InventoryAnalyticsFilters;
}

const toNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePaymentMethod = (method: unknown): string => String(method || '').trim().toUpperCase();

const isRefundLikeTransaction = (tx: Transaction): boolean => {
    return tx.documentType === 'REFUND'
        || tx.ncfType === 'B04'
        || tx.status === 'REFUNDED'
        || tx.status === 'PARTIAL_REFUND'
        || toNumber(tx.total) < 0;
};

const isOpeningFundReason = (reason: unknown): boolean => {
    const normalized = String(reason || '').toLowerCase();
    if (!normalized) return false;
    return normalized.includes('apertura')
        || normalized.includes('fondo')
        || normalized.includes('cambio inicial')
        || normalized.includes('fondo inicial');
};

const paymentMatchesCurrency = (payment: any, currencyCode?: string): boolean => {
    if (!currencyCode) return true;
    const paymentCurrency = String(payment?.currencyCode || payment?.currency || '').trim().toUpperCase();
    if (!paymentCurrency) return true;
    return paymentCurrency === currencyCode;
};

const movementMatchesCurrency = (movement: CashMovement, currencyCode?: string): boolean => {
    if (!currencyCode) return true;
    const movementCurrency = String(movement.currencyCode || '').trim().toUpperCase();
    if (!movementCurrency) return true;
    return movementCurrency === currencyCode;
};

export interface CashDiscrepancyInput {
    transactions: Transaction[];
    cashTransactions: CashMovement[];
    countedCash?: number | null;
    openingFund?: number;
    currencyCode?: string;
}

export interface CashDiscrepancyResult {
    openingFund: number;
    cashSales: number;
    cashIn: number;
    cashOut: number;
    cashRefunds: number;
    expectedCash: number;
    countedCash: number | null;
    discrepancy: number | null;
}

/**
 * Cash discrepancy formula:
 * (Opening Fund + Cash Sales + Cash In) - (Cash Out + Cash Refunds)
 * Crosses cash transactions and sales documents.
 */
export const calculateCashDiscrepancy = ({
    transactions,
    cashTransactions,
    countedCash = null,
    openingFund = 0,
    currencyCode
}: CashDiscrepancyInput): CashDiscrepancyResult => {
    const normalizedCurrency = currencyCode ? currencyCode.toUpperCase() : undefined;

    let computedOpeningFund = toNumber(openingFund);
    let cashIn = 0;
    let cashOut = 0;

    (cashTransactions || []).forEach(movement => {
        if (!movementMatchesCurrency(movement, normalizedCurrency)) return;
        const amount = toNumber(movement.amount);
        if (amount <= 0) return;

        if (movement.type === 'IN') {
            if (isOpeningFundReason(movement.reason)) {
                computedOpeningFund += amount;
            } else {
                cashIn += amount;
            }
            return;
        }

        cashOut += amount;
    });

    let cashSales = 0;
    let cashRefunds = 0;

    (transactions || []).forEach(tx => {
        const txPayments = Array.isArray(tx.payments) ? tx.payments : [];
        const cashPaid = txPayments.reduce((sum, payment) => {
            if (normalizePaymentMethod(payment?.method) !== 'CASH') return sum;
            if (!paymentMatchesCurrency(payment, normalizedCurrency)) return sum;
            return sum + Math.abs(toNumber(payment?.amount));
        }, 0);

        if (cashPaid <= 0) return;

        if (isRefundLikeTransaction(tx)) {
            cashRefunds += cashPaid;
        } else {
            cashSales += cashPaid;
        }
    });

    const expectedCash = (computedOpeningFund + cashSales + cashIn) - (cashOut + cashRefunds);
    const normalizedCounted = countedCash === null || countedCash === undefined
        ? null
        : toNumber(countedCash);
    const discrepancy = normalizedCounted === null ? null : normalizedCounted - expectedCash;

    return {
        openingFund: computedOpeningFund,
        cashSales,
        cashIn,
        cashOut,
        cashRefunds,
        expectedCash,
        countedCash: normalizedCounted,
        discrepancy
    };
};

const resolveStatus = (
    quantity: number,
    minStock: number
): Exclude<InventoryStatusFilter, 'ALL'> => {
    if (quantity <= 0) return 'OUT_OF_STOCK';
    if (minStock > 0 && quantity <= minStock) return 'LOW_STOCK';
    return 'WITH_STOCK';
};

const formatVariantLabel = (variant: ProductVariant): string => {
    const attrs = Object.values(variant.attributeValues || {}).filter(Boolean);
    if (attrs.length === 0) return variant.sku;
    return `${variant.sku} · ${attrs.join(' / ')}`;
};

const buildVariantRows = (
    product: Product,
    movements: InventoryLedgerEntry[],
    warehouseId: string
): InventoryVariantAnalyticsRow[] => {
    if (!product.variants || product.variants.length === 0) return [];

    const variantLabelById = new Map<string, string>();
    const variantRowsMap = new Map<string, { label: string; qty: number; qtyIn: number; inValue: number }>();

    product.variants.forEach(variant => {
        const label = formatVariantLabel(variant);
        variantLabelById.set(variant.sku, label);
        variantRowsMap.set(variant.sku, { label, qty: 0, qtyIn: 0, inValue: 0 });
    });

    const scopedMovements = (movements || []).filter(move => {
        if (warehouseId === 'ALL') return true;
        return move.warehouseId === warehouseId;
    });

    scopedMovements.forEach(move => {
        const rawVariant = move.variantId || move.variantName;
        if (!rawVariant) return;

        let variantKey = rawVariant;
        if (!variantLabelById.has(variantKey)) {
            const matchedByLabel = Array.from(variantLabelById.entries()).find(([, label]) => label === rawVariant)?.[0];
            if (matchedByLabel) variantKey = matchedByLabel;
        }

        const existing = variantRowsMap.get(variantKey) || {
            label: variantLabelById.get(variantKey) || move.variantName || variantKey,
            qty: 0,
            qtyIn: 0,
            inValue: 0
        };

        const qtyIn = toNumber(move.qtyIn);
        const qtyOut = toNumber(move.qtyOut);
        const unitCost = toNumber(move.unitCost);

        existing.qty += qtyIn - qtyOut;
        if (qtyIn > 0) {
            existing.qtyIn += qtyIn;
            existing.inValue += qtyIn * unitCost;
        }

        variantRowsMap.set(variantKey, existing);
    });

    return Array.from(variantRowsMap.entries())
        .map(([variantId, row]) => {
            const baseCost = toNumber(product.cost);
            const avgCost = row.qtyIn > 0 ? row.inValue / row.qtyIn : baseCost;
            return {
                variantId,
                variantLabel: row.label,
                quantity: row.qty,
                avgCost,
                value: row.qty * avgCost
            };
        })
        .sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
};

/**
 * Inventory analytics query
 * Crosses Inventory_Stock (productStocks) with Products and applies classification filters.
 */
export const queryInventoryAnalytics = ({
    products,
    productStocks,
    warehouses,
    inventoryLedger,
    filters
}: QueryInventoryAnalyticsParams): InventoryAnalyticsRow[] => {
    const normalizedSearch = (filters.searchTerm || '').trim().toLowerCase();
    const warehouseIds = (warehouses || []).map(w => w.id);

    const stockByProductWarehouse = new Map<string, ProductStock>();
    (productStocks || []).forEach(stock => {
        stockByProductWarehouse.set(`${stock.productId}::${stock.warehouseId}`, stock);
    });

    const warehouseKeysByProduct = new Map<string, Set<string>>();
    (productStocks || []).forEach(stock => {
        if (!warehouseKeysByProduct.has(stock.productId)) {
            warehouseKeysByProduct.set(stock.productId, new Set<string>());
        }
        warehouseKeysByProduct.get(stock.productId)!.add(stock.warehouseId);
    });

    const movementsByProduct = new Map<string, InventoryLedgerEntry[]>();
    (inventoryLedger || []).forEach(move => {
        if (!movementsByProduct.has(move.productId)) {
            movementsByProduct.set(move.productId, []);
        }
        movementsByProduct.get(move.productId)!.push(move);
    });

    const getWarehouseQty = (product: Product, warehouseId: string): number => {
        const detailed = stockByProductWarehouse.get(`${product.id}::${warehouseId}`);
        if (detailed) {
            return toNumber(detailed.qtyPhysical ?? detailed.quantity);
        }
        return toNumber(product.stockBalances?.[warehouseId]);
    };

    const rows: InventoryAnalyticsRow[] = [];

    (products || []).forEach(product => {
        if (filters.departmentId !== 'ALL' && product.departmentId !== filters.departmentId) return;
        if (filters.sectionId !== 'ALL' && product.sectionId !== filters.sectionId) return;
        if (filters.familyId !== 'ALL' && product.familyId !== filters.familyId) return;
        if (filters.subfamilyId !== 'ALL' && product.subfamilyId !== filters.subfamilyId) return;
        if (filters.brandId !== 'ALL' && product.brandId !== filters.brandId) return;
        if (filters.supplierId !== 'ALL' && product.primarySupplierId !== filters.supplierId) return;

        if (normalizedSearch) {
            const haystack = `${product.name} ${product.id} ${product.barcode || ''}`.toLowerCase();
            if (!haystack.includes(normalizedSearch)) return;
        }

        let quantity = 0;
        if (filters.warehouseId === 'ALL') {
            const inferredWarehouses = new Set<string>(warehouseIds);
            Object.keys(product.stockBalances || {}).forEach(whId => inferredWarehouses.add(whId));
            warehouseKeysByProduct.get(product.id)?.forEach(whId => inferredWarehouses.add(whId));
            quantity = Array.from(inferredWarehouses).reduce((sum, whId) => sum + getWarehouseQty(product, whId), 0);
        } else {
            quantity = getWarehouseQty(product, filters.warehouseId);
        }

        const minStock = filters.warehouseId !== 'ALL'
            ? toNumber(product.warehouseSettings?.[filters.warehouseId]?.min ?? product.minStock)
            : toNumber(product.minStock);

        const status = resolveStatus(quantity, minStock);
        if (filters.stockState !== 'ALL' && status !== filters.stockState) return;

        const variantRows = buildVariantRows(
            product,
            movementsByProduct.get(product.id) || [],
            filters.warehouseId
        );

        const avgCostFromChildren = variantRows.length > 0
            ? variantRows.reduce((sum, row) => sum + row.avgCost, 0) / variantRows.length
            : NaN;
        const avgCost = Number.isFinite(avgCostFromChildren) && avgCostFromChildren > 0
            ? avgCostFromChildren
            : toNumber(product.cost);

        rows.push({
            id: product.id,
            name: product.name,
            code: product.barcode || '',
            quantity,
            avgCost,
            value: quantity * avgCost,
            minStock,
            status,
            departmentId: product.departmentId,
            sectionId: product.sectionId,
            familyId: product.familyId,
            subfamilyId: product.subfamilyId,
            brandId: product.brandId,
            supplierId: product.primarySupplierId,
            variants: variantRows,
            hasVariants: variantRows.length > 0
        });
    });

    return rows.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Reconstructs inventory as of a specific date by backtracking through ledger entries.
 */
export const getInventorySnapshotAtDate = (
    products: Product[],
    ledger: InventoryLedgerEntry[],
    targetDate: string
) => {
    const targetTime = new Date(targetDate).getTime();
    const snapshot: any[] = [];

    products.forEach(product => {
        // Current total stock from product metadata (sum of all warehouses)
        const balances = product.stockBalances || {};
        const currentStock = Object.values(balances).reduce((acc: number, qty: number) => acc + (qty || 0), 0);

        // Sort ledger entries for this product descending (newest first)
        const movements = (ledger || [])
            .filter(l => l.productId === product.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        let adjustedStock = currentStock;

        // Traverse backwards starting from current stock
        for (const move of movements) {
            const moveTime = new Date(move.createdAt).getTime();
            if (moveTime > targetTime) {
                // This move happened AFTER our target date, so we reverse it
                adjustedStock -= (move.qtyIn || 0);
                adjustedStock += (move.qtyOut || 0);
            } else {
                break;
            }
        }

        snapshot.push({
            id: product.id,
            name: product.name,
            code: product.barcode || '',
            quantity: adjustedStock,
            avgCost: product.cost || 0,
            value: adjustedStock * (product.cost || 0)
        });
    });

    return snapshot;
};

/**
 * Calculates Customer RFM (Recency, Frequency, Monetary)
 */
export const calculateRFMData = (customers: Customer[], transactions: Transaction[]) => {
    const now = new Date().getTime();

    return (customers || []).map(customer => {
        const customerTxs = (transactions || []).filter(tx => tx.customerId === customer.id && tx.status !== 'REFUNDED');

        if (customerTxs.length === 0) return null;

        const sortedTxs = [...customerTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastVisitTime = new Date(sortedTxs[0].date).getTime();
        const daysSinceLastVisit = Math.floor((now - lastVisitTime) / (1000 * 60 * 60 * 24));

        const monetary = customerTxs.reduce((acc, tx) => acc + tx.total, 0);
        const frequency = customerTxs.length;

        return {
            id: customer.id,
            name: customer.name,
            recency: daysSinceLastVisit,
            frequency,
            monetary,
            lastVisit: sortedTxs[0].date
        };
    }).filter(Boolean);
};

/**
 * Lead Time Performance (Promised vs Actual)
 */
export const getLeadTimePerformance = (purchaseOrders: PurchaseOrder[], receptions: Reception[], suppliers: Supplier[]) => {
    return purchaseOrders.map(po => {
        const relatedReceptions = receptions.filter(r => r.purchaseOrderId === po.id);
        if (relatedReceptions.length === 0) return null;

        const firstReception = relatedReceptions[0];
        const promised = new Date(po.expectedDate || po.date).getTime();
        const actual = new Date(firstReception.date).getTime();
        const diffDays = Math.floor((actual - promised) / (1000 * 60 * 60 * 24));

        const supplier = (suppliers || []).find(s => s.id === po.supplierId);

        return {
            id: po.id,
            supplierName: supplier?.name || po.supplierName || 'Proveedor Desconocido',
            promisedDate: po.expectedDate || po.date,
            actualDate: firstReception.date,
            delayDays: diffDays,
            status: po.status
        };
    }).filter(Boolean);
};

/**
 * ABC Ranking (80/20 Rule)
 * Classifies products based on their contribution to total revenue.
 */
export const getABCRanking = (products: Product[], transactions: Transaction[]) => {
    const productSales: Record<string, { name: string; total: number; qty: number }> = {};

    (transactions || []).forEach(tx => {
        if (tx.status === 'REFUNDED') return;
        (tx.items || []).forEach(item => {
            if (!productSales[item.id]) {
                productSales[item.id] = { name: item.name, total: 0, qty: 0 };
            }
            productSales[item.id].total += (item.price * item.quantity);
            productSales[item.id].qty += item.quantity;
        });
    });

    const sorted = Object.entries(productSales)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.total - a.total);

    const totalRevenue = sorted.reduce((acc, p) => acc + p.total, 0);
    let cumulativeRevenue = 0;

    return sorted.map(p => {
        cumulativeRevenue += p.total;
        const percentage = totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;
        let classification: 'A' | 'B' | 'C' = 'C';
        if (percentage <= 80) classification = 'A';
        else if (percentage <= 95) classification = 'B';

        return {
            ...p,
            share: totalRevenue > 0 ? (p.total / totalRevenue) * 100 : 0,
            cumShare: percentage,
            classification
        };
    });
};

/**
 * Sales by Hour (Heatmap Data)
 */
export const getSalesByHour = (transactions: Transaction[]) => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
        hour: `${i.toString().padStart(2, '0')}:00`,
        total: 0,
        count: 0
    }));

    (transactions || []).forEach(tx => {
        if (tx.status === 'REFUNDED') return;
        const date = new Date(tx.date);
        const hour = date.getHours();
        hours[hour].total += tx.total;
        hours[hour].count += 1;
    });

    return hours;
};

/**
 * HR Availability / Hours Worked
 */
export const getHRPerformance = (attendance: AttendanceLog[]) => {
    const userPerformance: Record<string, { name: string; hours: number; lastClock: string | null }> = {};

    const sorted = [...(attendance || [])].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const tempClocks: Record<string, string> = {};

    sorted.forEach(log => {
        if (!userPerformance[log.userId]) {
            userPerformance[log.userId] = { name: log.userName, hours: 0, lastClock: null };
        }

        if (log.type === 'CLOCK_IN') {
            tempClocks[log.userId] = log.timestamp;
        } else if (log.type === 'CLOCK_OUT' && tempClocks[log.userId]) {
            const start = new Date(tempClocks[log.userId]).getTime();
            const end = new Date(log.timestamp).getTime();
            const diffHours = (end - start) / (1000 * 60 * 60);
            userPerformance[log.userId].hours += diffHours;
            delete tempClocks[log.userId];
        }
        userPerformance[log.userId].lastClock = log.timestamp;
    });

    return Object.entries(userPerformance).map(([id, data]) => ({ id, ...data }));
};

/**
 * Tab 1: Supplier Intelligence Aggregation
 */
export const getSuppliersIntelligence = (purchaseOrders: PurchaseOrder[], suppliers: Supplier[]) => {
    const summary: Record<string, {
        name: string;
        taxId: string;
        orderCount: number;
        totalSpent: number;
        leadTimes: number[];
    }> = {};

    (purchaseOrders || []).forEach(po => {
        const supplier = (suppliers || []).find(s => s.id === po.supplierId);
        const sId = po.supplierId || 'unknown';

        if (!summary[sId]) {
            summary[sId] = {
                name: supplier?.name || po.supplierName || 'Desconocido',
                taxId: supplier?.taxId || 'N/A',
                orderCount: 0,
                totalSpent: 0,
                leadTimes: []
            };
        }

        summary[sId].orderCount += 1;
        summary[sId].totalSpent += (po.totalCost || 0);

        // Calculate lead time if it was completed
        if (po.status === 'COMPLETED' && po.expectedDate) {
            const expected = new Date(po.expectedDate).getTime();
            const actual = new Date(po.date).getTime(); // Should ideally use reception date, but using PO date as fallback
            const diff = Math.max(0, Math.floor((actual - expected) / (1000 * 60 * 60 * 24)));
            summary[sId].leadTimes.push(diff);
        }
    });

    return Object.entries(summary).map(([id, data]) => ({
        id,
        ...data,
        avgLeadTime: data.leadTimes.length > 0
            ? Math.round(data.leadTimes.reduce((a, b) => a + b, 0) / data.leadTimes.length)
            : 0
    }));
};

/**
 * Tab 3: Item Price Intelligence (Variance Analysis)
 */
export const getItemPriceIntelligence = (purchaseOrders: PurchaseOrder[], suppliers: Supplier[] = []) => {
    const itemHistory: Record<string, { name: string; prices: { date: string; cost: number; supplier: string }[] }> = {};

    // Collect all unique items and their price history
    (purchaseOrders || []).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(po => {
        const supplier = (suppliers || []).find(s => s.id === po.supplierId);
        const resolvedName = supplier?.name || po.supplierName || 'Desconocido';

        (po.items || []).forEach(item => {
            if (!itemHistory[item.productId]) {
                itemHistory[item.productId] = { name: item.productName, prices: [] };
            }
            itemHistory[item.productId].prices.push({
                date: po.date,
                cost: item.cost,
                supplier: resolvedName
            });
        });
    });

    return Object.entries(itemHistory).map(([id, data]) => {
        const history = data.prices;
        if (history.length === 0) return null;

        const latest = history[history.length - 1];
        const previous = history.length > 1 ? history[history.length - 2] : null;
        const variation = previous ? ((latest.cost - previous.cost) / previous.cost) * 100 : 0;

        return {
            id,
            name: data.name,
            lastSupplier: latest.supplier,
            lastDate: latest.date,
            prevPrice: previous ? previous.cost : 0,
            lastPrice: latest.cost,
            variationPercent: variation,
            isAlert: variation >= 5
        };
    }).filter(Boolean);
};

/**
 * Tab 4: Discrepancy Audit (Ordered vs Received)
 */
export const getDiscrepancyReport = (purchaseOrders: PurchaseOrder[], receptions: Reception[], suppliers: Supplier[] = []) => {
    const discrepancies: any[] = [];

    // Create a map of receptions for fast lookup
    const receptionMap: Record<string, Reception[]> = {};
    (receptions || []).forEach(r => {
        if (!receptionMap[r.purchaseOrderId]) receptionMap[r.purchaseOrderId] = [];
        receptionMap[r.purchaseOrderId].push(r);
    });

    (purchaseOrders || []).forEach(po => {
        const poReceptions = receptionMap[po.id] || [];
        const supplier = (suppliers || []).find(s => s.id === po.supplierId);
        const resolvedSupplierName = supplier?.name || po.supplierName || 'Desconocido';

        (po.items || []).forEach(item => {
            // Reconstruct history
            // Sum all receipts for this specific product in this PO
            const totalRecibidoReal = poReceptions.reduce((acc, r) => {
                const rItem = (r.items || []).find(ri => ri.productId === item.productId && ri.variantSku === item.variantSku);
                return acc + (rItem?.quantityReceived || 0);
            }, 0);

            // If the PO is PARTIAL, the quantityOrdered is just the remainder.
            // If it's COMPLETED or ORDERED, it's the full amount intended.
            const originalIntent = (po.status === 'PARTIAL')
                ? (item.quantityOrdered + totalRecibidoReal)
                : item.quantityOrdered;

            // There is a discrepancy if what we ultimately got (totalRecibidoReal) 
            // doesn't match what we originally intended.
            // ALSO check the current PO state for COMPLETED orders that were forced-closed with missing items.
            const totalRecibidoFinal = (po.status === 'COMPLETED') ? item.quantityReceived : totalRecibidoReal;

            if (totalRecibidoFinal < originalIntent) {
                discrepancies.push({
                    poId: po.id,
                    productName: item.productName,
                    ordered: originalIntent,
                    received: totalRecibidoFinal,
                    missing: originalIntent - totalRecibidoFinal,
                    supplier: resolvedSupplierName,
                    date: po.date
                });
            }
        });
    });

    return discrepancies;
};
