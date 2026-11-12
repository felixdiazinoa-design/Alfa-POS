import { dbAdapter } from '../services/db';

/**
 * Cola local persistente de operaciones de fidelización EGO Club.
 *
 * Invariantes que resuelve:
 *
 * - **Offline-first**: el alta de socio y el reporte de la venta se encolan y se
 *   reintentan al recuperar conexión; nunca bloquean el cobro.
 * - **Idempotencia**: cada entrada usa una clave estable (uuid v5 derivado de la cédula
 *   o del id del documento), así que reintentar no duplica ni el cliente ni el devengo.
 *   El endpoint del ERP es idempotente por contrato; la clave evita además encolar dos
 *   veces lo mismo desde el POS.
 * - **Supervivencia al cierre**: la cola vive en la base local (`loyaltyOutbox`), no en
 *   memoria ni en el estado de React.
 *
 * El canje (T5) NO pasa por esta cola a propósito: descontar dinero contra un saldo sin
 * verificar no es aceptable, así que falla cerrado y se resuelve en línea.
 */

const COLLECTION = 'loyaltyOutbox';

export type LoyaltyOutboxType = 'ENROLL' | 'SALE_DOCUMENT';
export type LoyaltyOutboxStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export interface LoyaltyOutboxItem {
    /** Clave estable: `enroll:<cedula>` o `sale-document:<transactionId>`. */
    id: string;
    type: LoyaltyOutboxType;
    payload: Record<string, unknown>;
    status: LoyaltyOutboxStatus;
    attempts: number;
    createdAt: string;
    lastAttemptAt?: string;
    nextAttemptAt?: string;
    error?: string;
    /** Referencia legible para el listado en pantalla (cédula, documento, nombre). */
    reference?: string;
}

/** Reintentos con backoff exponencial acotado: 5s, 15s, 45s, 2m, 5m, 15m… y tope de 30m. */
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 20;

/**
 * Almacén de la cola. La implementación por defecto persiste en la base local
 * (`loyaltyOutbox`), que es lo que hace que la cola sobreviva al cierre de la app.
 * Es inyectable para poder verificar la lógica sin navegador
 * (ver `scripts/verify-ego-club-enroll.ts`).
 */
export interface LoyaltyOutboxStorage {
    read: () => Promise<unknown>;
    write: (items: LoyaltyOutboxItem[]) => Promise<void>;
}

const dbStorage: LoyaltyOutboxStorage = {
    read: () => dbAdapter.getCollection(COLLECTION),
    write: (items) => dbAdapter.saveCollection(COLLECTION, items),
};

let activeStorage: LoyaltyOutboxStorage = dbStorage;

/** Sólo para verificaciones headless: sustituye el almacén persistente. */
export const setLoyaltyOutboxStorage = (storage?: LoyaltyOutboxStorage): void => {
    activeStorage = storage || dbStorage;
};

export const computeNextAttempt = (attempts: number, from: Date = new Date()): string => {
    const exponential = BASE_BACKOFF_MS * Math.pow(3, Math.max(0, attempts - 1));
    const delay = Math.min(MAX_BACKOFF_MS, exponential);
    return new Date(from.getTime() + delay).toISOString();
};

const readQueue = async (): Promise<LoyaltyOutboxItem[]> => {
    const raw = await activeStorage.read();
    return Array.isArray(raw) ? raw : [];
};

const writeQueue = async (items: LoyaltyOutboxItem[]): Promise<void> => {
    await activeStorage.write(items);
};

const upsert = async (item: LoyaltyOutboxItem): Promise<void> => {
    const queue = await readQueue();
    const index = queue.findIndex(existing => existing.id === item.id);
    if (index >= 0) {
        queue[index] = item;
    } else {
        queue.push(item);
    }
    await writeQueue(queue);
};

