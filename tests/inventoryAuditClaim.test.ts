import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  AuditSessionConflictError,
  AuditSessionUnavailableError,
  AuditSessionUnsupportedError,
  InventoryAuditSessionClient,
} from '../services/inventory/InventoryAuditSessionClient';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const jsonResponse = (body: any, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const BASE = 'http://master:3001/api/audit';

const input = {
  warehouseId: 'wh-1',
  deviceId: 'DEV-A',
  terminalId: 'PDA-1',
  userId: 'u1',
  userName: 'Ana',
};

const holderSession = {
  id: 'S-OTHER',
  warehouseId: 'wh-1',
  startedAt: '2026-09-08T12:00:00.000Z',
  deviceId: 'DEV-B',
  terminalId: 'PDA-2',
  userName: 'Luis',
};

test('el claim reserva el alcance en una sola llamada al Master', async () => {
  const calls: string[] = [];
  let sentBody: any = null;
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/start')) {
        sentBody = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          success: true,
          reused: false,
          session: { ...holderSession, id: 'S-1', deviceId: 'DEV-A', userName: 'Ana' },
        });
      }
      throw new Error(`llamada inesperada: ${url}`);
    },
  });

  const result = await client.claim({
    ...input,
    scopeKey: 'wh-1::pasillo a',
    locationLabel: 'Pasillo A',
  });

  assert.equal(result.session.id, 'S-1');
  assert.equal(result.reused, false);
  assert.deepEqual(calls, [`POST ${BASE}/start`]);
  assert.equal(sentBody.scopeKey, 'wh-1::pasillo a');
  assert.equal(sentBody.locationLabel, 'Pasillo A');
});

test('si otra PDA tiene el alcance, el claim falla con el titular', async () => {
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async () => jsonResponse({
      success: false,
      error: 'AUDIT_SESSION_IN_PROGRESS',
      message: 'El almacén está en conteo por Luis.',
      holder: holderSession,
    }, 409),
  });

  await assert.rejects(
    () => client.claim(input),
    (error: unknown) => {
      assert.ok(error instanceof AuditSessionConflictError);
      assert.equal(error.code, 'AUDIT_SESSION_IN_PROGRESS');
      assert.equal(error.holder?.terminalId, 'PDA-2');
      assert.match(error.message, /Luis/);
      return true;
    },
  );
});

test('si la sesión es de esta PDA, el Master la reutiliza', async () => {
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async () => jsonResponse({
      success: true,
      reused: true,
      session: { ...holderSession, id: 'S-1', deviceId: 'DEV-A' },
    }),
  });

  const result = await client.claim(input);

  assert.equal(result.session.id, 'S-1');
  assert.equal(result.reused, true);
});

test('la toma de control envía force y el motivo', async () => {
  let sentBody: any = null;
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/start')) {
        sentBody = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          success: true,
          reused: false,
          session: { ...holderSession, id: 'S-2', deviceId: 'DEV-A' },
        });
      }
      throw new Error(`llamada inesperada: ${url}`);
    },
  });

  await client.takeOver({ ...input, reason: 'La PDA anterior se apagó' });

  assert.equal(sentBody.force, true);
  assert.equal(sentBody.reason, 'La PDA anterior se apagó');
  assert.equal(sentBody.deviceId, 'DEV-A');
});

test('un master sin endpoints de auditoría se reporta como no soportado', async () => {
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async () => jsonResponse({ message: 'Endpoint no disponible' }, 404),
  });

  await assert.rejects(() => client.claim(input), AuditSessionUnsupportedError);
});

test('un master caído o sin respuesta se reporta como no disponible', async () => {
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });

  await assert.rejects(() => client.claim(input), AuditSessionUnavailableError);
});

test('el heartbeat detecta que otra PDA tomó el almacén', async () => {
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async (url) => {
      if (url.endsWith('/S-1/heartbeat')) {
        return jsonResponse({ success: false, error: 'AUDIT_SESSION_OWNED_BY_OTHER', holder: holderSession }, 409);
      }
      throw new Error(`llamada inesperada: ${url}`);
    },
  });

  await assert.rejects(
    () => client.heartbeat('S-1', 'DEV-A'),
    (error: unknown) => error instanceof AuditSessionConflictError && error.holder?.deviceId === 'DEV-B',
  );
});

