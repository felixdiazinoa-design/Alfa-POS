import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  RECEPTION_IDEMPOTENCY_RETENTION_MS,
  isReceptionIdempotencyExpired,
} from '../utils/receptionIdempotency';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('el índice de idempotencia se poda pasado el periodo de retención', () => {
  const now = Date.parse('2026-09-08T12:00:00.000Z');

  assert.equal(isReceptionIdempotencyExpired('2026-09-08T11:00:00.000Z', now), false);
  assert.equal(isReceptionIdempotencyExpired('2026-07-01T00:00:00.000Z', now), true);
  assert.equal(isReceptionIdempotencyExpired('no-es-fecha', now), true);
  assert.equal(
    isReceptionIdempotencyExpired(
      new Date(now - RECEPTION_IDEMPOTENCY_RETENTION_MS - 1000).toISOString(),
      now,
    ),
    true,
  );
});

test('el conteo se envía por el canal operativo y no por la ruta inexistente del Master', () => {
  const source = read('services/sync/ApiSyncAdapter.ts');

  assert.match(source, /postOperationalPayload\('\/inventory\/counts'/);
  assert.doesNotMatch(source, /masterUrl\}\/api\/sync\/inventory\/counts/);
});

test('la cola ya no lee colecciones zombis de conteo', () => {
  const source = read('hooks/useOfflineSync.ts');

  assert.doesNotMatch(source, /offline_count_queue|offline_count_conflicts/);
});

test('sobrescribir un conflicto no reaplica un stock ya aplicado', () => {
  const source = read('hooks/useOfflineSync.ts');

  assert.match(source, /localApplied: Boolean\(base\.localApplied\)/);
  assert.match(source, /appliedReceptionId: base\.appliedReceptionId/);
});

test('el índice de idempotencia se poda como máximo una vez al día', () => {
  const source = read('utils/db.ts');

  assert.match(source, /pruneReceptionIdempotencyIfDue/);
  assert.match(source, /RECEPTION_IDEMPOTENCY_PRUNE_INTERVAL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /isReceptionIdempotencyExpired\(record\.createdAt, now\)/);
  assert.match(source, /void pruneReceptionIdempotencyIfDue\(\);/);
});

test('el recálculo de lote reutiliza una sola lectura del ledger', () => {
  const source = read('utils/db.ts');

  assert.match(source, /preloadedLedger\?: InventoryLedgerEntry\[\]/);
  assert.match(source, /preloadedLedger \?\? \(await dbAdapter\.getCollection/);
  assert.match(source, /const ledgerSnapshot = \(await dbAdapter\.getCollection<InventoryLedgerEntry>/);
  assert.match(source, /recalculateProductStock\(productId, warehouseId, ledgerSnapshot\)/);
});

test('el mensaje del conteo no afirma que se envió si puede quedar en cola', () => {
  const source = read('components/inventory/InventoryCount.tsx');

  assert.match(source, /Se está enviando al servidor; si falla, queda en la cola/);
  assert.doesNotMatch(source, /enviado al master/);
});