export const listLoyaltyOutbox = async (): Promise<LoyaltyOutboxItem[]> => {
    const queue = await readQueue();
    return queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

/**
 * Encola una operación. Si la clave estable ya existe, no se duplica:
 * devuelve la entrada existente (idempotencia del lado del POS).
 */
export const enqueueLoyaltyOperation = async (
    type: LoyaltyOutboxType,
    id: string,
    payload: Record<string, unknown>,
    reference?: string,
): Promise<LoyaltyOutboxItem> => {
    const queue = await readQueue();
    const existing = queue.find(item => item.id === id);
    if (existing) return existing;

    const item: LoyaltyOutboxItem = {
        id,
        type,
        payload,
        status: 'PENDING',
        attempts: 0,
        createdAt: new Date().toISOString(),
        reference,
    };

    await upsert(item);
    return item;
};

export const markLoyaltyOperationSynced = async (id: string): Promise<void> => {
    const queue = await readQueue();
    const item = queue.find(entry => entry.id === id);
    if (!item) return;
    await upsert({
        ...item,
        status: 'SYNCED',
        lastAttemptAt: new Date().toISOString(),
        error: undefined,
        nextAttemptAt: undefined,
    });
};

export const markLoyaltyOperationFailed = async (id: string, error: string): Promise<void> => {
    const queue = await readQueue();
    const item = queue.find(entry => entry.id === id);
    if (!item) return;

    const attempts = item.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;

    await upsert({
        ...item,
        attempts,
        status: exhausted ? 'FAILED' : 'PENDING',
        lastAttemptAt: new Date().toISOString(),
        nextAttemptAt: exhausted ? undefined : computeNextAttempt(attempts),
        error,
    });
};

/**
 * La capacidad no está disponible (bandera apagada o ruta no publicada en el ERP).
 *
 * No es un fallo de red ni un error de negocio: se deja la entrada en cola sin gastar
 * intentos y con un reintento lejano, para que el POS no martillee un endpoint que el
 * ERP todavía no publica. El estado queda visible (error + panel de diagnóstico).
 */
const DEFERRED_RETRY_MS = 6 * 60 * 60 * 1000;

export const markLoyaltyOperationDeferred = async (id: string, reason: string): Promise<void> => {
    const queue = await readQueue();
    const item = queue.find(entry => entry.id === id);
    if (!item) return;

    await upsert({
        ...item,
        status: 'PENDING',
        lastAttemptAt: new Date().toISOString(),
        nextAttemptAt: new Date(Date.now() + DEFERRED_RETRY_MS).toISOString(),
        error: reason,
    });
};

export interface ProcessOutboxResult {
    processed: number;
    synced: number;
    failed: number;
    skipped: number;
    /** Entradas que no se enviaron porque la capacidad no está disponible. */
    deferred: number;
}

/**
 * Resultado del envío de una entrada.
 *
 * `unavailable` distingue "la función no está publicada / está apagada" (no gastar
 * intentos, reintento lejano) de un fallo real de red o del ERP (backoff normal).
 */
export interface SendOutcome {
    ok: boolean;
    error?: string;
    unavailable?: boolean;
}

type Sender = (item: LoyaltyOutboxItem) => Promise<SendOutcome>;

let isProcessing = false;

/**
 * Procesa las entradas pendientes cuya hora de reintento ya venció.
 *
 * Se ejecuta en serie para no saturar el canal de sync ni provocar carreras entre alta y
 * reporte de venta. Un fallo no detiene la cola: se reprograma con backoff y se sigue.
 */
export const processLoyaltyOutbox = async (send: Sender, now: Date = new Date()): Promise<ProcessOutboxResult> => {
    const result: ProcessOutboxResult = { processed: 0, synced: 0, failed: 0, skipped: 0, deferred: 0 };
    if (isProcessing) return result;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;

    isProcessing = true;
    try {
        const queue = await readQueue();
        const due = queue
            .filter(item => item.status === 'PENDING')
            .filter(item => !item.nextAttemptAt || new Date(item.nextAttemptAt) <= now)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        result.skipped = queue.filter(item => item.status === 'PENDING').length - due.length;

        for (const item of due) {
            result.processed += 1;
            try {
                const outcome = await send(item);
                if (outcome.ok) {
                    await markLoyaltyOperationSynced(item.id);
                    result.synced += 1;
                } else if (outcome.unavailable) {
                    await markLoyaltyOperationDeferred(item.id, outcome.error || 'Capacidad no disponible');
                    result.deferred += 1;
                } else {
                    await markLoyaltyOperationFailed(item.id, outcome.error || 'Error desconocido');
                    result.failed += 1;
                }
            } catch (error: any) {
                await markLoyaltyOperationFailed(item.id, error?.message || 'Error de red');
                result.failed += 1;
            }
        }

        return result;
    } finally {
        isProcessing = false;
    }
};

/** Cuenta de operaciones que aún no llegaron al ERP (para el indicador de la UI). */
export const countPendingLoyaltyOperations = async (): Promise<number> => {
    const queue = await readQueue();
    return queue.filter(item => item.status === 'PENDING').length;
};