test('liberar envía el dispositivo y el motivo', async () => {
  let sentBody: any = null;
  const client = new InventoryAuditSessionClient({
    baseUrl: BASE,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/S-1/release')) {
        sentBody = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({ success: true });
      }
      throw new Error(`llamada inesperada: ${url}`);
    },
  });

  await client.release('S-1', 'DEV-A', { reason: 'Conteo terminado' });

  assert.deepEqual(sentBody, { deviceId: 'DEV-A', force: false, reason: 'Conteo terminado' });
});

test('el master Android expone el bloqueo de conteo con TTL', () => {
  const source = read('native-stubs/android/ClicPOSMasterHttpServer.kt');

  assert.match(source, /AUDIT_CLAIM_TTL_MS = 15 \* 60 \* 1000L/);
  assert.match(source, /private val auditSessions = ConcurrentHashMap<String, JSONObject>\(\)/);
  assert.match(source, /path == "\/api\/audit\/start"/);
  assert.match(source, /path\.startsWith\("\/api\/audit\/active\/"\)/);
  assert.match(source, /path\.endsWith\("\/heartbeat"\)/);
  assert.match(source, /path\.endsWith\("\/release"\)/);
  assert.match(source, /"AUDIT_SESSION_IN_PROGRESS"/);
  assert.match(source, /writeResponse\(socket, 409/);
  // El claim se decide dentro del lock para que dos PDAs simultáneas no creen dos sesiones.
  assert.match(source, /synchronized\(auditSessions\)/);
  // El alcance es almacén + ubicación, no solo almacén.
  assert.match(source, /buildAuditScopeKey/);
  assert.match(source, /findAuditSessionForScope/);
  assert.match(source, /\.put\("scopeKey", scopeKey\)/);
  assert.match(source, /\.put\("locationLabel", locationLabel\)/);
});

test('el servidor Node caduca bloqueos y permite toma de control', () => {
  const source = read('server/routes/auditRoutes.ts');

  assert.match(source, /AUDIT_CLAIM_TTL_MS/);
  assert.match(source, /expireStaleSessions/);
  assert.match(source, /router\.post\('\/:sessionId\/heartbeat'/);
  assert.match(source, /router\.post\('\/:sessionId\/release'/);
  assert.match(source, /AUDIT_SESSION_IN_PROGRESS/);
  assert.match(source, /status = 'TAKEN_OVER'/);
  assert.match(source, /holder: toSessionPayload/);
  assert.match(source, /res\.status\(409\)/);
  assert.match(source, /buildScopeKey/);
  assert.match(source, /findOpenSessionByScope/);
});

test('el conteo del PDA usa el bloqueo y sincroniza al guardar', () => {
  const source = read('components/inventory/InventoryCount.tsx');

  assert.match(source, /useInventoryCountClaim\(\{/);
  assert.match(source, /claim\.state === 'BLOCKED'/);
  assert.match(source, /Tomar el control/);
  assert.match(source, /claim\.takeOver\(reason\)/);
  assert.match(source, /claimSessionId: claim\.session\?\.id \|\| null/);
  assert.match(source, /await processPendingQueue\(\)/);
  assert.match(source, /await claim\.release\(\)/);
  // La ubicación se elige antes de reclamar y viaja en el conteo.
  assert.match(source, /InventoryScopePicker/);
  assert.match(source, /locationLabel: scope\?\.label \?\? null/);
});

test('el selector de ubicación persiste el catálogo y normaliza el alcance', () => {
  const picker = read('components/inventory/InventoryScopePicker.tsx');
  const scope = read('utils/inventoryScope.ts');
  const db = read('utils/db.ts');
  const adapter = read('services/db/adapters/IndexedDBAdapter.ts');

  assert.match(picker, /db\.get\('locations'/);
  assert.match(picker, /db\.saveDocument\('locations'/);
  assert.match(picker, /onConfirm\(\{ label: null, locationId: null \}\)/);
  assert.match(picker, /onConfirm\(\{ label: location\.name, locationId: location\.id \}\)/);

  assert.match(scope, /normalizeInventoryScopeLabel/);
  assert.match(scope, /buildInventoryScopeKey/);
  assert.match(scope, /::\$\{label \|\| '\*'\}/);

  assert.match(db, /locations: \[\] as InventoryLocation\[\]/);
  assert.match(adapter, /'receptionIdempotency', 'locations'/);
  assert.match(adapter, /DB_VERSION = 25/);
});
