import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVENTORY_WHOLE_WAREHOUSE_LABEL,
  buildInventoryScopeKey,
  inventoryScopeDisplayLabel,
  isWholeWarehouseScope,
  normalizeInventoryScopeLabel,
} from '../utils/inventoryScope';

test('normaliza mayúsculas, acentos y espacios sobrantes', () => {
  assert.equal(normalizeInventoryScopeLabel('  Pasillo   A '), 'pasillo a');
  assert.equal(normalizeInventoryScopeLabel('PASILLO Á'), 'pasillo a');
  assert.equal(normalizeInventoryScopeLabel('Bodega  Ñeco'), 'bodega neco');
  assert.equal(normalizeInventoryScopeLabel(''), '');
});

test('dos PDAs que escriben la misma zona coinciden en la clave', () => {
  const first = buildInventoryScopeKey('WH-1', 'Pasillo A');
  const second = buildInventoryScopeKey('WH-1', '  pasillo   a ');

  assert.equal(first, 'WH-1::pasillo a');
  assert.equal(second, first);
});

test('zonas distintas no comparten bloqueo', () => {
  assert.notEqual(
    buildInventoryScopeKey('WH-1', 'Pasillo A'),
    buildInventoryScopeKey('WH-1', 'Pasillo B'),
  );
  assert.notEqual(
    buildInventoryScopeKey('WH-1', 'Pasillo A'),
    buildInventoryScopeKey('WH-2', 'Pasillo A'),
  );
});

test('el almacén completo usa el comodín y no colisiona con una zona', () => {
  assert.equal(buildInventoryScopeKey('WH-1', ''), 'WH-1::*');
  assert.equal(buildInventoryScopeKey('WH-1', null), 'WH-1::*');
  assert.notEqual(
    buildInventoryScopeKey('WH-1', null),
    buildInventoryScopeKey('WH-1', 'Pasillo A'),
  );
  assert.equal(isWholeWarehouseScope(''), true);
  assert.equal(isWholeWarehouseScope('Pasillo A'), false);
});

test('la etiqueta visible cae al almacén completo cuando no hay zona', () => {
  assert.equal(inventoryScopeDisplayLabel('Pasillo A'), 'Pasillo A');
  assert.equal(inventoryScopeDisplayLabel(''), INVENTORY_WHOLE_WAREHOUSE_LABEL);
  assert.equal(inventoryScopeDisplayLabel(null), INVENTORY_WHOLE_WAREHOUSE_LABEL);
});
