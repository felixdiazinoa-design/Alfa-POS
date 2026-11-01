import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PUBLIC_ERP_BASE_URL } from '../utils/erpBaseUrl';

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
Object.assign(globalThis, {
  localStorage,
  window: {
    location: { protocol: 'https:' },
    localStorage,
  },
});

const { checkLicenseStatus } = await import('../utils/licenseGuard');

const tenantId = '9eda7d73-76e4-4432-ad13-4934fefe8f69';
const deviceId = 'DEV-LICENSE-QA';
const legacyCacheKey = 'clic:license:last-success';
const cacheKey = `${legacyCacheKey}:${tenantId}`;
const storeId = '0074089e-a648-4e98-8294-2ca350baf33e';

const resetRuntime = () => {
  localStorage.clear();
  localStorage.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
  localStorage.setItem('clic_tenant_id', tenantId);
  localStorage.setItem('active_terminal_id', 'terminal-license-qa');
};

const cachedLicense = (overrides: Record<string, unknown> = {}) => ({
  tenantId,
  branchId: 'branch-license-qa',
  licensed: true,
  reason: null,
  checkedAt: new Date().toISOString(),
  lastSuccessfulAt: new Date().toISOString(),
  expiresAt: null,
  source: 'erp-cloud',
  inGracePeriod: false,
  cloudReachable: true,
  ...overrides,
});

test('consulta la licencia sin cookies y conserva una suspensión explícita', async () => {
  resetRuntime();
  let requestCredentials: RequestCredentials | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCredentials = init?.credentials;
    return Response.json(cachedLicense({
      licensed: false,
      reason: 'SUSPENDED',
    }));
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(requestCredentials, 'omit');
  assert.equal(result.isValid, false);
  assert.equal(result.reason, 'SUSPENDED');
});

test('omite branchId durante la primera activación cuando aún no existe una sucursal UUID', async () => {
  resetRuntime();
  let requestedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return Response.json(cachedLicense());
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);
  const request = new URL(requestedUrl);

  assert.equal(result.isValid, true);
  assert.equal(request.searchParams.get('tenantId'), tenantId);
  assert.equal(request.searchParams.get('deviceId'), deviceId);
  assert.equal(request.searchParams.has('branchId'), false);
});

test('tras borrar el almacenamiento valida contra el ERP público sin configuración local previa', async () => {
  localStorage.clear();
  let requestedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return Response.json(cachedLicense());
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);
  const request = new URL(requestedUrl);

  assert.equal(result.isValid, true);
  assert.equal(request.origin, DEFAULT_PUBLIC_ERP_BASE_URL);
  assert.equal(request.pathname, '/api/license/status');
  assert.equal(request.searchParams.get('tenantId'), tenantId);
  assert.equal(request.searchParams.get('deviceId'), deviceId);
});

test('envía branchId cuando existe un UUID de sucursal válido', async () => {
  resetRuntime();
  localStorage.setItem('clic_erp_sync_store_id', storeId);
  let requestedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return Response.json(cachedLicense({ branchId: storeId }));
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);
  const request = new URL(requestedUrl);

  assert.equal(result.isValid, true);
  assert.equal(request.searchParams.get('branchId'), storeId);
});

test('rechaza una licencia de otro tenant y reintenta sin caché', async () => {
  resetRuntime();
  const otherTenantId = '54c8df05-d28c-40ea-9ad4-38f37412acac';
  let calls = 0;
  let retryUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    if (calls === 1) {
      return Response.json(cachedLicense({ tenantId: otherTenantId }));
    }
    retryUrl = String(input);
    return Response.json(cachedLicense());
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, true);
  assert.equal(calls, 2);
  assert.equal(new URL(retryUrl).searchParams.has('_licenseCheck'), true);
});

