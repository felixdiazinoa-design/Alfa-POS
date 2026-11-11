import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  DuplicateReceptionError,
  RECEPTION_IDEMPOTENCY_WINDOW_MS,
  buildBlockedReceptionDocumentKeys,
  buildReceptionIdempotencyKey,
  findQueuedReceptionForDocument,
  isDuplicateReceptionError,
  isReceptionIdempotencyFresh,
  receptionDocumentKey,
} from '../utils/receptionIdempotency';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const lines = [
  { productId: 'p1', variantSku: undefined, expectedQty: 10, receivedQty: 10 },
  { productId: 'p2', variantSku: 'SKU-R', expectedQty: 4, receivedQty: 3 },
];

const keyFor = (overrides: Partial<Parameters<typeof buildReceptionIdempotencyKey>[0]> = {}) => (
  buildReceptionIdempotencyKey({
    documentType: 'PURCHASE_ORDER',
    documentId: 'PO-1',
    receivedBy: 'user-1',
    items: lines,
    ...overrides,
  })
);

test('la clave es determinista y no depende del orden de las líneas', () => {
  const first = keyFor();
  const second = keyFor();
  const reversed = keyFor({ items: [...lines].reverse() });

  assert.equal(first, second);
  assert.equal(first, reversed);
  assert.match(first, /^RID-[0-9a-f]{16}$/);
});

test('recibir el mismo documento con cantidades distintas es otro intento', () => {
  const first = keyFor();
  const secondDelivery = keyFor({
    items: [
      { productId: 'p1', variantSku: undefined, expectedQty: 10, receivedQty: 10 },
      { productId: 'p2', variantSku: 'SKU-R', expectedQty: 1, receivedQty: 1 },
    ],
  });
  const moreUnits = keyFor({ items: [{ productId: 'p1', expectedQty: 10, receivedQty: 11 }] });
  const otherUser = keyFor({ receivedBy: 'user-2' });
  const otherDocument = keyFor({ documentId: 'PO-2' });
  const otherType = keyFor({ documentType: 'TRANSFER_IN' });
  const otherVariant = keyFor({ items: [{ productId: 'p1', variantSku: 'SKU-R', expectedQty: 10, receivedQty: 10 }] });

  for (const candidate of [secondDelivery, moreUnits, otherUser, otherDocument, otherType, otherVariant]) {
    assert.notEqual(candidate, first);
  }
});

test('una segunda entrega del mismo documento cambia porque cambia el esperado', () => {
  // PO de 20: primera entrega de 10 (esperado 20) y segunda de 10 (esperado 10).
  const firstDrop = keyFor({ items: [{ productId: 'p1', expectedQty: 20, receivedQty: 10 }] });
  const secondDrop = keyFor({ items: [{ productId: 'p1', expectedQty: 10, receivedQty: 10 }] });

  assert.notEqual(firstDrop, secondDrop);
});

test('las líneas sin cantidad recibida no alteran la clave', () => {
  const base = keyFor();
  const withEmptyLine = keyFor({
    items: [...lines, { productId: 'p3', expectedQty: 5, receivedQty: 0 }],
  });

  assert.equal(base, withEmptyLine);
});

test('la ventana de idempotencia expira y tolera desfase de reloj', () => {
  const now = Date.parse('2026-09-08T12:00:00.000Z');

  assert.equal(isReceptionIdempotencyFresh('2026-09-08T11:59:00.000Z', now), true);
  assert.equal(isReceptionIdempotencyFresh(new Date(now).toISOString(), now), true);
  assert.equal(isReceptionIdempotencyFresh('2026-09-08T12:00:30.000Z', now), true);
  assert.equal(isReceptionIdempotencyFresh('2026-09-07T11:00:00.000Z', now), false);
  assert.equal(isReceptionIdempotencyFresh('no-es-fecha', now), false);
  assert.equal(
    isReceptionIdempotencyFresh('2026-09-08T11:00:00.000Z', now, RECEPTION_IDEMPOTENCY_WINDOW_MS),
    true,
  );
});

