import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

/**
 * Entorno mínimo para ejecutar el POS (IndexedDB + storage) dentro de Node.
 * Debe llamarse antes de importar `utils/db`, que conecta el adaptador al cargar.
 */
export const installPosTestRuntime = (): void => {
  const memory = new Map<string, string>();

  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: unknown) => { memory.set(key, String(value)); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: (index: number) => Array.from(memory.keys())[index] ?? null,
    get length() { return memory.size; },
  };

  const windowMock = {
    localStorage: storage,
    sessionStorage: storage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    location: {
      origin: 'http://localhost:3000',
      href: 'http://localhost:3000/',
      protocol: 'http:',
      hostname: 'localhost',
    },
  };

  Object.assign(globalThis, {
    indexedDB,
    IDBKeyRange,
    localStorage: storage,
    window: windowMock,
    document: {
      createEvent: () => ({ initEvent: () => undefined }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });

  // `navigator` es un getter en Node 24: se redefine en lugar de asignarse.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
};