test('acepta el tenant Cloud Admin cuando la respuesta identifica su tenant ERP', async () => {
  resetRuntime();
  const cloudAdminTenantId = 'afb62bd5-a822-4238-b523-655ce4b901b8';
  globalThis.fetch = (async () => Response.json(cachedLicense({
    activation: {
      cloud_admin_tenant_id: cloudAdminTenantId,
      tenant_id: tenantId,
    },
  }))) as typeof fetch;

  const result = await checkLicenseStatus(cloudAdminTenantId, deviceId);

  assert.equal(result.isValid, true);
  assert.equal(result.tenantId, tenantId);
});

test('ignora la caché heredada cuando pertenece a otro tenant', async () => {
  resetRuntime();
  const otherTenantId = '54c8df05-d28c-40ea-9ad4-38f37412acac';
  localStorage.setItem(legacyCacheKey, JSON.stringify(cachedLicense({
    tenantId: otherTenantId,
    licensed: false,
    reason: 'SUSPENDED',
  })));
  globalThis.fetch = (async () => {
    throw new Error('network unavailable');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, false);
  assert.notEqual(result.reason, 'SUSPENDED');
  assert.match(result.reason || '', /No se pudo validar la licencia/);
});

test('una licencia activa reciente obtiene únicamente la gracia configurada ante una falla temporal', async () => {
  resetRuntime();
  localStorage.setItem(cacheKey, JSON.stringify(cachedLicense()));
  globalThis.fetch = (async () => {
    throw new Error('temporary network failure');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, true);
  assert.equal(result.inGracePeriod, true);
  assert.equal(result.cloudReachable, false);
});

test('una suspensión cacheada nunca se convierte en gracia offline', async () => {
  resetRuntime();
  localStorage.setItem(cacheKey, JSON.stringify(cachedLicense({
    licensed: false,
    reason: 'SUSPENDED',
  })));
  globalThis.fetch = (async () => {
    throw new Error('network unavailable');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, false);
  assert.equal(result.reason, 'SUSPENDED');
  assert.equal(result.inGracePeriod, false);
});

test('sin una licencia activa reciente la falla de red bloquea en vez de autorizar indefinidamente', async () => {
  resetRuntime();
  globalThis.fetch = (async () => {
    throw new Error('network unavailable');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, false);
  assert.match(result.reason || '', /No se pudo validar la licencia/);
  assert.equal(result.inGracePeriod, false);
});

test('el contrato App bloquea suspensiones explícitas pero tolera fallas temporales de licencia', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const activationStart = source.indexOf("case 'ACTIVATION':");
  const activationSource = source.slice(activationStart, source.indexOf("case 'TERMINAL_MODE_SELECTOR':", activationStart));

  assert.match(source, /if \(!res\.isValid && res\.cloudReachable !== false\) \{\s*triggerLockdown\(res\.reason \|\| fallbackMessage\);/);
  assert.match(source, /if \(!license\.isValid && license\.cloudReachable !== false\) \{\s*triggerLockdown\(license\.reason \|\| 'Servicio Suspendido\.'\);/);
  assert.match(source, /\[BOOT\] License validation unavailable; continuing without permanent lockdown\./);
  assert.match(source, /\[LICENSE\] Validation unavailable during polling; preserving recoverable POS access\./);
  assert.match(source, /if \(license\.cloudReachable === false\) \{[\s\S]*?alert\(license\.reason/);
  assert.match(source, /if \(blockingMessage === DEVICE_SUPERSEDED_MESSAGE\) \{\s*lockSupersededTerminal/);
  assert.doesNotMatch(source, /triggerLockdownAfterAuthorizationCheck\(license\.reason/);
  assert.doesNotMatch(source, /triggerLockdownAfterAuthorizationCheck\(res\.reason/);
  assert.match(
    activationSource,
    /if \(hasKnownTerminalContext && activatedTenantId\) \{[\s\S]*?checkLicenseStatus\(activatedTenantId, resolvedDeviceId\)/
  );
  assert.ok(
    activationSource.indexOf('persistSetupErpBaseUrls(activatedErpBaseUrl)')
      < activationSource.indexOf('checkLicenseStatus(activatedTenantId, resolvedDeviceId)'),
    'la activación debe restaurar la URL ERP antes de validar la licencia'
  );
});
