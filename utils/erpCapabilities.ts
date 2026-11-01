import { isExpectedErpProjectRef, readErpProjectRef, readErpVersionCapabilities, type ErpVersionCapabilities } from './erpSyncContract';
import { DEFAULT_PUBLIC_ERP_BASE_URL, resolveErpSyncApiBase } from './erpBaseUrl';

/**
 * Capacidades e identidad del ERP (Alfa-RMS), cacheadas por sesión y por base.
 *
 * El contrato manda sobre el host: el envío por lote sólo se usa si `GET /version` dice
 * `capabilities.supports_batch_inbox === true`. Alfa-RMS lo tiene apagado, así que el POS
 * debe caer a `/inbox` evento por evento en lugar de fallar con 404
 * `SYNC_BATCH_INBOX_DISABLED`.
 *
 * `GET /health` publica el `projectRef`: es el diagnóstico de identidad del ERP
 * (esperado `tcbleyxjwpopoierbkzo` para Alfa-RMS).
 */

const VERSION_CACHE_TTL_MS = 10 * 60 * 1000;
const DIAGNOSTIC_TIMEOUT_MS = 8000;

export interface ErpCapabilitySnapshot {
    baseUrl: string;
    configured: boolean;
    commit: string | null;
    buildTime: string | null;
    supportsBatchInbox: boolean;
    batchInboxDisabledByErp: boolean;
    projectRef: string | null;
    projectRefExpected: boolean;
    versionError: string | null;
    healthError: string | null;
    checkedAt: string | null;
}

interface CapabilityCache {
    baseUrl: string;
    capabilities: ErpVersionCapabilities | null;
    fetchedAt: number;
    versionError: string | null;
    projectRef: string | null;
    healthError: string | null;
    batchInboxDisabled: boolean;
}

let cache: CapabilityCache | null = null;
let identityLoggedBase: string | null = null;

const emptyCache = (baseUrl: string): CapabilityCache => ({
    baseUrl,
    capabilities: null,
    fetchedAt: 0,
    versionError: null,
    projectRef: null,
    healthError: null,
    batchInboxDisabled: false,
});

const resolveBase = (): string => resolveErpSyncApiBase() || '';

const getCache = (): CapabilityCache => {
    const baseUrl = resolveBase();
    if (!cache || cache.baseUrl !== baseUrl) {
        cache = emptyCache(baseUrl);
    }
    return cache;
};

/** Limpia la caché (cambio de base o refresco forzado). */
export const invalidateErpCapabilities = (): void => {
    cache = null;
};

const fetchJson = async (url: string): Promise<{ status: number; payload: any }> => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS) : null;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await response.json().catch(() => ({}));
        return { status: response.status, payload };
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/**
 * `supports_batch_inbox` efectivo de la sesión.
 *
 * Si `/version` no se puede leer, se asume **sin lote** (nunca lote por el host).
 */
export const getSupportsBatchInbox = async (options: { force?: boolean } = {}): Promise<boolean> => {
    const baseUrl = resolveBase();
    if (!baseUrl) return false;

    const current = getCache();
    if (current.batchInboxDisabled) return false;

    const fresh = current.capabilities && (Date.now() - current.fetchedAt) < VERSION_CACHE_TTL_MS;
    if (fresh && !options.force) {
        return current.capabilities?.supportsBatchInbox === true;
    }

    try {
        const { status, payload } = await fetchJson(`${baseUrl}/version`);
        if (status !== 200) {
            current.versionError = `HTTP ${status}`;
            console.warn('[ERP CAPS] /version respondió', status, '→ se asume sin lote');
            return false;
        }

        current.capabilities = readErpVersionCapabilities(payload);
        current.fetchedAt = Date.now();
        current.versionError = null;

        return current.capabilities.supportsBatchInbox === true;
    } catch (error: any) {
        current.versionError = String(error?.message || 'network error');
        console.warn('[ERP CAPS] no se pudo leer /version:', current.versionError);
        return false;
    }
};

