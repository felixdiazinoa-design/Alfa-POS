
import { Product, Season, Supplier, InventoryLedgerEntry, Warehouse, StockTransfer, CartItem } from '../types';
import { db } from './db';
import { getConversionFactor } from './units';

// ... existing code ...

/**
 * Helper to recursively calculate inventory deductions for a sold item.
 * Handles nested recipes, batch yields, and UOM conversions.
 * 
 * Returns a FLAT list of simple products (ingredients) to deduct from inventory.
 */
export async function calculateInventoryDeductions(
    item: CartItem | Product,
    quantitySold: number,
    allProducts: Product[]
): Promise<{ productId: string, quantityToDeduct: number }[]> {
    const deductions: { productId: string, quantityToDeduct: number }[] = [];

    // 1. If it's a simple product (no recipe), deduct directly
    if (!item.recipeDetails || item.recipeDetails.length === 0) {
        deductions.push({
            productId: item.id,
            quantityToDeduct: quantitySold
        });
        return deductions;
    }

    // 2. If it's a recipe/kit, recurse through ingredients
    const batchYield = item.batchYield || 1; // Default to 1 if not set
    const productionBatches = quantitySold / batchYield; // How many "batches" we sold

    for (const detail of item.recipeDetails) {
        const ingredient = allProducts.find(p => p.id === detail.childItemId);
        if (!ingredient) continue; // Skip if ingredient deleted

        // Calculate raw quantity needed for THIS level
        let ingredientQtyPerBatch = detail.quantity;

        // CRITICAL: Unit Conversion (Recipe Unit -> Ingredient Stock Unit)
        // If the recipe calls for 'gr' but the ingredient is tracked in 'lb', convert it.
        if (detail.unit && ingredient.measurementUnit && detail.unit !== ingredient.measurementUnit) {
            const conversionFactor = getConversionFactor(detail.unit, ingredient.measurementUnit);
            ingredientQtyPerBatch = detail.quantity * conversionFactor;
        }

        const totalIngredientNeeded = ingredientQtyPerBatch * productionBatches;

        // Recurse (Deep Recipe Support)
        const subDeductions = await calculateInventoryDeductions(ingredient, totalIngredientNeeded, allProducts);
        deductions.push(...subDeductions);
    }

    return deductions;
}

/**
 * Process Inventory Deduction for a Cart Item
 * Generates InventoryLedgerEntry objects ready to be saved.
 */