test('el dedupe de cola bloquea solo recepciones activas del mismo documento', () => {
  const queue = [
    { status: 'PENDING', documentType: 'PURCHASE_ORDER', documentId: 'PO-1' },
    { status: 'SYNCED', documentType: 'PURCHASE_ORDER', documentId: 'PO-2' },
    { status: 'ERROR', documentType: 'TRANSFER_IN', documentId: 'TR-1' },
    { status: 'PENDING', documentType: 'INVENTORY_COUNT', documentId: 'CNT-1' },
    { status: 'PENDING', payload: { documentType: 'PURCHASE_ORDER', documentId: 'PO-9' } },
  ];

  assert.ok(findQueuedReceptionForDocument(queue, 'PURCHASE_ORDER', 'PO-1'));
  assert.ok(findQueuedReceptionForDocument(queue, 'TRANSFER_IN', 'TR-1'));
  assert.ok(findQueuedReceptionForDocument(queue, 'PURCHASE_ORDER', 'PO-9'));
  assert.equal(findQueuedReceptionForDocument(queue, 'PURCHASE_ORDER', 'PO-2'), null);
  assert.equal(findQueuedReceptionForDocument(queue, 'PURCHASE_ORDER', 'CNT-1'), null);

  assert.deepEqual(
    buildBlockedReceptionDocumentKeys(queue),
    [receptionDocumentKey('PURCHASE_ORDER', 'PO-1'), receptionDocumentKey('PURCHASE_ORDER', 'PO-9'), receptionDocumentKey('TRANSFER_IN', 'TR-1')].sort(),
  );
});

test('el error de duplicado se identifica por código', () => {
  const error = new DuplicateReceptionError();
  assert.equal(error.code, 'RECEPTION_ALREADY_QUEUED');
  assert.equal(isDuplicateReceptionError(error), true);
  assert.equal(isDuplicateReceptionError(new Error('otro')), false);
});

test('processReceipt corta el reenvío antes de mover inventario', () => {
  const source = read('utils/db.ts');

  assert.match(source, /RECEPTION_IDEMPOTENCY_COLLECTION/);
  assert.match(source, /isReceptionIdempotencyFresh\(previousAttempt\.createdAt\)/);
  assert.match(source, /previousReception/);
  assert.match(source, /autoPrintItems: \[\]/);
  assert.match(source, /idempotencyKey,\n\s+syncStatus: 'PENDING'/);
  // El índice se publica junto a la recepción, no después de un salto de red.
  assert.match(source, /collectionName: RECEPTION_IDEMPOTENCY_COLLECTION/);
});

test('la recepción móvil bloquea doble pulsación y documentos ya encolados', () => {
  const source = read('components/inventory/MobileReception.tsx');

  assert.match(source, /if \(!selectedDocument \|\| isSaving\) return;/);
  const savingIndex = source.indexOf('setIsSaving(true);');
  const offlineBranchIndex = source.indexOf('if (!isOnline) {');
  assert.ok(savingIndex > 0 && savingIndex < offlineBranchIndex, 'isSaving debe activarse antes de la rama offline');
  assert.match(source, /idempotencyKey: buildReceptionIdempotencyKey\(/);
  assert.match(source, /blockedKeys\.has\(receptionDocumentKey\(doc\.type, doc\.id\)\)/);
  assert.match(source, /alreadyApplied/);
});

test('la cola rechaza una segunda recepción del mismo documento', () => {
  const source = read('hooks/useOfflineSync.ts');

  assert.match(source, /findQueuedReceptionForDocument\(queue, documentType, payload\.documentId\)/);
  assert.match(source, /throw new DuplicateReceptionError/);
  assert.match(source, /previousAttempt/);
  assert.match(source, /setBlockedDocumentKeys\(buildBlockedReceptionDocumentKeys\(queue\)\)/);
});
