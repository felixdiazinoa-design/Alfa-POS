import assert from 'node:assert/strict';
import test from 'node:test';

const installStorage = () => {
    const storage = new Map<string, string>();
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, String(value)),
            removeItem: (key: string) => storage.delete(key),
        },
    });
    return { storage, restore: () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous }) };
};

test('el vínculo guarda el nombre de la sucursal junto al store_id', async () => {
    const { restore } = installStorage();
    try {
        const {
            clearStoredErpSyncBinding,
            getStoredErpSyncBinding,
            persistStoredErpSyncBinding,
        } = await import('../utils/erpSyncLifecycle');

        persistStoredErpSyncBinding({
            storeId: '862adb8b-1e01-4400-9270-cf6ecdadb18f',
            storeName: 'Sucursal Ámbar',
        });

        const binding = getStoredErpSyncBinding();
        assert.equal(binding.storeId, '862adb8b-1e01-4400-9270-cf6ecdadb18f');
        assert.equal(binding.storeName, 'Sucursal Ámbar');

        clearStoredErpSyncBinding();
        assert.equal(getStoredErpSyncBinding().storeName, null);
    } finally {
        restore();
    }
});

test('la identidad de sync toma store_name del terminal y de operational_identity', async () => {
    const { restore } = installStorage();
    try {
        const { getStoredErpSyncBinding, persistErpSyncAuthIdentity } = await import('../utils/erpSyncLifecycle');

        persistErpSyncAuthIdentity({
            terminal: { id: 'terminal-1', store_id: 'store-1', store_name: 'Sucursal Centro' },
        });
        assert.equal(getStoredErpSyncBinding().storeName, 'Sucursal Centro');

        persistErpSyncAuthIdentity({
            operational_identity: { store_id: 'store-2', store_name: 'Sucursal Norte' },
        });
        const binding = getStoredErpSyncBinding();
        assert.equal(binding.storeId, 'store-2');
        assert.equal(binding.storeName, 'Sucursal Norte');
    } finally {
        restore();
    }
});

test('sin store_name el vínculo no inventa nombre y conserva el store_id', async () => {
    const { restore } = installStorage();
    try {
        const { getStoredErpSyncBinding, persistStoredErpSyncBinding } = await import('../utils/erpSyncLifecycle');

        persistStoredErpSyncBinding({ storeId: 'store-only-id' });
        const binding = getStoredErpSyncBinding();
        assert.equal(binding.storeId, 'store-only-id');
        assert.equal(binding.storeName, null);
    } finally {
        restore();
    }
});
