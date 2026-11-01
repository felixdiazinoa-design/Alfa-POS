import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const localStorage = new MemoryStorage();
Object.assign(globalThis, { localStorage });

const {
  DEFAULT_PUBLIC_ERP_BASE_URL,
  EXPECTED_ERP_SUPABASE_PROJECT_REF,
  LEGACY_PUBLIC_ERP_BASE_URL,
  normalizeErpBaseUrl,
  normalizeErpSyncApiBase,
  resolveErpSyncApiBase,
} = await import('../utils/erpBaseUrl');

const { mapErpSyncError, readErpProjectRef, readErpVersionCapabilities, toErpInboxEvent } =
  await import('../utils/erpSyncContract');

// ---------------------------------------------------------------------------
// T1: base canónica
// ---------------------------------------------------------------------------

test('la base canónica del ERP es Alfa-RMS', () => {
  assert.equal(DEFAULT_PUBLIC_ERP_BASE_URL, 'https://alfa-rms.vercel.app');
  assert.notEqual(DEFAULT_PUBLIC_ERP_BASE_URL, LEGACY_PUBLIC_ERP_BASE_URL);
  assert.equal(EXPECTED_ERP_SUPABASE_PROJECT_REF, 'tcbleyxjwpopoierbkzo');
});

test('sin overrides la base de sync resuelta es la de Alfa-RMS', () => {
  localStorage.clear();
  assert.equal(resolveErpSyncApiBase(), 'https://alfa-rms.vercel.app/api/sync');
});

test('un override explícito gana sobre la base canónica y se normaliza', () => {
  localStorage.setItem('CLIC_ERP_SYNC_URL', 'https://staging.example.com/api/sync/');
  assert.equal(resolveErpSyncApiBase(), 'https://staging.example.com/api/sync');
  localStorage.clear();
});

test('la normalización añade /api/sync una sola vez', () => {
  assert.equal(normalizeErpBaseUrl('https://alfa-rms.vercel.app/api/sync'), 'https://alfa-rms.vercel.app');
  assert.equal(normalizeErpSyncApiBase('https://alfa-rms.vercel.app'), 'https://alfa-rms.vercel.app/api/sync');
  assert.equal(normalizeErpSyncApiBase('https://alfa-rms.vercel.app/api/sync/'), 'https://alfa-rms.vercel.app/api/sync');
});

// ---------------------------------------------------------------------------
// T2/T7: guardia — el host heredado no puede aparecer en código de producción
// ---------------------------------------------------------------------------

