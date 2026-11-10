import assert from 'node:assert/strict';
import test from 'node:test';
import { installPosTestRuntime } from './helpers/posTestRuntime';
import { computeInventoryBalances, type InventoryBalanceEntry } from '../utils/inventoryBalance';

/**
 * Regresión de recepción: candado de inventario, traspasos parciales y variantes,
 * exceso autorizado y valuación de stock. Todo contra `db.processReceipt` real.
 */

installPosTestRuntime();

const makeProduct = (id: string, cost = 5) => ({
  id,
  name: id,
  sku: id,
  barcode: [id],
  price: 10,
  cost,
  stock: 0,
  active: true,
  taxRate: 0,
  category: 'general',
} as any);

const makeOrder = (id: string, productId: string, quantityOrdered: number) => ({
  id,
  code: id,
  supplierId: 's1',
  supplierName: 'Proveedor',
  status: 'ORDERED',
  warehouseId: 'wh-test',
  date: '2026-09-08T10:00:00.000Z',
  items: [
    {
      productId,
      productName: productId,
      quantityOrdered,
      quantityReceived: 0,
      cost: 5,
    },
  ],
} as any);

test('el cálculo de saldos usa el costo promedio ponderado', () => {
  const { entries, balanceQty, balanceAvgCost } = computeInventoryBalances<InventoryBalanceEntry>([
    { id: 'a', createdAt: '2026-01-01T00:00:00.000Z', qtyIn: 10, qtyOut: 0, unitCost: 10 },
    { id: 'b', createdAt: '2026-01-02T00:00:00.000Z', qtyIn: 0, qtyOut: 2, unitCost: 0 },
    { id: 'c', createdAt: '2026-01-03T00:00:00.000Z', qtyIn: 10, qtyOut: 0, unitCost: 20 },
  ]);

  assert.equal(balanceQty, 18);
  assert.ok(Math.abs(balanceAvgCost - (280 / 18)) < 1e-9);
  assert.equal(entries[2].balanceQty, 18);
});

test('un almacén cerrado rechaza la recepción sin consumir la orden', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-lock'));
  await db.saveDocument('purchaseOrders', makeOrder('PO-LOCK', 'p-lock', 10));
  await db.saveDocument('inventorySnapshots', {
    id: 'snap-lock',
    warehouseId: 'wh-lock',
    status: 'CLOSED',
    closedAt: '2026-09-08T00:00:00.000Z',
  });

  await assert.rejects(
    () => db.processReceipt({
      documentType: 'PURCHASE_ORDER',
      documentId: 'PO-LOCK',
      warehouseId: 'wh-lock',
      receivedBy: 'user-1',
      receivedByUserName: 'Operador',
      effectiveDate: '2026-09-07T23:00:00.000Z',
      items: [{ productId: 'p-lock', productName: 'p-lock', expectedQty: 10, receivedQty: 10, cost: 5 }],
    }),
    /cerrado y auditado/i,
  );

  const order = (await db.getDocument('purchaseOrders', 'PO-LOCK')) as any;
  assert.equal(order.status, 'ORDERED', 'la orden no puede quedar consumida');
  assert.equal(order.items[0].quantityReceived, 0);

  const ledger = (await db.get('inventoryLedger')) as any[];
  assert.equal(ledger.filter((entry) => entry.documentRef === 'PO-LOCK').length, 0);

  const receptions = (await db.get('receptions')) as any[];
  assert.equal(receptions.filter((reception) => reception.purchaseOrderId === 'PO-LOCK').length, 0);
});