export async function processInventoryDeduction(
    transactionId: string,
    item: CartItem,
    warehouseId: string,
    terminalId: string,
    allProducts: Product[]
): Promise<InventoryLedgerEntry[]> {
    const entries: InventoryLedgerEntry[] = [];

    // 1. Calculate flat list of deductions (handling recipes/yields)
    const deductions = await calculateInventoryDeductions(item, item.quantity, allProducts);

    // 2. Consolidate deductions by Product ID (in case multiple sub-recipes use same ingredient)
    const consolidated = moveByProductId(deductions);

    // 3. Create Ledger Entries
    for (const [productId, qty] of Object.entries(consolidated)) {
        const product = allProducts.find(p => p.id === productId);
        const cost = product?.cost || 0;

        // Tracking/Variant info comes from the SOLD item, but ONLY applies if the deducted item IS the sold item
        // If we are deducting an ingredient, we don't apply the parent's tracking/variant info
        const isDirectDeduction = productId === item.id;

        if (isDirectDeduction && item.trackingData && item.trackingData.length > 0) {
            const hasLot = item.trackingData.some(t => t.type === 'LOTE' || t.type === 'LOT');

            if (hasLot) {
                // For LOTS, the selected lot(s) apply to the total quantity. 
                // Currently, the UI only allows selecting 1 lot per cart line.
                // We'll distribute the total qty equally (typically 100% to the single lot).
                const qtyPerLot = qty / item.trackingData.length;
                for (const tracking of item.trackingData) {
                    entries.push({
                        id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                        createdAt: new Date().toISOString(),
                        warehouseId,
                        productId,
                        concept: 'VENTA',
                        documentRef: transactionId,
                        qtyIn: 0,
                        qtyOut: qtyPerLot,
                        unitCost: cost,
                        balanceQty: 0,
                        balanceAvgCost: cost,
                        terminalId,
                        variantId: item.variantSku,
                        variantName: item.variantInfo,
                        trackingId: tracking.id,
                        trackingCode: tracking.code || tracking.trackingCode,
                    });
                }
            } else {
                // For SERIALS, create one ledger entry per selected serial number
                for (const tracking of item.trackingData) {
                    entries.push({
                        id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                        createdAt: new Date().toISOString(),
                        warehouseId,
                        productId,
                        concept: 'VENTA',
                        documentRef: transactionId,
                        qtyIn: 0,
                        qtyOut: 1, // Deduct 1 per serial
                        unitCost: cost,
                        balanceQty: 0,
                        balanceAvgCost: cost,
                        terminalId,
                        variantId: item.variantSku,
                        variantName: item.variantInfo,
                        trackingId: tracking.id,
                        trackingCode: tracking.code || tracking.trackingCode,
                    });
                }

                // If for some reason the total sold quantity is greater than the selected serials,
                // we deduct the remainder as a bulk untracked operation.
                const remainder = qty - item.trackingData.length;
                if (remainder > 0) {
                    entries.push({
                        id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                        createdAt: new Date().toISOString(),
                        warehouseId,
                        productId,
                        concept: 'VENTA',
                        documentRef: transactionId,
                        qtyIn: 0,
                        qtyOut: remainder,
                        unitCost: cost,
                        balanceQty: 0,
                        balanceAvgCost: cost,
                        terminalId,
                        variantId: item.variantSku,
                        variantName: item.variantInfo,
                        // Remaining items have no specific tracking info
                    });
                }
            }
        } else {
            // Standard bulk deduction (no serials selected OR it's an ingredient)
            entries.push({
                id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                createdAt: new Date().toISOString(),
                warehouseId,
                productId,
                concept: 'VENTA',
                documentRef: transactionId,
                qtyIn: 0,
                qtyOut: qty,
                unitCost: cost,
                balanceQty: 0,
                balanceAvgCost: cost,
                terminalId,
                variantId: isDirectDeduction ? item.variantSku : undefined,
                variantName: isDirectDeduction ? item.variantInfo : undefined,
                trackingId: isDirectDeduction ? item.trackingId : undefined,
                trackingCode: isDirectDeduction ? item.trackingCode : undefined
            });
        }
    }

    return entries;
}

/**
 * Transfer quantities between available stock and committed stock (reservas).
 * COMMIT increases qty_committed; RELEASE decreases qty_committed.
 */
export async function transferStockToCommitted(
    items: CartItem[],
    warehouseId: string,
    allProducts: Product[],
    mode: 'COMMIT' | 'RELEASE'
): Promise<Record<string, number>> {
    const reservationItems = (items || []).filter(item => (item.quantity || 0) > 0);
    if (reservationItems.length === 0) return {};

    const aggregated: Record<string, number> = {};

    for (const item of reservationItems) {
        const deductions = await calculateInventoryDeductions(item, item.quantity, allProducts);
        for (const d of deductions) {
            aggregated[d.productId] = (aggregated[d.productId] || 0) + d.quantityToDeduct;
        }
    }

    const sign = mode === 'COMMIT' ? 1 : -1;
    for (const [productId, qty] of Object.entries(aggregated)) {
        await db.adjustCommittedStock(productId, warehouseId, sign * qty);
    }

    return aggregated;
}

function moveByProductId(deductions: { productId: string, quantityToDeduct: number }[]): Record<string, number> {
    const minified: Record<string, number> = {};
    for (const d of deductions) {
        minified[d.productId] = (minified[d.productId] || 0) + d.quantityToDeduct;
    }
    return minified;
}

export interface InventoryCalculation {
    vmd: number;
    multiplier: number;
    leadTime: number;
    safetyStock: number;
    suggestedMin: number;
    suggestedMax: number;
    hasInsufficientData?: boolean;
    breakdown: {
        baseVmd: number;
        transferDemandVmd?: number;
        seasonName: string;
        seasonMultiplier: number;
        leadTimeDays: number;
        safetyStockQty: number;
    }
}

/**
 * Calculates suggested MIN/MAX stock levels based on sales history, 
 * seasonality multipliers, and supplier lead times for a SPECIFIC warehouse.
 */
