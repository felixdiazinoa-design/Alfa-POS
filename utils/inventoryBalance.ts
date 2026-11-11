/**
 * Cálculo puro de saldos de inventario (cantidad y costo promedio ponderado).
 *
 * Vive aparte para que el recálculo de stock pueda ejecutarse tanto por escritura
 * directa (`db.recalculateProductStock`) como dentro de un commit atómico de
 * recepción, sin duplicar la fórmula.
 */

export interface InventoryBalanceEntry {
  id: string;
  createdAt: string;
  qtyIn: number;
  qtyOut: number;
  unitCost: number;
  balanceQty?: number;
  balanceAvgCost?: number;
}

export interface InventoryBalanceResult<T extends InventoryBalanceEntry> {
  entries: T[];
  balanceQty: number;
  balanceAvgCost: number;
}

export const buildInventoryLineKey = (productId: unknown, variantSku?: unknown): string => (
  `${String(productId ?? '').trim()}::${String(variantSku ?? '').trim() || 'base'}`
);

export const computeInventoryBalances = <T extends InventoryBalanceEntry>(
  entries: readonly T[],
): InventoryBalanceResult<T> => {
  const sorted = [...entries].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id).localeCompare(String(b.id));
  });

  let balanceQty = 0;
  let balanceAvgCost = 0;

  const balanced = sorted.map((entry) => {
    const qtyIn = Number(entry.qtyIn) || 0;
    const qtyOut = Number(entry.qtyOut) || 0;
    const unitCost = Number(entry.unitCost) || 0;

    balanceQty += qtyIn - qtyOut;

    if (qtyIn > 0) {
      const previousBalance = balanceQty - qtyIn;

      if (previousBalance <= 0) {
        // Si el saldo previo era negativo o cero, se reinicia la valuación con
        // esta entrada para no arrastrar una base corrupta.
        balanceAvgCost = unitCost;
      } else {
        const previousValue = previousBalance * balanceAvgCost;
        const incomingValue = qtyIn * unitCost;
        balanceAvgCost = (previousValue + incomingValue) / balanceQty;
      }
    }

    return { ...entry, balanceQty, balanceAvgCost };
  });

  return { entries: balanced, balanceQty, balanceAvgCost };
};