test('un traspaso recibido parcialmente queda abierto hasta completarse', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-tr'));
  await db.saveDocument('transfers', {
    id: 'TR-1',
    displayId: 'TR-1',
    sourceWarehouseId: 'wh-src',
    destinationWarehouseId: 'wh-tr',
    status: 'IN_TRANSIT',
    createdAt: '2026-09-08T09:00:00.000Z',
    items: [{ productId: 'p-tr', productName: 'p-tr', quantity: 10 }],
  } as any);

  await db.processReceipt({
    documentType: 'TRANSFER_IN',
    documentId: 'TR-1',
    warehouseId: 'wh-tr',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    discrepancyReason: 'Entrega parcial',
    items: [{ productId: 'p-tr', productName: 'p-tr', expectedQty: 10, receivedQty: 4, cost: 5 }],
  });

  const partial = (await db.getDocument('transfers', 'TR-1')) as any;
  assert.equal(partial.status, 'PARTIALLY_RECEIVED');
  assert.equal(partial.items[0].receivedQuantity, 4);
  assert.equal(partial.receivedAt, undefined);

  await db.processReceipt({
    documentType: 'TRANSFER_IN',
    documentId: 'TR-1',
    warehouseId: 'wh-tr',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    items: [{ productId: 'p-tr', productName: 'p-tr', expectedQty: 6, receivedQty: 6, cost: 5 }],
  });

  const completed = (await db.getDocument('transfers', 'TR-1')) as any;
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.items[0].receivedQuantity, 10);
  assert.ok(completed.receivedAt);

  const product = (await db.getDocument('products', 'p-tr')) as any;
  assert.equal(product.stockBalances['wh-tr'], 10);
});

test('las líneas de traspaso con variantes no se pisan entre sí', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-var'));
  await db.saveDocument('transfers', {
    id: 'TR-VAR',
    displayId: 'TR-VAR',
    sourceWarehouseId: 'wh-src',
    destinationWarehouseId: 'wh-var',
    status: 'IN_TRANSIT',
    createdAt: '2026-09-08T09:00:00.000Z',
    items: [
      { productId: 'p-var', productName: 'p-var', quantity: 5, variantSku: 'RED' },
      { productId: 'p-var', productName: 'p-var', quantity: 5, variantSku: 'BLUE' },
    ],
  } as any);

  await db.processReceipt({
    documentType: 'TRANSFER_IN',
    documentId: 'TR-VAR',
    warehouseId: 'wh-var',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    discrepancyReason: 'Faltó una variante',
    items: [
      { productId: 'p-var', productName: 'p-var', expectedQty: 5, receivedQty: 5, cost: 5, variantSku: 'RED' },
      { productId: 'p-var', productName: 'p-var', expectedQty: 5, receivedQty: 3, cost: 5, variantSku: 'BLUE' },
    ],
  });

  const transfer = (await db.getDocument('transfers', 'TR-VAR')) as any;
  assert.equal(transfer.status, 'PARTIALLY_RECEIVED');
  assert.equal(transfer.items[0].receivedQuantity, 5);
  assert.equal(transfer.items[1].receivedQuantity, 3);

  const ledger = (await db.get('inventoryLedger')) as any[];
  const movements = ledger.filter((entry) => entry.documentRef === 'TR-VAR');
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map((entry) => [entry.variantId, entry.qtyIn]).sort(), [['BLUE', 3], ['RED', 5]]);
});

test('el exceso exige motivo y se registra completo, sin recortes silenciosos', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-over'));
  await db.saveDocument('purchaseOrders', makeOrder('PO-OVER', 'p-over', 10));

  const payload = {
    documentType: 'PURCHASE_ORDER' as const,
    documentId: 'PO-OVER',
    warehouseId: 'wh-over',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    items: [{ productId: 'p-over', productName: 'p-over', expectedQty: 10, receivedQty: 12, cost: 5 }],
  };

  await assert.rejects(() => db.processReceipt(payload), /exceso de mercancía/i);

  const order = (await db.getDocument('purchaseOrders', 'PO-OVER')) as any;
  assert.equal(order.items[0].quantityReceived, 0, 'sin motivo no se escribe nada');

  await db.processReceipt({ ...payload, discrepancyReason: 'El proveedor envió de más' });

  const updated = (await db.getDocument('purchaseOrders', 'PO-OVER')) as any;
  assert.equal(updated.items[0].quantityReceived, 12);
  assert.equal(updated.status, 'COMPLETED');

  const ledger = (await db.get('inventoryLedger')) as any[];
  const movements = ledger.filter((entry) => entry.documentRef === 'PO-OVER');
  assert.equal(movements.length, 1);
  assert.equal(movements[0].qtyIn, 12, 'el inventario debe reflejar lo recibido real');
});