/**
 * El ERP rechazó `/inbox/batch` con `SYNC_BATCH_INBOX_DISABLED`: se apaga el lote para el
 * resto de la sesión y se sigue por `/inbox` evento por evento.
 */
export const markBatchInboxUnavailable = (): void => {
    const current = getCache();
    const wasDisabled = current.batchInboxDisabled;
    current.batchInboxDisabled = true;
    if (current.capabilities) {
        current.capabilities = { ...current.capabilities, supportsBatchInbox: false };
    }
    if (!wasDisabled) {
        console.info('[ERP CAPS] el ERP no soporta /inbox/batch: se envía evento por evento.');
    }
};

export const getErpCapabilitySnapshot = (): ErpCapabilitySnapshot => {
    const baseUrl = resolveBase();
    const current = cache && cache.baseUrl === baseUrl ? cache : emptyCache(baseUrl);

    return {
        baseUrl,
        configured: Boolean(baseUrl),
        commit: current.capabilities?.commit || null,
        buildTime: current.capabilities?.buildTime || null,
        supportsBatchInbox: current.batchInboxDisabled ? false : current.capabilities?.supportsBatchInbox === true,
        batchInboxDisabledByErp: current.batchInboxDisabled,
        projectRef: current.projectRef,
        projectRefExpected: current.projectRef ? isExpectedErpProjectRef(current.projectRef) : false,
        versionError: current.versionError,
        healthError: current.healthError,
        checkedAt: current.capabilities || current.projectRef ? new Date().toISOString() : null,
    };
};

/**
 * Diagnóstico de identidad: `GET /version` (commit) y `GET /health` (projectRef).
 *
 * Al iniciar y al cambiar de base. No expone secretos: sólo base, commit y projectRef.
 * Si el `projectRef` no es el de Alfa-RMS se avisa de forma visible en consola (una base
 * distinta = datos distintos).
 */
export const logErpIdentity = async (options: { force?: boolean } = {}): Promise<ErpCapabilitySnapshot> => {
    const baseUrl = resolveBase();
    if (!baseUrl) {
        console.info('[ERP DIAG] canal del ERP no configurado: no hay identidad que verificar.');
        return getErpCapabilitySnapshot();
    }

    const current = getCache();
    const alreadyLogged = identityLoggedBase === baseUrl && !options.force;

    await getSupportsBatchInbox(options);

    try {
        const { status, payload } = await fetchJson(`${baseUrl}/health`);
        current.projectRef = status === 200 ? readErpProjectRef(payload) : null;
        current.healthError = status === 200 ? null : `HTTP ${status}`;
    } catch (error: any) {
        current.healthError = String(error?.message || 'network error');
    }

    const snapshot = getErpCapabilitySnapshot();

    if (!alreadyLogged) {
        identityLoggedBase = baseUrl;
        console.info(
            '[ERP DIAG] base=%s commit=%s projectRef=%s esperado=%s batch_inbox=%s',
            snapshot.baseUrl,
            snapshot.commit || '(desconocido)',
            snapshot.projectRef || '(desconocido)',
            'tcbleyxjwpopoierbkzo',
            snapshot.supportsBatchInbox ? 'soportado' : 'no soportado',
        );
    }

    if (snapshot.projectRef && !snapshot.projectRefExpected) {
        console.warn(
            `[ERP DIAG] ADVERTENCIA: el ERP responde projectRef "${snapshot.projectRef}", distinto del esperado `
            + `"tcbleyxjwpopoierbkzo". Puede ser otro despliegue/base de datos: confirmar antes de operar.`,
        );
    }

    if (snapshot.healthError) {
        console.warn('[ERP DIAG] no se pudo verificar la identidad del ERP (/health):', snapshot.healthError);
    }

    return snapshot;
};

export { DEFAULT_PUBLIC_ERP_BASE_URL };
