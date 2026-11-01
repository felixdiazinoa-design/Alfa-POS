import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const localStorage = new MemoryStorage();
Object.assign(globalThis, { localStorage });

const { getSupportsBatchInbox, getErpCapabilitySnapshot, invalidateErpCapabilities, markBatchInboxUnavailable } =
  await import('../utils/erpCapabilities');

const jsonResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
}) as unknown as Response;

const reset = (
  versionPayload: unknown,
  healthPayload: unknown = { projectRef: 'tcbleyxjwpopoierbkzo' },
  syncUrlOverride: string | null = null,
) => {
  localStorage.clear();
  invalidateErpCapabilities();
  if (syncUrlOverride) localStorage.setItem('CLIC_ERP_SYNC_URL', syncUrlOverride);
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return url.endsWith('/version') ? jsonResponse(versionPayload) : jsonResponse(healthPayload);
  }) as typeof fetch;
  return requested;
};

test('capability false ⇒ el POS no usa lote (Alfa-RMS hoy)', async () => {
  reset({ status: 'success', commit: 'abc123', capabilities: { supports_batch_inbox: false } });
  assert.equal(await getSupportsBatchInbox(), false);
});

test('capability true ⇒ el POS sí puede usar lote', async () => {
  reset({ capabilities: { supports_batch_inbox: true } });
  assert.equal(await getSupportsBatchInbox(), true);
});

test('sin poder leer /version se asume SIN lote (nunca lote por el host)', async () => {
  localStorage.clear();
  invalidateErpCapabilities();
  globalThis.fetch = (async () => { throw new Error('Failed to fetch'); }) as typeof fetch;
  assert.equal(await getSupportsBatchInbox(), false);
  assert.equal(getErpCapabilitySnapshot().supportsBatchInbox, false);
});

test('la capacidad se cachea por sesión: una sola lectura de /version', async () => {
  const requested = reset({ capabilities: { supports_batch_inbox: false } });
  await getSupportsBatchInbox();
  await getSupportsBatchInbox();
  assert.equal(requested.filter((url) => url.endsWith('/version')).length, 1);
});

test('SYNC_BATCH_INBOX_DISABLED apaga el lote aunque /version dijera true', async () => {
  reset({ capabilities: { supports_batch_inbox: true } });
  assert.equal(await getSupportsBatchInbox(), true);

  markBatchInboxUnavailable();

  assert.equal(await getSupportsBatchInbox(), false);
  assert.equal(getErpCapabilitySnapshot().batchInboxDisabledByErp, true);
});

test('al cambiar de base se descarta la capacidad cacheada', async () => {
  reset({ capabilities: { supports_batch_inbox: false } });
  assert.equal(await getSupportsBatchInbox(), false);

  const requested = reset(
    { capabilities: { supports_batch_inbox: true } },
    { projectRef: 'tcbleyxjwpopoierbkzo' },
    'https://otro-erp.example.com/api/sync',
  );
  assert.equal(await getSupportsBatchInbox(), true);
  assert.ok(requested.some((url) => url.startsWith('https://otro-erp.example.com/api/sync')));
});