test('la recepción guarda la cantidad pedida y no el remanente', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-qo'));
  await db.saveDocument('purchaseOrders', makeOrder('PO-QO', 'p-qo', 10));

  await db.processReceipt({
    documentType: 'PURCHASE_ORDER',
    documentId: 'PO-QO',
    warehouseId: 'wh-qo',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    discrepancyReason: 'Entrega parcial',
    items: [{ productId: 'p-qo', productName: 'p-qo', expectedQty: 10, receivedQty: 4, cost: 5 }],
  });

  const second = await db.processReceipt({
    documentType: 'PURCHASE_ORDER',
    documentId: 'PO-QO',
    warehouseId: 'wh-qo',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    items: [{ productId: 'p-qo', productName: 'p-qo', expectedQty: 6, receivedQty: 6, cost: 5 }],
  });

  assert.equal(second.reception.items[0].quantityOrdered, 10, 'debe registrar lo ordenado, no las 6 restantes');
  assert.equal(second.reception.items[0].quantityReceived, 6);
});

test('el costo promedio del producto se actualiza con cada entrada', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-wac', 0));
  await db.saveDocument('purchaseOrders', makeOrder('PO-WAC', 'p-wac', 20));

  await db.processReceipt({
    documentType: 'PURCHASE_ORDER',
    documentId: 'PO-WAC',
    warehouseId: 'wh-wac',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    discrepancyReason: 'Entrega parcial programada',
    items: [{ productId: 'p-wac', productName: 'p-wac', expectedQty: 20, receivedQty: 10, cost: 10 }],
  });

  const firstProduct = (await db.getDocument('products', 'p-wac')) as any;
  assert.equal(firstProduct.stockBalances['wh-wac'], 10);
  assert.equal(firstProduct.cost, 10);

  await db.processReceipt({
    documentType: 'PURCHASE_ORDER',
    documentId: 'PO-WAC',
    warehouseId: 'wh-wac',
    receivedBy: 'user-1',
    receivedByUserName: 'Operador',
    items: [{ productId: 'p-wac', productName: 'p-wac', expectedQty: 10, receivedQty: 10, cost: 20 }],
  });

  const secondProduct = (await db.getDocument('products', 'p-wac')) as any;
  assert.equal(secondProduct.stockBalances['wh-wac'], 20);
  assert.ok(Math.abs(secondProduct.cost - 15) < 1e-9, 'costo promedio ponderado = 15');

  const stock = (await db.getDocument('productStocks', 'p-wac_wh-wac')) as any;
  assert.equal(stock.qtyPhysical, 20);
  assert.equal(stock.qtyAvailable, 20);
});

test('recordInventoryMovements sigue recalculando el stock del producto', async () => {
  const { db } = await import('../utils/db');
  await db.init('PDA-1');

  await db.saveDocument('products', makeProduct('p-legacy', 4));

  await db.recordInventoryMovements([
    {
      warehouseId: 'wh-legacy',
      productId: 'p-legacy',
      concept: 'AJUSTE_ENTRADA',
      documentRef: 'ADJ-1',
      qty: 7,
      movementCost: 4,
    },
  ]);

  const product = (await db.getDocument('products', 'p-legacy')) as any;
  assert.equal(product.stockBalances['wh-legacy'], 7);
  assert.equal(product.cost, 4);

  const stock = (await db.getDocument('productStocks', 'p-legacy_wh-legacy')) as any;
  assert.equal(stock.qtyPhysical, 7);
});