export async function calculateOptimalInventoryLevels(
    product: Product,
    warehouseId: string,
    allSeasons: Season[],
    allSuppliers: Supplier[],
    daysLookback: number = 30
): Promise<InventoryCalculation> {
    const ledger = await db.get('inventoryLedger') as InventoryLedgerEntry[] || [];
    const warehouses = await db.get('warehouses') as Warehouse[] || [];
    const targetWarehouse = warehouses.find(w => w.id === warehouseId);

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - daysLookback);

    // 1. Calculate Local Sales VMD
    const salesEntries = ledger.filter(entry =>
        entry.productId === product.id &&
        entry.warehouseId === warehouseId &&
        entry.concept === 'VENTA' &&
        new Date(entry.createdAt) >= startDate
    );

    const totalSales = salesEntries.reduce((sum, entry) => sum + (entry.qtyOut || 0), 0);
    let totalDemand = totalSales;
    let transferDemandVmd = 0;

    // 2. CD Logic: Add Outbound Transfers if it's a Main Warehouse (DC)
    if (targetWarehouse?.isMain) {
        const transfers = await db.get('transfers') as StockTransfer[] || [];
        const outboundTransfers = transfers.filter(t =>
            t.sourceWarehouseId === warehouseId &&
            new Date(t.createdAt) >= startDate &&
            t.items.some(item => item.productId === product.id)
        );

        const totalTransferred = outboundTransfers.reduce((sum, t) => {
            const item = t.items.find(i => i.productId === product.id);
            return sum + (item?.quantity || 0);
        }, 0);

        totalDemand += totalTransferred;
        transferDemandVmd = totalTransferred / daysLookback;
    }

    const baseVmd = totalDemand / daysLookback;

    // 3. Fallback: Insufficient Data
    const hasInsufficientData = totalDemand === 0;

    // 4. Identify Applicable Season Multiplier
    let multiplier = 1.0;
    let activeSeasonName = 'Normal';

    const relevantSeasons = allSeasons.filter(s => {
        if (!s.isActive) return false;
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        const isWithinDate = now >= start && now <= end;

        const isProductIncluded = s.productIds?.includes(product.id);
        const isCategoryIncluded = s.affectedCategories?.includes(product.category);

        return isWithinDate && (isProductIncluded || isCategoryIncluded);
    });

    if (relevantSeasons.length > 0) {
        const bestSeason = relevantSeasons.reduce((prev, curr) =>
            (curr.multiplier || 1) > (prev.multiplier || 1) ? curr : prev
        );
        multiplier = bestSeason.multiplier || 1.0;
        activeSeasonName = bestSeason.name;
    }

    // 5. Get Lead Time (In a real system, this could be wh-specific as requested)
    // For now using supplier lead time.
    const primarySupplier = allSuppliers.find(s => s.id === product.primarySupplierId);
    const leadTimeDays = primarySupplier?.leadTimeDays || 7;

    // Logistic Insight: Locations further away from CD could have extra lead time
    // if (!targetWarehouse?.isMain) leadTimeDays += 1; // Example logic

    // 6. Calculate Inventory Metrics
    const adjustedVmd = baseVmd * multiplier;
    const leadTimeConsumption = adjustedVmd * leadTimeDays;
    const safetyStockQty = leadTimeConsumption * 0.20;

    const suggestedMin = Math.ceil(leadTimeConsumption + safetyStockQty);
    const suggestedMax = Math.ceil(suggestedMin * 2);

    return {
        vmd: parseFloat(adjustedVmd.toFixed(2)),
        multiplier,
        leadTime: leadTimeDays,
        safetyStock: parseFloat(safetyStockQty.toFixed(2)),
        suggestedMin: suggestedMin || 1,
        suggestedMax: suggestedMax || 2,
        hasInsufficientData,
        breakdown: {
            baseVmd: parseFloat((totalSales / daysLookback).toFixed(2)),
            transferDemandVmd: parseFloat(transferDemandVmd.toFixed(2)),
            seasonName: activeSeasonName,
            seasonMultiplier: multiplier,
            leadTimeDays,
            safetyStockQty: parseFloat(safetyStockQty.toFixed(2))
        }
    };
}