test('el host heredado no aparece en código de producción (guardia)', () => {
  const root = process.cwd();
  const productionRoots = ['utils', 'services', 'components', 'hooks', 'server', 'diagnostics'];
  const productionFiles = ['App.tsx', 'index.tsx', 'constants.ts', 'types.ts'];

  const walk = (dir: string): string[] => {
    const full = join(root, dir);
    let found: string[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(full);
    } catch {
      return found;
    }
    for (const entry of entries) {
      const path = join(full, entry);
      if (statSync(path).isDirectory()) {
        if (['node_modules', 'dist', 'android', '.git'].includes(entry)) continue;
        found = found.concat(walk(relative(root, path)));
      } else if (/\.(ts|tsx)$/.test(entry)) {
        found.push(path);
      }
    }
    return found;
  };

  const files = [
    ...productionRoots.flatMap((dir) => walk(dir)),
    ...productionFiles.map((file) => join(root, file)),
  ];

  // La única aparición permitida es la constante de referencia de utils/erpBaseUrl.ts.
  const allowlisted = join('utils', 'erpBaseUrl.ts');
  const offenders = files
    .filter((file) => {
      if (relative(root, file) === allowlisted) return false;
      return readFileSync(file, 'utf8').toLowerCase().includes('clic-erp.clicsuite.com');
    })
    .map((file) => relative(root, file));

  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// T3: la capacidad del ERP decide el transporte (no el host)
// ---------------------------------------------------------------------------

test('supports_batch_inbox=false o ausente ⇒ sin lote', () => {
  assert.equal(readErpVersionCapabilities({ capabilities: { supports_batch_inbox: false } }).supportsBatchInbox, false);
  assert.equal(readErpVersionCapabilities({}).supportsBatchInbox, false);
  assert.equal(readErpVersionCapabilities(null).supportsBatchInbox, false);
  assert.equal(
    readErpVersionCapabilities({ capabilities: { supports_batch_inbox: 'true' } }).supportsBatchInbox,
    false,
    'un string "true" no debe habilitar el lote',
  );
});

test('se leen commit, build y alias camelCase del lote', () => {
  const parsed = readErpVersionCapabilities({
    commit: '71b57a2',
    buildTime: '2026-11-01T20:52:42.318Z',
    capabilities: { supportsBatchInbox: true, limits: { max_events: 50 } },
  });
  assert.equal(parsed.commit, '71b57a2');
  assert.equal(parsed.buildTime, '2026-11-01T20:52:42.318Z');
  assert.equal(parsed.supportsBatchInbox, true);
  assert.equal(parsed.limits?.maxEvents, 50);
});

test('el evento durable se traduce al contrato de un solo /inbox', () => {
  const wire = toErpInboxEvent({
    eventId: 'evt-1',
    eventType: 'sale_posted',
    payload: { transaction: { id: 't-1' } },
  });
  assert.deepEqual(wire, {
    event_id: 'evt-1',
    event_type: 'SALE_POSTED',
    payload: { transaction: { id: 't-1' } },
  });
});

// ---------------------------------------------------------------------------
// T5: identidad del ERP
// ---------------------------------------------------------------------------

test('projectRef se lee de /health y se compara con el de Alfa-RMS', () => {
  assert.equal(readErpProjectRef({ projectRef: 'tcbleyxjwpopoierbkzo' }), 'tcbleyxjwpopoierbkzo');
  assert.equal(readErpProjectRef({ project_ref: 'otro' }), 'otro');
  assert.equal(readErpProjectRef({}), null);
});

// ---------------------------------------------------------------------------
// T6: errores de vinculación accionables
// ---------------------------------------------------------------------------

test('los códigos del ERP se mapean a estados distintos y accionables', () => {
  const codes = [
    ['SYNC_TERMINAL_NOT_FOUND', 404, 'TERMINAL_NOT_BOUND'],
    ['SYNC_TOKEN_MISSING', 401, 'TOKEN_MISSING'],
    ['DEVICE_SUPERSEDED', 403, 'DEVICE_SUPERSEDED'],
    ['PULL_MASTERS_NOT_ALLOWED', 403, 'MASTERS_PULL_FORBIDDEN'],
    ['SYNC_BATCH_INBOX_DISABLED', 404, 'BATCH_INBOX_DISABLED'],
    ['LICENSE_EXCEEDED_INACTIVE', 403, 'LICENSE_EXCEEDED'],
    ['CUSTOMER_NOT_FOUND', 409, 'BUSINESS_REJECTED'],
  ] as const;

  for (const [code, status, expectedKind] of codes) {
    const mapped = mapErpSyncError({ httpStatus: status, payload: { code } });
    assert.equal(mapped.kind, expectedKind, `código ${code}`);
    assert.ok(mapped.action.length > 0, `el estado ${expectedKind} debe traer acción`);
  }
});

test('un 429 es rate limit reintentable, no un rechazo de negocio', () => {
  const mapped = mapErpSyncError({ httpStatus: 429, payload: { code: 'BOOTSTRAP_CHECK_RATE_LIMITED' } });
  assert.equal(mapped.kind, 'RATE_LIMITED');
  assert.equal(mapped.retryable, true);
});

test('un fallo de red es reintentable y los estados de vinculación no', () => {
  assert.equal(mapErpSyncError({ networkMessage: 'Failed to fetch' }).kind, 'NETWORK');
  assert.equal(mapErpSyncError({ httpStatus: 404, payload: { code: 'SYNC_TERMINAL_NOT_FOUND' } }).retryable, false);
});
