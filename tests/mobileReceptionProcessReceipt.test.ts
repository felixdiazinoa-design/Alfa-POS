import assert from 'node:assert/strict';
import test from 'node:test';
import { installPosTestRuntime } from './helpers/posTestRuntime';

/**
 * Regresión financiera: reenviar la misma recepción no puede sumar stock dos veces.
 * Se ejecuta el camino real (`db.processReceipt`) contra IndexedDB en memoria.
 */

installPosTestRuntime();

const product = {
  id: 'p1',
  name: 'Producto de prueba',
  sku: 'P1',
  barcode: ['111'],
  price: 10,
  cost: 5,
  stock: 0,
  active: true,
  taxRate: 0,
  category: 'general',
} as any;

const purchaseOrder = {
  id: 'PO-1',
  code: 'OC-1',
  supplierId: 's1',
  supplierName: 'Proveedor',
  status: 'ORDERED',
  warehouseId: 'wh1',
  date: '2026-09-08T10:00:00.000Z',
  items: [
    {
      productId: 'p1',
      productName: 'Producto de prueba',
      quantityOrdered: 10,
      quantityReceived: 0,
      cost: 5,
    },
  ],
} as any;

const receiptPayload = {
  documentType: 'PURCHASE_ORDER' as const,
  documentId: 'PO-1',
  warehouseId: 'wh1',
  receivedBy: 'user-1',
  receivedByUserName: 'Operador',
  terminalId: 'PDA-1',
  items: [
    {
      productId: 'p1',
      productName: 'Producto de prueba',
      expectedQty: 10,
      receivedQty: 10,
      cost: 5,
    },
  ],
};

test('processReceipt no duplica stock ni recepción al reenviar el mismo intento', async () => {
  const { db } = await import('../utils/db');

  await db.init('PDA-1');
  await db.saveDocument('products', { ...product });
  await db.saveDocument('purchaseOrders', { ...purchaseOrder, items: purchaseOrder.items.map((item: any) => ({ ...item })) });

  const first = await db.processReceipt({ ...receiptPayload, items: receiptPayload.items.map((item) => ({ ...item })) });

  // Mismo payload, como haría un replay de la cola tras una caída.
  const second = await db.processReceipt({ ...receiptPayload, items: receiptPayload.items.map((item) => ({ ...item })) });

  assert.equal(second.reception.id, first.reception.id, 'el reenvío debe devolver la recepción original');
  assert.deepEqual(second.autoPrintItems, [], 'un reenvío no debe reimprimir etiquetas');

  const ledger = (await db.get('inventoryLedger')) as any[];
  const movements = ledger.filter((entry) => entry.documentRef === 'PO-1');
  assert.equal(movements.length, 1, 'solo puede existir un movimiento de inventario');
  assert.equal(movements[0].qtyIn, 10);

  const receptions = (await db.get('receptions')) as any[];
  assert.equal(receptions.filter((reception) => reception.purchaseOrderId === 'PO-1').length, 1);

  const index = (await db.get('receptionIdempotency')) as any[];
  assert.equal(index.length, 1);
  assert.equal(index[0].receptionId, first.reception.id);

  const savedOrder = (await db.getDocument('purchaseOrders', 'PO-1')) as any;
  assert.equal(savedOrder.status, 'COMPLETED');
  assert.equal(savedOrder.items[0].quantityReceived, 10);

  const savedProduct = (await db.getDocument('products', 'p1')) as any;
  assert.equal(savedProduct.stockBalances.wh1, 10, 'el stock no puede duplicarse');
});

test('una segunda entrega con cantidades distintas sí se registra', async () => {
  const { db } = await import('../utils/db');

  await db.saveDocument('purchaseOrders', {
    ...purchaseOrder,
    id: 'PO-2',
    code: 'OC-2',
    items: [{ ...purchaseOrder.items[0] }],
  });

  const firstDrop = await db.processReceipt({
    ...receiptPayload,
    documentId: 'PO-2',
    discrepancyReason: 'Entrega parcial programada',
    items: [{ ...receiptPayload.items[0], expectedQty: 10, receivedQty: 4 }],
  });
  const secondDrop = await db.processReceipt({
    ...receiptPayload,
    documentId: 'PO-2',
    items: [{ ...receiptPayload.items[0], expectedQty: 6, receivedQty: 6 }],
  });

  assert.notEqual(secondDrop.reception.id, firstDrop.reception.id);

  const savedOrder = (await db.getDocument('purchaseOrders', 'PO-2')) as any;
  assert.equal(savedOrder.items[0].quantityReceived, 10);
  assert.equal(savedOrder.status, 'COMPLETED');
});
