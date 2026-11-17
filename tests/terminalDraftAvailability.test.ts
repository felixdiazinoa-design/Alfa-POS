import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlaceholderDeviceId,
  normalizeRealDeviceId,
  normalizeTerminalBindingRecord,
} from '../utils/terminalBindingHierarchy';

const DRAFT = 'DRAFT-862ADB8B-POS-002-1AFEF5953D934957B9C022E3FCF344A5';

test('un device DRAFT es placeholder, no un equipo real', () => {
  assert.equal(isPlaceholderDeviceId(DRAFT), true);
  assert.equal(isPlaceholderDeviceId(''), true);
  assert.equal(isPlaceholderDeviceId(null), true);
  assert.equal(isPlaceholderDeviceId('DEV-M16JQ5A9'), false);
  assert.equal(normalizeRealDeviceId(DRAFT), undefined);
  assert.equal(normalizeRealDeviceId('DEV-M16JQ5A9'), 'DEV-M16JQ5A9');
});

test('una terminal recién creada con DRAFT aparece DISPONIBLE', () => {
  const record = normalizeTerminalBindingRecord(
    { id: '1afef595-3d93-4957-b9c0-22e3fcf344a5', name: 'Caja 02', device_id: DRAFT, is_occupied: false },
    { deviceId: 'DEV-NUEVO' },
  );

  assert.equal(record.occupied, false);
  assert.equal(record.currentDeviceId, undefined);
  assert.equal(record.canReauthorize, false);
});

test('si el ERP manda binding_status OCCUPIED sin device real, manda el device', () => {
  const withDraft = normalizeTerminalBindingRecord(
    { id: 'x', device_id: DRAFT, binding_status: 'OCCUPIED' },
    { deviceId: 'DEV-NUEVO' },
  );
  assert.equal(withDraft.occupied, false);

  const withRealDevice = normalizeTerminalBindingRecord(
    { id: 'x', device_id: 'ANDROID-7B142529B32C2EBB' },
    { deviceId: 'DEV-NUEVO' },
  );
  assert.equal(withRealDevice.occupied, true);
  assert.equal(withRealDevice.currentDeviceId, 'ANDROID-7B142529B32C2EBB');
});

test('una terminal vinculada a este mismo equipo no está ocupada', () => {
  const record = normalizeTerminalBindingRecord(
    { id: 'x', device_id: 'DEV-NUEVO' },
    { deviceId: 'DEV-NUEVO' },
  );
  assert.equal(record.occupied, false);
});
