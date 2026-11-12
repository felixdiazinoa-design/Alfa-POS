import { resolveStoredErpTenantIdentity } from './tenantIdentityStorage';
import { normalizeErpSyncApiBase, resolveErpSyncApiBase } from './erpBaseUrl';
import { extractErpRegisterAuth, resolveNormalizedRegisterDeviceToken } from '../services/sync/erpRegisterResponse';
import {
    CanonicalErpTerminalIdError,
    normalizeCanonicalErpTerminalId,
    resolveCanonicalErpTerminalId,
} from '../services/sync/terminalIdentity';
import { getSyncDeviceToken, persistSyncDeviceToken } from '../services/sync/deviceToken';
import {
    buildTerminalSyncAuthHeaders,
    clearStoredSyncToken,
    readTerminalCredentialsSync,
    saveTerminalCredentialsSync,
} from '../services/sync/TerminalCredentialStore';
import {
    setCatalogDiagnosticStatus,
    setSalesPushDiagnosticStatus,
    setSyncAuthDiagnosticStatus,
    setTerminalBindingDiagnosticStatus,
} from '../services/sync/SyncErrorDiagnostic';
import { extractTerminalConfigRequestedScopes } from './terminalConfigPushScopes';
import { applyTerminalConfigSnapshot, mergeTerminalConfigSnapshots } from './terminalConfigSnapshot';
import { db } from './db';
import { DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS } from '../constants';
import { getDefaultRoleConfig, normalizeDeviceRoleValue, resolveDeviceRoleValue } from './deviceRoleHelpers';
import { resolveOrderTakerContract } from './orderTakerPolicy';
import { resolveDeviceProfile, toDeviceProfileContract } from './deviceProfile';
import {
    POS_SYNC_CAPABILITY_VERSIONS,
    VARIANT_PROMOTIONS_CAPABILITY,
} from './syncCapabilities';
import {
    ERP_CONFIG_PUSH_V2_DOMAIN_COLLECTIONS,
    ERP_CONFIG_PUSH_V2_DOMAINS,
    type ErpMasterDomain,
} from '../services/sync/ErpMasterSyncContract';
import {
    DEVICE_SUPERSEDED_MESSAGE,
    dispatchDeviceRevoked,
    isDeviceSupersededError,
    persistLocalDeviceId,
    resolveLocalDeviceId,
} from './deviceRevocation';
import {
    AuthLevel,
    BusinessConfig,
    DeviceRole,
    DeviceRoleConfig,
    TerminalConfig,
    TerminalConfigSnapshot,
} from '../types';
import { authenticatedActivityTracker } from '../services/sync/AuthenticatedActivityTracker';
import { syncMetrics } from '../services/sync/SyncMetrics';
import { persistMasterNumberRangesFromSnapshot } from '../services/sync/MasterNumberRangeService';
import { extractMasterNumberRanges } from '../services/sync/masterNumberRangeContract';

type TenantIdentity = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
};

const getStoredTenantIdentity = (): TenantIdentity => resolveStoredErpTenantIdentity(localStorage);

type SyncActivationState = {
    tenant_id?: string | null;
    company_ref?: string | null;
    mode?: string | null;
    erp_enabled?: boolean;
    billing_status?: string | null;
    kill_switch_active?: boolean;
    terminal_active?: boolean;
    reason?: string | null;
};

type SyncTerminalRecord = {
    id: string;
    tenant_id?: string | null;
    company_id?: string | null;
    company_name?: string | null;
    store_id?: string | null;
    store_name?: string | null;
    device_id: string;
    name: string;
    last_seen?: string | null;
    ip_address?: string | null;
    app_version?: string | null;
    pending_events?: number;
    status?: string | null;
};

type SyncBootstrapResponse = {
    status: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
};

type SyncRegisterResponse = {
    status: string;
    action?: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
    terminalId?: string | null;
    erpTerminalId?: string | null;
    deviceToken?: string | null;
    device_token?: string | null;
    syncToken?: string | null;
    sync_token?: string | null;
    auth?: Record<string, unknown> | null;
    syncHeaders?: Record<string, unknown> | null;
    profile?: Record<string, unknown> | null;
    syncProfile?: Record<string, unknown> | null;
    incomingProfile?: Record<string, unknown> | null;
};

type SyncHeartbeatResponse = {
    status: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
};

type SyncOutboxEvent = {
    id: string;
    event_type: string;
    payload?: Record<string, unknown> | null;
    status?: string;
    created_at?: string;
};

type ConfigPushV2Payload = {
    contract_version?: number;
    snapshot_id?: string;
    version_hash?: string;
    versions?: Record<string, unknown>;
    scopes?: unknown;
    terminal_id?: string;
    terminalId?: string;
    tenant_id?: string;
    tenantId?: string;
    created_at?: string;
};

type ConfigPushV2State = {
    versionHash: string | null;
    domainVersions: Record<string, number>;
    appliedAt?: string | null;
    inFlight?: {
        eventId: string;
        snapshotId: string;
        versionHash: string;
        scopes: string[];
        attempts: number;
        lastError: string | null;
        updatedAt: string;
    } | null;
};

type ConfigSnapshotResponse = {
    status?: string;
    snapshot_id?: string;
    version_hash?: string;
    versions?: Record<string, unknown>;
    scopes?: unknown;
    domains?: Record<string, unknown>;
    tenant_id?: string;
    tenantId?: string;
    terminal_id?: string;
    terminalId?: string;
};

type SyncOutboxPullResponse = {
    status: string;
    events?: SyncOutboxEvent[];
    count?: number;
};

type SyncOutboxAckResponse = {
    status: string;
    outbox_id: string;
    applied_status: 'APPLIED' | 'FAILED';
};

type RuntimeDeviceInfo = {
    versionName?: string | null;
    localIp?: string | null;
    localIps?: string[] | null;
};

type SyncRequestError = Error & {
    status?: number;
    code?: string | null;
    payload?: any;
    retryable?: boolean;
    retryAfterMs?: number;
};

type EnsureLifecycleParams = {
    deviceId: string;
    terminalId: string;
    localTerminalId?: string | null;
    terminalName?: string | null;
    isPrimary?: boolean;
    pendingEvents?: number;
    companyId?: string | null;
    storeId?: string | null;
};

type SyncTerminalSnapshot = {
    terminal_id?: string | null;
    terminal_name?: string | null;
    device_id?: string | null;
    role?: string | null;
    masters?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
    resolved?: Record<string, unknown> | null;
};

const SYNC_API_URL_STORAGE_KEY = 'CLIC_ERP_SYNC_URL';
const SYNC_BINDING_TENANT_KEY = 'clic_erp_sync_tenant_id';
const SYNC_BINDING_TERMINAL_KEY = 'clic_erp_sync_terminal_id';
const SYNC_BINDING_LOCAL_TERMINAL_KEY = 'clic_erp_sync_local_terminal_id';
const SYNC_BINDING_TERMINAL_NAME_KEY = 'clic_erp_sync_terminal_name';
const SYNC_BINDING_COMPANY_KEY = 'clic_erp_sync_company_id';
const SYNC_BINDING_STORE_KEY = 'clic_erp_sync_store_id';
const SYNC_BINDING_LAST_SEEN_KEY = 'clic_erp_sync_last_seen';
const SYNC_BINDING_STATUS_KEY = 'clic_erp_sync_status';
const SYNC_BINDING_TERMINAL_UUID_KEY = 'clic_erp_sync_terminal_uuid';
const ERP_FULL_BOOTSTRAP_REQUIRED_KEY = 'clic_erp_sync_full_bootstrap_required';
const ERP_FULL_BOOTSTRAP_REASON_KEY = 'clic_erp_sync_full_bootstrap_reason';
export const ERP_FULL_BOOTSTRAP_REQUIRED_EVENT = 'clic-pos-erp-full-bootstrap-required';
const TERMINAL_CONFIG_RESTART_NOTICE_KEY = 'clic_pos_terminal_config_restart_notice';
const TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY = 'clic_pos_terminal_config_pending_snapshot';
const CONFIG_PUSH_V2_STATE_KEY = 'clic_pos_config_push_v2_state';
const CONFIG_PUSH_V2_FLAG_KEY = 'CONFIG_PUSH_V2_ENABLED';
const CONFIG_PUSH_V2_CAPABILITY = 'CONFIG_PUSH_V2';
const CONFIG_PUSH_V2_SUPPORTED_SCOPES = ERP_CONFIG_PUSH_V2_DOMAINS;
const CONFIG_PUSH_V2_DOMAIN_COLLECTIONS = ERP_CONFIG_PUSH_V2_DOMAIN_COLLECTIONS;

type ConfigPushV2CollectionWrite = {
    collection: string;
    value: unknown;
};

type ConfigPushV2RollbackJournal = Map<string, unknown>;

let outboxProcessingPromise: Promise<{ processed: number; applied: number; failed: number } | null> | null = null;
let heartbeatRequestPromise: Promise<SyncHeartbeatResponse | null> | null = null;

export const ERP_SYNC_LIFECYCLE_REQUEST_TIMEOUT_MS = 15_000;

const normalizeOptional = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
const asObject = <T extends Record<string, unknown>>(value: unknown): T =>
    (value && typeof value === 'object' && !Array.isArray(value) ? value as T : {} as T);
const asStringList = (value: unknown) => (
    Array.isArray(value)
        ? value.map((entry) => normalizeOptional(String(entry || ''))).filter(Boolean)
        : []
);
const normalizeAllowedModules = (value: unknown): string[] => (
    asStringList(value).map((moduleName) => (
        moduleName === '*'
            ? '*'
            : moduleName.toLowerCase()
    ))
);

const normalizeActivationMode = (value?: string | null) => normalizeOptional(value).toUpperCase();
const normalizeActivationReason = (value?: string | null) => normalizeOptional(value).toUpperCase();
const normalizeActivationBillingStatus = (value?: string | null) => normalizeOptional(value).toUpperCase();

const compactErrorDetail = (value: unknown): string => {
    const raw = value instanceof Error ? value.message : String(value || 'Error procesando evento ERP outbox');
    return raw.replace(/token=[^\s,]+/gi, 'token=[redacted]').slice(0, 240);
};

const configPushV2Log = (eventName: string, details: Record<string, unknown>) => {
    const safeDetails = { ...details };
    delete safeDetails.payload;
    delete safeDetails.headers;
    delete safeDetails.token;
    console.info(eventName, safeDetails);
};

const getConfigPushV2PendingEventCount = (): number => {
    const state = readConfigPushV2State();
    return state.inFlight?.eventId ? 1 : 0;
};

export const isConfigPushV2Enabled = (): boolean => {
    const envValue = normalizeOptional(String((import.meta as any)?.env?.VITE_CONFIG_PUSH_V2_ENABLED || ''));
    const localValue = normalizeOptional(localStorage.getItem(CONFIG_PUSH_V2_FLAG_KEY));
    const value = (localValue || envValue || 'true').toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(value);
};

const getSyncCapabilities = (): string[] => (
    [
        ...(isConfigPushV2Enabled() ? [CONFIG_PUSH_V2_CAPABILITY] : []),
        VARIANT_PROMOTIONS_CAPABILITY,
    ]
);

const readConfigPushV2State = (): ConfigPushV2State => {
    try {
        const raw = localStorage.getItem(CONFIG_PUSH_V2_STATE_KEY);
        if (!raw) return { versionHash: null, domainVersions: {} };
        const parsed = JSON.parse(raw);
        const domainVersions = parsed?.domainVersions && typeof parsed.domainVersions === 'object'
            ? Object.entries(parsed.domainVersions).reduce<Record<string, number>>((acc, [key, value]) => {
                const normalizedKey = key === 'config'
                    ? 'terminal_config'
                    : key === 'documents'
                        ? 'fiscal'
                        : key;
                acc[normalizedKey] = Math.max(acc[normalizedKey] || 0, Number(value) || 0);
                return acc;
            }, {})
            : {};
        return {
            versionHash: normalizeOptional(parsed?.versionHash || null) || null,
            domainVersions,
            appliedAt: normalizeOptional(parsed?.appliedAt || null) || null,
            inFlight: parsed?.inFlight && typeof parsed.inFlight === 'object' ? parsed.inFlight : null,
        };
    } catch {
        return { versionHash: null, domainVersions: {} };
    }
};

const writeConfigPushV2State = (state: ConfigPushV2State) => {
    localStorage.setItem(CONFIG_PUSH_V2_STATE_KEY, JSON.stringify({
        versionHash: state.versionHash || null,
        domainVersions: state.domainVersions || {},
        appliedAt: state.appliedAt || null,
        inFlight: state.inFlight || null,
    }));
};

export const getConfigPushV2Diagnostics = () => {
    const state = readConfigPushV2State();
    return {
        enabled: isConfigPushV2Enabled(),
        versionHash: state.versionHash,
        domainVersions: { ...state.domainVersions },
        appliedAt: state.appliedAt || null,
        inFlight: state.inFlight ? { ...state.inFlight } : null,
    };
};

const normalizeConfigPushV2Scope = (value: unknown): string | null => {
    const normalized = normalizeOptional(String(value || '')).toLowerCase();
    if (!normalized) return null;
    if (['product_prices', 'productprices', 'prices'].includes(normalized)) return 'prices';
    if (['stock', 'stocks', 'inventory_stock'].includes(normalized)) return 'inventory';
    if (['promo', 'promotion'].includes(normalized)) return 'promotions';
    if (['terminal_config', 'terminalconfig', 'config'].includes(normalized)) return 'terminal_config';
    if (['fiscal', 'documents'].includes(normalized)) return 'fiscal';
    if (['purchaseorders', 'purchase_orders'].includes(normalized)) return 'purchase_orders';
    return normalized;
};

const toConfigPushV2WireScope = (scope: string): string => scope;

const normalizeConfigPushV2Scopes = (value: unknown): string[] => {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    return Array.from(new Set(
        raw
            .map(normalizeConfigPushV2Scope)
            .filter((scope): scope is ErpMasterDomain => Boolean(scope && CONFIG_PUSH_V2_SUPPORTED_SCOPES.has(scope as ErpMasterDomain)))
    ));
};

const normalizeVersionsMap = (value: unknown): Record<string, number> => {
    const source = asObject<Record<string, unknown>>(value);
    const result: Record<string, number> = {};
    Object.entries(source).forEach(([key, rawValue]) => {
        const scope = normalizeConfigPushV2Scope(key);
        const version = Number(rawValue);
        if (scope && Number.isFinite(version)) {
            result[scope] = version;
        }
    });
    return result;
};

const normalizeConfigPushV2Domains = (value: unknown): Record<string, unknown> => {
    const source = asObject<Record<string, unknown>>(value);
    const normalized: Record<string, unknown> = {};
    Object.entries(source).forEach(([rawScope, payload]) => {
        const scope = normalizeConfigPushV2Scope(rawScope);
        if (!scope || !CONFIG_PUSH_V2_SUPPORTED_SCOPES.has(scope as ErpMasterDomain)) return;
        const existing = asObject<Record<string, unknown>>(normalized[scope]);
        normalized[scope] = {
            ...existing,
            ...asObject<Record<string, unknown>>(payload),
        };
    });
    return normalized;
};

const buildRetryableConfigPushV2Error = (message: string, retryAfterMs?: number): SyncRequestError => {
    const error = new Error(message) as SyncRequestError;
    error.retryable = true;
    error.retryAfterMs = retryAfterMs;
    return error;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const getRetryAfterMs = (response: Response, payload?: any): number | null => {
    const retryAfterMs = Number(payload?.retry_after_ms);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
    const retryAfter = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    return null;
};

const sameTerminalId = (incoming: string, candidates: Array<string | null | undefined>): boolean => {
    const normalizedIncoming = normalizeOptional(incoming).toLowerCase();
    return Boolean(normalizedIncoming && candidates.some((candidate) => normalizeOptional(candidate || '').toLowerCase() === normalizedIncoming));
};

const getConfigPushV2LocalVersion = (state: ConfigPushV2State, scope: string): number =>
    Number(state.domainVersions?.[scope] || 0);

const setConfigPushV2InFlight = (
    eventId: string,
    snapshotId: string,
    versionHash: string,
    scopes: string[],
    attempts: number,
    lastError: string | null
) => {
    const state = readConfigPushV2State();
    writeConfigPushV2State({
        ...state,
        inFlight: {
            eventId,
            snapshotId,
            versionHash,
            scopes,
            attempts,
            lastError,
            updatedAt: new Date().toISOString(),
        },
    });
};

const clearConfigPushV2InFlight = () => {
    const state = readConfigPushV2State();
    writeConfigPushV2State({ ...state, inFlight: null });
};

const fetchConfigSnapshotV2 = async (input: {
    terminalId: string;
    snapshotId: string;
    versionHash: string;
    currentVersionHash: string | null;
    scopes: string[];
    deviceId: string;
}): Promise<{ status: 200 | 304; payload?: ConfigSnapshotResponse; size: number }> => {
    const baseUrl = getSyncApiBase();
    if (!baseUrl) {
        throw new Error('ERP sync lifecycle URL is not configured');
    }

    const searchParams = new URLSearchParams();
    searchParams.set('version_hash', input.versionHash);
    if (input.currentVersionHash) searchParams.set('current_version', input.currentVersionHash);
    searchParams.set('scopes', input.scopes.map(toConfigPushV2WireScope).join(','));

    const endpoint = `${baseUrl}/terminals/${encodeURIComponent(input.terminalId)}/config-snapshots/${encodeURIComponent(input.snapshotId)}?${searchParams.toString()}`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...buildDeviceHeaders(input.deviceId),
        },
    });

    if (response.status === 304) {
        return { status: 304, size: 0 };
    }

    const text = await response.text().catch(() => '');
    const payload = text ? JSON.parse(text) : {};
    const size = text.length;

    if (response.status === 503) {
        const retryAfterMs = getRetryAfterMs(response, payload) || 500;
        const error = buildRetryableConfigPushV2Error(payload?.code || 'SYNC_SNAPSHOT_BUILDING', retryAfterMs);
        error.status = response.status;
        error.code = payload?.code || 'SYNC_SNAPSHOT_BUILDING';
        error.payload = payload;
        throw error;
    }

    if (response.status >= 500) {
        const error = buildRetryableConfigPushV2Error(payload?.code || `HTTP_${response.status}`, getRetryAfterMs(response, payload) || 500);
        error.status = response.status;
        error.code = payload?.code || null;
        error.payload = payload;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(payload?.code || payload?.message || `HTTP_${response.status}`) as SyncRequestError;
        error.status = response.status;
        error.code = payload?.code || null;
        error.payload = payload;
        throw error;
    }

    return { status: 200, payload: payload as ConfigSnapshotResponse, size };
};

const firstArray = (...values: unknown[]): unknown[] | null => {
    for (const value of values) {
        if (Array.isArray(value)) return value;
    }
    return null;
};

const normalizeConfigPushV2ProductPrices = (value: unknown): Record<string, unknown>[] => (
    (Array.isArray(value) ? value : []).map((entry) => {
        const row = asObject<Record<string, unknown>>(entry);
        const productId = normalizeOptional(String(row.productId || row.product_id || row.itemId || row.item_id || ''));
        const tariffId = normalizeOptional(String(row.tariffId || row.tariff_id || row.tariffCode || row.tariff_code || ''));
        const price = Number(row.price);
        if (!productId || !tariffId || !Number.isFinite(price)) return null;
        const itemId = normalizeOptional(String(row.itemId || row.item_id || row.productId || row.product_id || productId));
        return {
            id: normalizeOptional(String(row.id || '')) || `${productId}_${tariffId}`,
            productId,
            itemId,
            erpProductId: itemId,
            sourceProductId: itemId,
            tariffId,
            tariffCode: normalizeOptional(String(row.tariffCode || row.tariff_code || '')) || undefined,
            price,
            currency: normalizeOptional(String(row.currency || '')) || undefined,
            updatedAt: normalizeOptional(String(row.updatedAt || row.updated_at || '')) || new Date().toISOString(),
        };
    }).filter(Boolean) as Record<string, unknown>[]
);

const normalizeConfigPushV2ProductStocks = (value: unknown): Record<string, unknown>[] => (
    (Array.isArray(value) ? value : []).map((entry) => {
        const row = asObject<Record<string, unknown>>(entry);
        const productId = normalizeOptional(String(row.productId || row.product_id || row.itemId || row.item_id || ''));
        const warehouseId = normalizeOptional(String(row.warehouseId || row.warehouse_id || ''));
        if (!productId || !warehouseId) return null;
        const qtyPhysical = Number(row.qtyPhysical ?? row.qty_physical ?? row.qtyOnHand ?? row.qty_on_hand ?? row.quantity ?? 0);
        const qtyCommitted = Number(row.qtyCommitted ?? row.qty_committed ?? 0);
        const qtyAvailable = Number(row.qtyAvailable ?? row.qty_available ?? (qtyPhysical - qtyCommitted));
        return {
            id: normalizeOptional(String(row.id || '')) || `${productId}_${warehouseId}`,
            productId,
            warehouseId,
            quantity: Number.isFinite(qtyPhysical) ? qtyPhysical : 0,
            qtyPhysical: Number.isFinite(qtyPhysical) ? qtyPhysical : 0,
            qtyCommitted: Number.isFinite(qtyCommitted) ? qtyCommitted : 0,
            qtyAvailable: Number.isFinite(qtyAvailable) ? qtyAvailable : 0,
            updatedAt: normalizeOptional(String(row.updatedAt || row.updated_at || '')) || new Date().toISOString(),
        };
    }).filter(Boolean) as Record<string, unknown>[]
);

const resolveConfigPushV2TerminalId = (domain: Record<string, unknown>): string => {
    const terminal = asObject<Record<string, unknown>>(domain.terminal);
    return normalizeOptional(String(
        localStorage.getItem('active_terminal_id')
        || localStorage.getItem('CLIC_POS_TERMINAL_ID')
        || terminal.terminal_id
        || terminal.id
        || localStorage.getItem('clic_erp_sync_local_terminal_id')
        || localStorage.getItem('clic_erp_sync_terminal_id')
        || ''
    ));
};

const CONFIG_PUSH_V2_UNCHANGED = Symbol('CONFIG_PUSH_V2_UNCHANGED');

const buildConfigPushV2Delta = (baseline: unknown, resolved: unknown): unknown | typeof CONFIG_PUSH_V2_UNCHANGED => {
    if (JSON.stringify(baseline) === JSON.stringify(resolved)) return CONFIG_PUSH_V2_UNCHANGED;
    if (Array.isArray(resolved)) return cloneConfigPushV2Value(resolved);
    if (!resolved || typeof resolved !== 'object') return resolved;

    const baselineObject = asObject<Record<string, unknown>>(baseline);
    const resolvedObject = asObject<Record<string, unknown>>(resolved);
    const delta: Record<string, unknown> = {};
    Object.entries(resolvedObject).forEach(([key, value]) => {
        const childDelta = buildConfigPushV2Delta(baselineObject[key], value);
        if (childDelta !== CONFIG_PUSH_V2_UNCHANGED) delta[key] = childDelta;
    });
    return Object.keys(delta).length > 0 ? delta : CONFIG_PUSH_V2_UNCHANGED;
};

const cloneConfigPushV2Value = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const mergeConfigPushV2Delta = (current: unknown, delta: unknown): unknown => {
    if (Array.isArray(delta)) return cloneConfigPushV2Value(delta);
    if (!delta || typeof delta !== 'object') return delta;
    const currentObject = asObject<Record<string, unknown>>(current);
    return Object.fromEntries(Object.entries(asObject<Record<string, unknown>>(delta)).map(([key, value]) => [
        key,
        mergeConfigPushV2Delta(currentObject[key], value),
    ]).concat(
        Object.entries(currentObject).filter(([key]) => !Object.prototype.hasOwnProperty.call(asObject(delta), key))
    ));
};

const buildConfigWriteFromSnapshot = async (
    domain: Record<string, unknown>,
    resolved: Record<string, unknown>
): Promise<ConfigPushV2CollectionWrite | null> => {
    const localConfig = await db.get('config' as any);
    if (!localConfig || typeof localConfig !== 'object' || Array.isArray(localConfig)) return null;
    const terminal = asObject<Record<string, unknown>>(domain.terminal);
    const terminalId = resolveConfigPushV2TerminalId(domain);
    if (!terminalId) return null;
    const incomingSnapshot = {
        ...domain,
        ...terminal,
        terminal_id: terminal.terminal_id || terminal.id || terminalId,
        config: {
            ...asObject<Record<string, unknown>>(domain.config),
            ...asObject<Record<string, unknown>>(terminal.config),
        },
        resolved,
    };
    const baseline = applyTerminalConfigSnapshot(localConfig as any, {
        terminalId,
        posDeviceId: resolveLocalDeviceId() || undefined,
        incomingSnapshot: null,
    });
    const applied = applyTerminalConfigSnapshot(localConfig as any, {
        terminalId,
        posDeviceId: resolveLocalDeviceId() || undefined,
        incomingSnapshot: incomingSnapshot as any,
    });
    const delta = buildConfigPushV2Delta(baseline.config, applied.config);
    if (delta === CONFIG_PUSH_V2_UNCHANGED) return null;
    return { collection: 'config', value: mergeConfigPushV2Delta(localConfig, delta) };
};

export const buildConfigPushV2DomainWrites = async (
    scope: string,
    domainPayload: unknown
): Promise<ConfigPushV2CollectionWrite[]> => {
    // Keep the public helper backward-compatible with the former local names
    // while storing and comparing only canonical ERP domain versions.
    scope = normalizeConfigPushV2Scope(scope) || scope;
    const domain = asObject<Record<string, unknown>>(domainPayload);
    const writes = new Map<string, unknown>();
    const addArray = (collection: string, ...values: unknown[]) => {
        const value = firstArray(...values);
        if (value !== null) writes.set(collection, value);
    };
    const masters = asObject<Record<string, unknown>>(domain.masters);
    const catalog = asObject<Record<string, unknown>>(domain.catalog);
    const documents = asObject<Record<string, unknown>>(domain.documents);
    const nestedLoyalty = asObject<Record<string, unknown>>(domain.loyalty);

    if (scope === 'prices') {
        const prices = firstArray(domain.productPrices, domain.product_prices, domain.prices);
        if (prices !== null) writes.set('productPrices', normalizeConfigPushV2ProductPrices(prices));
        addArray('priceLists', domain.priceLists, domain.price_lists);
        addArray('supplierProductPrices', domain.supplierProductPrices, domain.supplier_product_prices);
    } else if (scope === 'inventory') {
        addArray('warehouses', domain.warehouses);
        const stocks = firstArray(domain.productStocks, domain.product_stocks);
        const balances = firstArray(domain.balances);
        if (stocks !== null) writes.set('productStocks', stocks);
        else if (balances !== null) writes.set('productStocks', normalizeConfigPushV2ProductStocks(balances));
    } else if (scope === 'catalog') {
        addArray('products', domain.products, domain.items, masters.items);
        addArray('customers', domain.customers, masters.customers);
        addArray('suppliers', domain.suppliers, masters.suppliers);
        addArray('users', domain.users, masters.pos_users);
        addArray('roles', domain.roles, masters.pos_roles);
        addArray('categories', domain.categories, catalog.categories);
        addArray('productCategories', domain.productCategories, domain.product_categories, catalog.productCategories, catalog.product_categories);
        addArray('productGroups', domain.productGroups, domain.product_groups, catalog.productGroups, catalog.product_groups);
        addArray('collections', domain.collections, catalog.collections);
        addArray('serviceTypes', domain.serviceTypes, domain.service_types, catalog.serviceTypes, catalog.service_types);
    } else if (scope === 'fiscal') {
        addArray('documentSeries', domain.documentSeries, domain.document_series, documents.documentSeries, documents.document_series);
        addArray('documentTypes', domain.documentTypes, domain.document_types, documents.documentTypes, documents.document_types);
        addArray('fiscalRanges', domain.fiscalRanges, domain.fiscal_ranges, documents.fiscalRanges, documents.fiscal_ranges);
        addArray('fiscalAllocations', domain.fiscalAllocations, domain.fiscal_allocations, documents.fiscalAllocations, documents.fiscal_allocations);
        addArray('taxes', domain.taxes);
        const configWrite = await buildConfigWriteFromSnapshot(domain, {
            documents,
            taxes: Array.isArray(domain.taxes) ? domain.taxes : [],
            fiscal: asObject<Record<string, unknown>>(domain.fiscal),
        });
        if (configWrite) writes.set(configWrite.collection, configWrite.value);
    } else if (scope === 'terminal_config') {
        const configWrite = await buildConfigWriteFromSnapshot(domain, asObject<Record<string, unknown>>(domain.resolved));
        if (configWrite) writes.set(configWrite.collection, configWrite.value);
    } else if (scope === 'loyalty') {
        for (const collection of CONFIG_PUSH_V2_DOMAIN_COLLECTIONS.loyalty) {
            const snake = collection.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
            addArray(collection, domain[collection], domain[snake], nestedLoyalty[collection], nestedLoyalty[snake]);
        }
        if (Object.keys(nestedLoyalty).length > 0) {
            const configWrite = await buildConfigWriteFromSnapshot(domain, { loyalty: nestedLoyalty });
            if (configWrite) writes.set(configWrite.collection, configWrite.value);
        }
    } else if (scope === 'promotions') {
        for (const collection of CONFIG_PUSH_V2_DOMAIN_COLLECTIONS.promotions) {
            const snake = collection.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
            addArray(collection, domain[collection], domain[snake]);
        }
    } else if (scope === 'purchase_orders') {
        addArray('purchaseOrders', domain.purchaseOrders, domain.purchase_orders);
    } else if (scope === 'transfers') {
        addArray('transfers', domain.transfers);
    }

    for (const collection of CONFIG_PUSH_V2_DOMAIN_COLLECTIONS[scope] || []) {
        if (writes.has(collection) || collection === 'config') continue;
        const snake = collection.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        addArray(collection, domain[collection], domain[snake]);
    }

    return Array.from(writes.entries()).map(([collection, value]) => ({ collection, value }));
};

const rollbackConfigPushV2Collections = async (journal: ConfigPushV2RollbackJournal): Promise<void> => {
    for (const [collection, previousValue] of Array.from(journal.entries()).reverse()) {
        await db.save(collection as any, previousValue);
    }
};

const assertConfigPushV2ConfigPersisted = async (expectedValue: unknown): Promise<Record<string, unknown>> => {
    const expected = asObject<Record<string, unknown>>(expectedValue);
    const persisted = asObject<Record<string, unknown>>(await db.get('config' as any));
    const expectedVertical = normalizeOptional(String(expected.vertical || expected.vertical_negocio || ''));
    const persistedVertical = normalizeOptional(String(persisted.vertical || persisted.vertical_negocio || ''));
    if (!Array.isArray(persisted.terminals) || (expectedVertical && expectedVertical !== persistedVertical)) {
        throw new Error('CONFIG_PUSH_V2_CONFIG_PERSISTENCE_MISMATCH');
    }

    const expectedBusinessConfig = asObject<Record<string, unknown>>(expected.business_config || expected.businessConfig);
    const persistedBusinessConfig = asObject<Record<string, unknown>>(persisted.business_config || persisted.businessConfig);
    for (const key of ['vertical_negocio', 'businessVertical', 'usa_mesas', 'useTables', 'pantalla_inicio']) {
        if (
            Object.prototype.hasOwnProperty.call(expectedBusinessConfig, key)
            && expectedBusinessConfig[key] !== persistedBusinessConfig[key]
        ) {
            throw new Error(`CONFIG_PUSH_V2_CONFIG_PERSISTENCE_MISMATCH:${key}`);
        }
    }
    return persisted;
};

const applyConfigPushV2Domain = async (
    scope: string,
    domainPayload: unknown,
    rollbackJournal: ConfigPushV2RollbackJournal
): Promise<string[]> => {
    const writes = await buildConfigPushV2DomainWrites(scope, domainPayload);
    const containsMasterNumberRanges = extractMasterNumberRanges(domainPayload).length > 0;
    if (writes.length === 0 && !containsMasterNumberRanges) {
        throw new Error(`Dominio ${scope} no contiene colecciones aplicables`);
    }

    const touchedCollections: string[] = [];
    for (const write of writes) {
        if (!rollbackJournal.has(write.collection)) {
            rollbackJournal.set(write.collection, await db.get(write.collection as any));
        }
        if (['products', 'productPrices', 'config', 'categories'].includes(write.collection) && (import.meta as any).env?.VITE_POS_CATALOG_EDITS_ENABLED === 'true') {
            const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
            write.value = await preserveLocalCatalog(write.collection, write.value);
        }
        await db.save(write.collection as any, write.value);
        if (write.collection === 'config') {
            await assertConfigPushV2ConfigPersisted(write.value);
        }
        touchedCollections.push(write.collection);
    }
    if (containsMasterNumberRanges) {
        touchedCollections.push('masterNumberRanges');
    }
    return touchedCollections;
};

const dispatchConfigPushV2CollectionUpdates = async (collections: string[]) => {
    const uniqueCollections = Array.from(new Set(collections));
    uniqueCollections
        .filter((collection) => collection !== 'config')
        .forEach((collection) => {
            window.dispatchEvent(new CustomEvent(`${collection}Updated`));
        });
    if (uniqueCollections.some((collection) => ['categories', 'productCategories', 'productGroups', 'collections'].includes(collection))) {
        window.dispatchEvent(new CustomEvent('categoriesUpdated'));
    }
    if (uniqueCollections.includes('config')) {
        const persistedConfig = await assertConfigPushV2ConfigPersisted(await db.get('config' as any));
        window.dispatchEvent(new CustomEvent('configUpdated', { detail: persistedConfig }));
    }
};

const validateConfigSnapshotResponse = (input: {
    payload: ConfigSnapshotResponse;
    snapshotId: string;
    versionHash: string;
    requestedScopes: string[];
    tenantId: string;
    terminalId: string;
}) => {
    const responseSnapshotId = normalizeOptional(input.payload.snapshot_id || null);
    const responseVersionHash = normalizeOptional(input.payload.version_hash || null);
    if (responseSnapshotId !== input.snapshotId) {
        throw new Error('SYNC_SNAPSHOT_ID_MISMATCH');
    }
    if (responseVersionHash !== input.versionHash) {
        throw new Error('SYNC_SNAPSHOT_VERSION_MISMATCH');
    }

    const responseTenantId = normalizeOptional(input.payload.tenant_id || input.payload.tenantId || null);
    if (responseTenantId && responseTenantId.toLowerCase() !== input.tenantId.toLowerCase()) {
        throw new Error('SYNC_SNAPSHOT_TENANT_MISMATCH');
    }
    const responseTerminalId = normalizeOptional(input.payload.terminal_id || input.payload.terminalId || null);
    if (responseTerminalId && !sameTerminalId(responseTerminalId, [input.terminalId])) {
        throw new Error('SYNC_SNAPSHOT_TERMINAL_MISMATCH');
    }

    const responseScopes = normalizeConfigPushV2Scopes(input.payload.scopes);
    const requested = new Set(input.requestedScopes);
    const unauthorized = responseScopes.filter((scope) => !requested.has(scope));
    if (unauthorized.length > 0) {
        throw new Error('SYNC_SNAPSHOT_SCOPE_FORBIDDEN');
    }

    const domains = normalizeConfigPushV2Domains(input.payload.domains);
    input.requestedScopes.forEach((scope) => {
        if (!Object.prototype.hasOwnProperty.call(domains, scope)) {
            throw new Error(`SYNC_SNAPSHOT_DOMAIN_MISSING:${scope}`);
        }
    });
};

const processConfigPushV2Event = async (
    event: SyncOutboxEvent,
    params: Pick<EnsureLifecycleParams, 'deviceId' | 'terminalId' | 'localTerminalId' | 'terminalName'>,
    binding: ReturnType<typeof getStoredErpSyncBinding>
): Promise<'APPLIED' | 'RETRY'> => {
    if (!isConfigPushV2Enabled()) {
        throw new Error('CONFIG_PUSH_V2_DISABLED');
    }

    const startedAt = Date.now();
    const payload = asObject<ConfigPushV2Payload>(event.payload);
    const eventId = normalizeOptional(event.id || null);
    const snapshotId = normalizeOptional(payload.snapshot_id || null);
    const versionHash = normalizeOptional(payload.version_hash || null);
    const versions = normalizeVersionsMap(payload.versions);
    const scopes = normalizeConfigPushV2Scopes(payload.scopes);
    const terminalId = normalizeOptional(payload.terminal_id || payload.terminalId || null);
    const eventTenantId = normalizeOptional(payload.tenant_id || payload.tenantId || null);
    const boundTenantId = normalizeOptional(binding.tenantId || null);

    configPushV2Log('config_push_v2_received', {
        event_id: eventId,
        snapshot_id: snapshotId,
        version_hash: versionHash,
        scopes,
    });

    if (!eventId || !snapshotId || !versionHash || scopes.length === 0 || Object.keys(versions).length === 0 || !terminalId) {
        throw new Error('CONFIG_PUSH_V2_INVALID_EVENT');
    }

    if (!sameTerminalId(terminalId, [binding.terminalId, binding.terminalUuid, params.terminalId, params.localTerminalId])) {
        throw new Error('CONFIG_PUSH_V2_TERMINAL_MISMATCH');
    }
    if (!boundTenantId) {
        throw new Error('CONFIG_PUSH_V2_TENANT_BINDING_MISSING');
    }
    if (eventTenantId && eventTenantId.toLowerCase() !== boundTenantId.toLowerCase()) {
        throw new Error('CONFIG_PUSH_V2_TENANT_MISMATCH');
    }

    configPushV2Log('CONFIG_PUSH_V2_APPLY_STARTED', {
        outbox_id: eventId,
        event_type: 'CONFIG_PUSH_V2',
        snapshot_id: snapshotId,
        scopes,
        status: 'PROCESSING',
    });

    const state = readConfigPushV2State();
    const attempts = state.inFlight?.eventId === eventId ? Number(state.inFlight.attempts || 0) : 0;
    setConfigPushV2InFlight(eventId, snapshotId, versionHash, scopes, attempts, null);

    if (state.versionHash === versionHash) {
        configPushV2Log('CONFIG_PUSH_V2_ALREADY_APPLIED', {
            outbox_id: eventId,
            event_type: 'CONFIG_PUSH_V2',
            snapshot_id: snapshotId,
            scopes,
            status: 'APPLIED',
        });
        configPushV2Log('config_snapshot_skipped_same_version', {
            event_id: eventId,
            snapshot_id: snapshotId,
            version_hash: versionHash,
            scopes,
            duration_ms: Date.now() - startedAt,
        });
        await ackErpOutboxEvent(eventId, 'APPLIED');
        clearConfigPushV2InFlight();
        configPushV2Log('config_push_v2_acknowledged', {
            event_id: eventId,
            snapshot_id: snapshotId,
            version_hash: versionHash,
            scopes,
            duration_ms: Date.now() - startedAt,
        });
        configPushV2Log('CONFIG_PUSH_V2_APPLY_COMPLETED', {
            outbox_id: eventId,
            event_type: 'CONFIG_PUSH_V2',
            snapshot_id: snapshotId,
            scopes,
            status: 'APPLIED',
            duration_ms: Date.now() - startedAt,
        });
        return 'APPLIED';
    }

    const staleScopes = scopes.filter((scope) => Number(versions[scope] || 0) > getConfigPushV2LocalVersion(state, scope));
    scopes.forEach((scope) => {
        configPushV2Log('config_push_v2_domain_version_compared', {
            reason: 'outbox_event',
            domain: scope,
            local_version: getConfigPushV2LocalVersion(state, scope),
            remote_version: Number(versions[scope] || 0),
            download_required: staleScopes.includes(scope),
        });
    });
    if (staleScopes.length === 0) {
        configPushV2Log('CONFIG_PUSH_V2_ALREADY_APPLIED', {
            outbox_id: eventId,
            event_type: 'CONFIG_PUSH_V2',
            snapshot_id: snapshotId,
            scopes,
            status: 'APPLIED',
        });
        writeConfigPushV2State({
            versionHash,
            domainVersions: {
                ...(state.domainVersions || {}),
                ...Object.fromEntries(scopes.map((scope) => [scope, Number(versions[scope] || 0)])),
            },
            appliedAt: new Date().toISOString(),
            inFlight: readConfigPushV2State().inFlight,
        });
        await ackErpOutboxEvent(eventId, 'APPLIED');
        clearConfigPushV2InFlight();
        configPushV2Log('config_push_v2_acknowledged', {
            event_id: eventId,
            snapshot_id: snapshotId,
            version_hash: versionHash,
            scopes,
            count: 0,
            duration_ms: Date.now() - startedAt,
        });
        configPushV2Log('CONFIG_PUSH_V2_APPLY_COMPLETED', {
            outbox_id: eventId,
            event_type: 'CONFIG_PUSH_V2',
            snapshot_id: snapshotId,
            scopes,
            status: 'APPLIED',
            duration_ms: Date.now() - startedAt,
        });
        return 'APPLIED';
    }

    let attempt = attempts;
    const maxAttemptsThisCycle = 3;
    while (attempt < attempts + maxAttemptsThisCycle) {
        attempt += 1;
        setConfigPushV2InFlight(eventId, snapshotId, versionHash, staleScopes, attempt, null);
        try {
            configPushV2Log('config_snapshot_download_started', {
                event_id: eventId,
                snapshot_id: snapshotId,
                version_hash: versionHash,
                scopes: staleScopes,
                attempt,
            });
            const result = await fetchConfigSnapshotV2({
                terminalId,
                snapshotId,
                versionHash,
                currentVersionHash: state.versionHash,
                scopes: staleScopes,
                deviceId: params.deviceId,
            });

            if (result.status === 304) {
                configPushV2Log('CONFIG_PUSH_V2_ALREADY_APPLIED', {
                    outbox_id: eventId,
                    event_type: 'CONFIG_PUSH_V2',
                    snapshot_id: snapshotId,
                    scopes: staleScopes,
                    status: 'APPLIED',
                });
                await ackErpOutboxEvent(eventId, 'APPLIED');
                clearConfigPushV2InFlight();
                configPushV2Log('config_push_v2_acknowledged', {
                    event_id: eventId,
                    snapshot_id: snapshotId,
                    version_hash: versionHash,
                    scopes: staleScopes,
                    duration_ms: Date.now() - startedAt,
                });
                configPushV2Log('CONFIG_PUSH_V2_APPLY_COMPLETED', {
                    outbox_id: eventId,
                    event_type: 'CONFIG_PUSH_V2',
                    snapshot_id: snapshotId,
                    scopes: staleScopes,
                    status: 'APPLIED',
                    duration_ms: Date.now() - startedAt,
                });
                return 'APPLIED';
            }

            const snapshotPayload = result.payload || {};
            validateConfigSnapshotResponse({
                payload: snapshotPayload,
                snapshotId,
                versionHash,
                requestedScopes: staleScopes,
                tenantId: boundTenantId,
                terminalId,
            });

            configPushV2Log('config_snapshot_downloaded', {
                event_id: eventId,
                snapshot_id: snapshotId,
                version_hash: versionHash,
                scopes: staleScopes,
                attempt,
                bytes_received: result.size,
            });

            const domains = normalizeConfigPushV2Domains(snapshotPayload.domains);
            const snapshotVersions = normalizeVersionsMap(snapshotPayload.versions);
            const nextDomainVersions = { ...(state.domainVersions || {}) };
            const rollbackJournal: ConfigPushV2RollbackJournal = new Map();
            const touchedCollections: string[] = [];
            try {
                for (const scope of staleScopes) {
                    const touchedForScope = await applyConfigPushV2Domain(scope, domains[scope], rollbackJournal);
                    touchedCollections.push(...touchedForScope);
                    nextDomainVersions[scope] = Number(snapshotVersions[scope] ?? versions[scope] ?? 0);
                    configPushV2Log('config_snapshot_domain_applied', {
                        event_id: eventId,
                        snapshot_id: snapshotId,
                        version_hash: versionHash,
                        scopes: [scope],
                        count: touchedForScope.length,
                    });
                }
                // Do not activate a range from an event whose later domain fails.
                // The independent monotonic range transaction runs only after all
                // ordinary domain writes have been validated successfully.
                const masterNumberRanges = staleScopes.flatMap(scope => extractMasterNumberRanges(domains[scope]));
                if (masterNumberRanges.length > 0) {
                    await persistMasterNumberRangesFromSnapshot(
                        { resolved: { master_number_ranges: masterNumberRanges } }, terminalId,
                    );
                }
            } catch (error) {
                await rollbackConfigPushV2Collections(rollbackJournal);
                configPushV2Log('config_snapshot_apply_failed', {
                    event_id: eventId,
                    snapshot_id: snapshotId,
                    version_hash: versionHash,
                    scopes: staleScopes,
                    code: compactErrorDetail(error),
                    rolled_back_collections: rollbackJournal.size,
                });
                throw error;
            }

            writeConfigPushV2State({
                versionHash,
                domainVersions: {
                    ...nextDomainVersions,
                    ...Object.fromEntries(scopes.map((scope) => [scope, Number(versions[scope] || nextDomainVersions[scope] || 0)])),
                },
                appliedAt: new Date().toISOString(),
                inFlight: readConfigPushV2State().inFlight,
            });
            configPushV2Log('config_snapshot_version_persisted', {
                event_id: eventId,
                snapshot_id: snapshotId,
                version_hash: versionHash,
                scopes: staleScopes,
                domain_versions: nextDomainVersions,
            });
            await dispatchConfigPushV2CollectionUpdates(touchedCollections);
            syncMetrics.markApplyFinished();
            await ackErpOutboxEvent(eventId, 'APPLIED');
            clearConfigPushV2InFlight();
            configPushV2Log('config_push_v2_acknowledged', {
                event_id: eventId,
                snapshot_id: snapshotId,
                version_hash: versionHash,
                scopes: staleScopes,
                duration_ms: Date.now() - startedAt,
            });
            configPushV2Log('CONFIG_PUSH_V2_APPLY_COMPLETED', {
                outbox_id: eventId,
                event_type: 'CONFIG_PUSH_V2',
                snapshot_id: snapshotId,
                scopes: staleScopes,
                status: 'APPLIED',
                duration_ms: Date.now() - startedAt,
            });
            return 'APPLIED';
        } catch (error) {
            const requestError = error as SyncRequestError;
            const retryAfterMs = Math.min(
                10000,
                Math.max(requestError.retryAfterMs || 500, 500 * (2 ** Math.max(0, attempt - 1)))
            );
            const code = requestError.code || compactErrorDetail(error);
            setConfigPushV2InFlight(eventId, snapshotId, versionHash, staleScopes, attempt, code);

            if (requestError.retryable || requestError.status === 503 || requestError.status === 0) {
                configPushV2Log(requestError.status === 503 ? 'config_snapshot_building' : 'config_push_v2_retry_scheduled', {
                    event_id: eventId,
                    snapshot_id: snapshotId,
                    version_hash: versionHash,
                    scopes: staleScopes,
                    attempt,
                    code,
                    retry_after_ms: retryAfterMs,
                });
                await delay(retryAfterMs);
                continue;
            }

            throw error;
        }
    }

    configPushV2Log('config_push_v2_retry_scheduled', {
        event_id: eventId,
        snapshot_id: snapshotId,
        version_hash: versionHash,
        scopes: staleScopes,
        attempt,
        code: 'RETRY_LIMIT_THIS_CYCLE',
    });
    return 'RETRY';
};

export const isLifecycleActivationBlocked = (activation?: SyncActivationState | null): boolean => {
    if (!activation) return false;

    const mode = normalizeActivationMode(activation.mode);
    const reason = normalizeActivationReason(activation.reason);
    const billingStatus = normalizeActivationBillingStatus(activation.billing_status);

    return (
        activation.erp_enabled === false
        || activation.terminal_active === false
        || activation.kill_switch_active === true
        || mode === 'LICENSE_BLOCKED'
        || mode === 'TERMINAL_BLOCKED'
        || mode === 'ERP_DISABLED'
        || reason === 'TERMINAL_DISABLED'
        || (Boolean(billingStatus) && billingStatus !== 'ACTIVE')
    );
};

export const getLifecycleActivationBlockMessage = (activation?: SyncActivationState | null): string => {
    if (!activation) {
        return 'Servicio Suspendido.';
    }

    const mode = normalizeActivationMode(activation.mode);
    const reason = normalizeActivationReason(activation.reason);
    const billingStatus = normalizeActivationBillingStatus(activation.billing_status);

    if (mode === 'TERMINAL_BLOCKED' || reason === 'TERMINAL_DISABLED' || activation.terminal_active === false) {
        return 'Esta terminal ha sido desactivada temporalmente desde el Panel de Control.';
    }

    if (mode === 'ERP_DISABLED' || activation.erp_enabled === false) {
        return 'El tenant está activo solo para POS local; la integración ERP está deshabilitada.';
    }

    if (billingStatus && billingStatus !== 'ACTIVE') {
        return billingStatus.replace(/_/g, ' ');
    }

    return normalizeOptional(activation.reason) || 'Servicio Suspendido.';
};

export const getLifecycleBlockingMessageFromError = (error: unknown): string | null => {
    const requestError = error as SyncRequestError | null;
    const code = normalizeActivationReason(requestError?.code || null);
    const message = normalizeOptional(requestError?.message || null).toLowerCase();
    const payloadActivation = asObject<{ activation?: SyncActivationState | null }>(requestError?.payload).activation || null;

    if (payloadActivation && isLifecycleActivationBlocked(payloadActivation)) {
        return getLifecycleActivationBlockMessage(payloadActivation);
    }

    if (
        code === 'DEVICE_SUPERSEDED'
        || message.includes('ya no es la terminal autorizada')
        || message.includes('dispositivo ya no está autorizado')
        || message.includes('dispositivo ya no esta autorizado')
    ) {
        return DEVICE_SUPERSEDED_MESSAGE;
    }

    if (
        code === 'LICENSE_BLOCKED'
        || code === 'TERMINAL_DISABLED'
        || code === 'LICENSE_EXCEEDED_INACTIVE'
        || message.includes('terminal ha sido desactivada')
        || message.includes('licencia actual no permite')
        || message.includes('integración erp está deshabilitada')
        || message.includes('integracion erp esta deshabilitada')
    ) {
        if (code === 'TERMINAL_DISABLED' || code === 'LICENSE_EXCEEDED_INACTIVE' || message.includes('terminal ha sido desactivada')) {
            return 'Esta terminal ha sido desactivada temporalmente desde el Panel de Control.';
        }

        if (message.includes('integración erp está deshabilitada') || message.includes('integracion erp esta deshabilitada')) {
            return 'El tenant está activo solo para POS local; la integración ERP está deshabilitada.';
        }

        return 'Servicio Suspendido.';
    }

    return null;
};
const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const pickBoolean = (...values: unknown[]): boolean | undefined => {
    for (const value of values) {
        if (typeof value === 'boolean') {
            return value;
        }
    }
    return undefined;
};
const resolveDeviceRole = (value: unknown): DeviceRole => {
    return normalizeDeviceRoleValue(value);
};
const resolveAuthLevel = (value: unknown): AuthLevel | null => {
    const normalized = normalizeOptional(String(value || '')).toUpperCase();
    if (normalized === AuthLevel.HEADLESS) {
        return AuthLevel.HEADLESS;
    }
    if (normalized === AuthLevel.USER_REQUIRED) {
        return AuthLevel.USER_REQUIRED;
    }
    return null;
};

const normalizeSyncApiBase = (value?: string | null): string =>
    normalizeErpSyncApiBase(value) || '';

const getSyncApiBase = () => resolveErpSyncApiBase() || '';

const isConfigured = () => Boolean(getSyncApiBase());

const readRuntimeDeviceInfo = async (): Promise<RuntimeDeviceInfo | null> => {
    try {
        const runtimeWindow = window as any;

        if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
            return await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
        }

        if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
            const raw = runtimeWindow.AndroidPrinter.getDeviceInfo();
            return raw ? JSON.parse(raw) : null;
        }
    } catch (error) {
        console.warn('[erpSyncLifecycle] no se pudo leer el runtime nativo:', error);
    }

    return null;
};

const resolveRuntimeTelemetry = async () => {
    const deviceInfo = await readRuntimeDeviceInfo();
    const localIps = Array.from(
        new Set(
            [
                normalizeOptional(deviceInfo?.localIp || null),
                ...((Array.isArray(deviceInfo?.localIps) ? deviceInfo?.localIps : []).map((value) => normalizeOptional(value || null))),
            ].filter(Boolean)
        )
    );

    return {
        appVersion: normalizeOptional(deviceInfo?.versionName || null) || null,
        ipAddress: localIps[0] || null,
    };
};

const readJson = async <T>(response: Response): Promise<T> => {
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : 'ERP sync lifecycle request failed';
        const error = new Error(message) as SyncRequestError;
        error.status = response.status;
        error.code = typeof payload?.code === 'string' ? payload.code : null;
        error.payload = payload;
        const backendCode = normalizeOptional(error.code || null).toUpperCase();
        if (
            (response.status === 401 || response.status === 403)
            && ['SYNC_TOKEN_MISSING', 'SYNC_TOKEN_INVALID', 'SYNC_SCOPE_FORBIDDEN'].includes(backendCode)
        ) {
            if (backendCode !== 'SYNC_SCOPE_FORBIDDEN') {
                clearStoredSyncToken();
            }
            const credentials = readTerminalCredentialsSync();
            saveTerminalCredentialsSync({
                terminalId: credentials.terminalId || null,
                erpTerminalId: credentials.erpTerminalId || credentials.terminalId || null,
                deviceId: credentials.deviceId || resolveLocalDeviceId() || null,
                authStatus: 'NEEDS_REAUTH',
                lastAuthError: backendCode,
            });
            localStorage.setItem('clic_sync_auth_status', 'NEEDS_REAUTH');
            localStorage.setItem('clic_sync_last_auth_error', backendCode);
            setTerminalBindingDiagnosticStatus('NEEDS_REAUTH');
            setCatalogDiagnosticStatus('AUTH_ERROR');
            setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
            setSyncAuthDiagnosticStatus('NEEDS_REAUTH');
            error.retryable = true;
            error.retryAfterMs = 5 * 60_000;
            window.dispatchEvent(new CustomEvent('clic-pos-sync-auth-required', {
                detail: {
                    code: backendCode,
                    nextAction: backendCode === 'SYNC_SCOPE_FORBIDDEN'
                        ? 'REPAIR_TERMINAL_SCOPE'
                        : 'REPAIR_TERMINAL_PAIRING',
                },
            }));
        }
        throw error;
    }

    return payload as T;
};

const shouldRecoverErpBinding = (error: unknown) => {
    const requestError = error as SyncRequestError | null;
    const code = normalizeOptional(requestError?.code || null).toUpperCase();
    const message = normalizeOptional(requestError?.message || null).toLowerCase();

    return (
        requestError?.status === 404
        || message.includes('terminal no encontrada')
    );
};

const recoverErpSyncBinding = async (params: EnsureLifecycleParams) => {
    clearStoredErpSyncBinding();

    const bootstrap = await bootstrapErpSyncLifecycle(params.deviceId);
    const recoveredBinding = getStoredErpSyncBinding();

    let registered: SyncRegisterResponse | null = null;

    if (!recoveredBinding.terminalId) {
        registered = await registerErpSyncTerminal({
            ...params,
            companyId: params.companyId || recoveredBinding.companyId,
            storeId: params.storeId || recoveredBinding.storeId,
        });
    }

    const heartbeat = await heartbeatErpSyncTerminal(params, params.deviceId);
    return { bootstrap, registered, heartbeat };
};

const persistBinding = (
    terminal: SyncTerminalRecord | null | undefined,
    identity?: TenantIdentity | null,
    overrides?: {
        localTerminalId?: string | null;
        terminalName?: string | null;
    }
) => {
    const canonicalTerminalId = resolveCanonicalErpTerminalId(terminal);
    if (!terminal || !canonicalTerminalId) return;

    const currentIdentity = identity || getStoredTenantIdentity();
    const tenantId = normalizeOptional(currentIdentity.tenantId || terminal.tenant_id || null);
    const localTerminalId = normalizeOptional(
        overrides?.localTerminalId
        || localStorage.getItem(SYNC_BINDING_LOCAL_TERMINAL_KEY)
        || null
    );
    const terminalName = normalizeOptional(
        overrides?.terminalName
        || terminal.name
        || localStorage.getItem(SYNC_BINDING_TERMINAL_NAME_KEY)
        || null
    );

    if (tenantId) {
        localStorage.setItem(SYNC_BINDING_TENANT_KEY, tenantId);
    }

    localStorage.setItem(SYNC_BINDING_TERMINAL_KEY, canonicalTerminalId);

    if (localTerminalId) {
        localStorage.setItem(SYNC_BINDING_LOCAL_TERMINAL_KEY, localTerminalId);
    }

    if (terminalName) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_NAME_KEY, terminalName);
    }

    if (terminal.company_id) {
        localStorage.setItem(SYNC_BINDING_COMPANY_KEY, terminal.company_id);
    }

    if (terminal.store_id) {
        localStorage.setItem(SYNC_BINDING_STORE_KEY, terminal.store_id);
    }

    if (terminal.last_seen) {
        localStorage.setItem(SYNC_BINDING_LAST_SEEN_KEY, terminal.last_seen);
    }

    if (terminal.status) {
        localStorage.setItem(SYNC_BINDING_STATUS_KEY, terminal.status);
    }
    saveTerminalCredentialsSync({
        terminalId: canonicalTerminalId,
        erpTerminalId: canonicalTerminalId,
        ...(tenantId ? { tenantId, erpTenantId: tenantId } : {}),
        ...(terminal.company_id ? { companyId: terminal.company_id } : {}),
        ...(terminal.store_id ? { storeId: terminal.store_id } : {}),
    });
};

export const persistStoredErpSyncBinding = (input: {
    tenantId?: string | null;
    terminalId?: string | null;
    terminalUuid?: string | null;
    localTerminalId?: string | null;
    terminalName?: string | null;
    companyId?: string | null;
    storeId?: string | null;
    lastSeen?: string | null;
    status?: string | null;
}) => {
    const tenantId = normalizeOptional(input.tenantId || null);
    const terminalId = normalizeCanonicalErpTerminalId(input.terminalId);
    const terminalUuid = normalizeCanonicalErpTerminalId(input.terminalUuid);
    const localTerminalId = normalizeOptional(input.localTerminalId || null);
    const terminalName = normalizeOptional(input.terminalName || null);
    const companyId = normalizeOptional(input.companyId || null);
    const storeId = normalizeOptional(input.storeId || null);
    const lastSeen = normalizeOptional(input.lastSeen || null);
    const status = normalizeOptional(input.status || null);

    if (tenantId) {
        localStorage.setItem(SYNC_BINDING_TENANT_KEY, tenantId);
    }

    if (terminalId) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_KEY, terminalId);
    } else if (input.terminalId) {
        localStorage.removeItem(SYNC_BINDING_TERMINAL_KEY);
    }

    if (terminalUuid) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_UUID_KEY, terminalUuid);
    } else if (input.terminalUuid) {
        localStorage.removeItem(SYNC_BINDING_TERMINAL_UUID_KEY);
    }

    if (localTerminalId) {
        localStorage.setItem(SYNC_BINDING_LOCAL_TERMINAL_KEY, localTerminalId);
    }

    if (terminalName) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_NAME_KEY, terminalName);
    }

    if (companyId) {
        localStorage.setItem(SYNC_BINDING_COMPANY_KEY, companyId);
    }

    if (storeId) {
        localStorage.setItem(SYNC_BINDING_STORE_KEY, storeId);
    }

    if (lastSeen) {
        localStorage.setItem(SYNC_BINDING_LAST_SEEN_KEY, lastSeen);
    }

    if (status) {
        localStorage.setItem(SYNC_BINDING_STATUS_KEY, status);
    }
    saveTerminalCredentialsSync({
        ...(terminalId ? { terminalId, erpTerminalId: terminalId } : {}),
        ...(tenantId ? { tenantId, erpTenantId: tenantId } : {}),
        ...(companyId ? { companyId } : {}),
        ...(storeId ? { storeId } : {}),
    });
};

export type ErpSyncAuthIdentity = {
    terminalId: string | null;
    terminalUuid: string | null;
    tenantId: string | null;
    companyId: string | null;
    storeId: string | null;
    deviceId: string | null;
};

export const persistErpSyncAuthIdentity = (
    payload: unknown,
    fallbackTerminalId?: string | null
): ErpSyncAuthIdentity => {
    const root = asObject<Record<string, unknown>>(payload);
    const operationalIdentity = asObject<Record<string, unknown>>(root.operational_identity);
    const terminal = asObject<Record<string, unknown>>(root.terminal);

    const terminalId = resolveCanonicalErpTerminalId(root, terminal, fallbackTerminalId) || null;
    const terminalUuid =
        normalizeCanonicalErpTerminalId(root.terminal_uuid)
        || normalizeCanonicalErpTerminalId(root.terminalUuid)
        || normalizeCanonicalErpTerminalId(terminal.uuid)
        || terminalId;
    const tenantId =
        normalizeOptional(String(operationalIdentity.tenant_id || root.tenant_id || terminal.tenant_id || ''))
        || null;
    const companyId =
        normalizeOptional(String(operationalIdentity.company_id || root.company_id || terminal.company_id || ''))
        || null;
    const storeId =
        normalizeOptional(String(operationalIdentity.store_id || root.store_id || terminal.store_id || ''))
        || null;
    const deviceId =
        normalizeOptional(String(root.device_id || root.deviceId || terminal.device_id || ''))
        || null;

    persistStoredErpSyncBinding({
        tenantId,
        terminalId,
        terminalUuid,
        companyId,
        storeId,
    });

    if (tenantId) {
        localStorage.setItem('active_tenant_id', tenantId);
        localStorage.setItem('clic_tenant_id', tenantId);
    }

    if (deviceId) {
        persistLocalDeviceId(deviceId);
    }

    return {
        terminalId,
        terminalUuid,
        tenantId,
        companyId,
        storeId,
        deviceId,
    };
};

export const erpSyncAuthRequiresFullBootstrap = (payload: unknown): boolean => {
    const root = asObject<Record<string, unknown>>(payload);
    const syncState = asObject<Record<string, unknown>>(root.sync_state);
    const resetReason = normalizeOptional(String(syncState.reset_reason || root.bootstrap_reason || '')).toUpperCase();

    return (
        root.requires_full_bootstrap === true
        || root.sync_reset_required === true
        || resetReason === 'TERMINAL_TAKEOVER'
    );
};

export const clearErpIncrementalSyncState = () => {
    const removeByPrefix = (storage: Storage, prefixes: string[]) => {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
                keys.push(key);
            }
        }
        keys.forEach((key) => storage.removeItem(key));
    };

    removeByPrefix(localStorage, [
        'clic_pos_collection_timestamp_cursor:',
        'clic_pos_terminal_catalog_cursor:',
        'clic_pos_terminal_manifest_cursor_map:',
        'clic_pos_terminal_config_',
        'clic_erp_manifest_',
        'clic_erp_config_',
        'clic_erp_inventory_',
        'clic_erp_product_prices_',
        'erp_manifest_',
        'erp_inventory_',
        'erp_product_prices_',
    ]);

    removeByPrefix(sessionStorage, [
        'clic_pos_terminal_startup_manifest_synced:',
    ]);

    localStorage.removeItem(TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY);
    localStorage.removeItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY);
};

export const markErpFullBootstrapRequired = (payload: unknown) => {
    const root = asObject<Record<string, unknown>>(payload);
    const syncState = asObject<Record<string, unknown>>(root.sync_state);
    const reason =
        normalizeOptional(String(syncState.reset_reason || root.bootstrap_reason || 'TERMINAL_TAKEOVER'))
        || 'TERMINAL_TAKEOVER';

    const alreadyMarked =
        localStorage.getItem(ERP_FULL_BOOTSTRAP_REQUIRED_KEY) === 'true'
        && localStorage.getItem(ERP_FULL_BOOTSTRAP_REASON_KEY) === reason;

    localStorage.setItem(ERP_FULL_BOOTSTRAP_REQUIRED_KEY, 'true');
    localStorage.setItem(ERP_FULL_BOOTSTRAP_REASON_KEY, reason);
    if (alreadyMarked) return;

    window.dispatchEvent(new CustomEvent(ERP_FULL_BOOTSTRAP_REQUIRED_EVENT, {
        detail: {
            reason,
            payload,
        },
    }));
};

const clearBindingIfTenantChanged = (identity: TenantIdentity) => {
    const currentTenantId = normalizeOptional(identity.tenantId || null);
    const activeErpTenantId = normalizeOptional(localStorage.getItem('active_tenant_id'));
    const boundTenantId = normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY));

    const matchesRuntimeTenant =
        (currentTenantId && currentTenantId === boundTenantId) ||
        (activeErpTenantId && activeErpTenantId === boundTenantId);

    if (boundTenantId && !matchesRuntimeTenant && currentTenantId) {
        clearStoredErpSyncBinding();
    }
};

const buildDeviceHeaders = (deviceId?: unknown): Record<string, string> => {
    const resolvedDeviceId = normalizeOptional(String(deviceId || resolveLocalDeviceId() || ''));
    const credentials = readTerminalCredentialsSync();
    const deviceToken = normalizeOptional(getSyncDeviceToken() || credentials.deviceToken || '');
    return {
        ...buildTerminalSyncAuthHeaders(),
        ...(deviceToken ? { 'X-Device-Token': deviceToken } : {}),
        ...(resolvedDeviceId
        ? {
            'X-Device-Id': resolvedDeviceId,
            'X-POS-Device-Id': resolvedDeviceId,
        }
        : {}),
    };
};

const fetchLifecycleRequest = async (input: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
        () => controller.abort(),
        ERP_SYNC_LIFECYCLE_REQUEST_TIMEOUT_MS,
    );

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (controller.signal.aborted) {
            const timeoutError = new Error(
                `ERP sync lifecycle request timed out after ${ERP_SYNC_LIFECYCLE_REQUEST_TIMEOUT_MS}ms`,
            ) as SyncRequestError;
            timeoutError.code = 'ERP_SYNC_TIMEOUT';
            timeoutError.retryable = true;
            throw timeoutError;
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
};

const postJson = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const baseUrl = getSyncApiBase();
    if (!baseUrl) {
        throw new Error('ERP sync lifecycle URL is not configured');
    }

    const response = await fetchLifecycleRequest(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...buildDeviceHeaders(body.device_id as string | null | undefined),
        },
        body: JSON.stringify(body),
    });

    return readJson<T>(response);
};

const getJson = async <T>(path: string, query: Record<string, string | number | null | undefined>): Promise<T> => {
    const baseUrl = getSyncApiBase();
    if (!baseUrl) {
        throw new Error('ERP sync lifecycle URL is not configured');
    }

    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return;
        searchParams.set(key, String(value));
    });

    const response = await fetchLifecycleRequest(`${baseUrl}${path}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...buildDeviceHeaders(query.device_id as string | number | null | undefined),
        },
    });

    return readJson<T>(response);
};

const persistTerminalConfigRestartNotice = (event: SyncOutboxEvent) => {
    const payload = asObject<Record<string, unknown>>(event.payload);
    const terminalConfig = asObject<Record<string, unknown>>(payload.terminal_config);
    const terminalId =
        normalizeOptional(String(payload.terminalId || ''))
        || normalizeOptional(String(payload.terminal_id || ''))
        || normalizeOptional(String(terminalConfig.terminal_id || ''))
        || null;

    const notice = {
        receivedAt: new Date().toISOString(),
        eventId: normalizeOptional(event.id || null) || null,
        terminalId,
    };

    localStorage.setItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY, JSON.stringify(notice));
    window.dispatchEvent(new CustomEvent('terminalConfigRestartRequired', { detail: notice }));
};

const persistPendingTerminalConfigSnapshot = (event: SyncOutboxEvent) => {
    const payload = asObject<Record<string, unknown>>(event.payload);
    const terminalConfig = asObject<Record<string, unknown>>(payload.terminal_config);
    const requestedScopes = extractTerminalConfigRequestedScopes(payload);
    const binding = getStoredErpSyncBinding();

    if (Object.keys(terminalConfig).length === 0) {
        if (requestedScopes.selective) {
            window.dispatchEvent(new CustomEvent('terminalConfigSyncRequested', {
                detail: {
                    source: 'erp_outbox',
                    eventId: normalizeOptional(event.id || null) || null,
                    terminalId:
                        normalizeOptional(String(payload.terminal_id || ''))
                        || normalizeOptional(String(payload.terminalId || ''))
                        || binding.terminalId
                        || null,
                    localTerminalId:
                        normalizeOptional(String(payload.local_terminal_id || ''))
                        || binding.localTerminalId
                        || null,
                    masterScopes: requestedScopes.masterScopes || [],
                    blockScopes: requestedScopes.blockScopes || [],
                    resolvedScopes: requestedScopes.resolvedScopes || [],
                    selective: true,
                },
            }));
        }
        return;
    }

    const pendingSnapshot = {
        receivedAt: new Date().toISOString(),
        eventId: normalizeOptional(event.id || null) || null,
        erpTerminalId:
            normalizeOptional(String(payload.terminal_id || ''))
            || normalizeOptional(String(terminalConfig.terminal_id || ''))
            || binding.terminalId
            || null,
        localTerminalId:
            normalizeOptional(String(payload.local_terminal_id || ''))
            || binding.localTerminalId
            || null,
        masterScopes: requestedScopes.selective ? (requestedScopes.masterScopes || []) : undefined,
        blockScopes: requestedScopes.selective ? (requestedScopes.blockScopes || []) : undefined,
        resolvedScopes: requestedScopes.selective ? (requestedScopes.resolvedScopes || []) : undefined,
        snapshot: terminalConfig,
    };

    localStorage.setItem(TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY, JSON.stringify(pendingSnapshot));
    window.dispatchEvent(new CustomEvent('terminalConfigSyncRequested', {
        detail: {
            source: 'erp_outbox',
            eventId: normalizeOptional(event.id || null) || null,
            terminalId: pendingSnapshot.erpTerminalId,
            localTerminalId: pendingSnapshot.localTerminalId,
            ...(requestedScopes.selective ? {
                masterScopes: requestedScopes.masterScopes || [],
                blockScopes: requestedScopes.blockScopes || [],
                resolvedScopes: requestedScopes.resolvedScopes || [],
                selective: true,
            } : {}),
        },
    }));
};

const buildCompatibleDeviceRoleConfig = (
    currentRoleConfig: DeviceRoleConfig | null | undefined,
    incomingRoleConfig: unknown
): DeviceRoleConfig => {
    const current = currentRoleConfig && typeof currentRoleConfig === 'object'
        ? currentRoleConfig
        : null;
    const incoming = asObject<Record<string, unknown>>(incomingRoleConfig);
    const incomingUi = asObject<Record<string, unknown>>(incoming.uiSettings);
    const incomingHardware = asObject<Record<string, unknown>>(incoming.hardwareConfig);
    const role = resolveDeviceRole(incoming.role || current?.role || DeviceRole.STANDARD_POS);
    const defaults = getDefaultRoleConfig(role);
    const roleChanged = Boolean(current?.role) && current?.role !== role;
    const currentUi = !roleChanged ? asObject<Record<string, unknown>>(current?.uiSettings) : {};
    const currentHardware = !roleChanged ? asObject<Record<string, unknown>>(current?.hardwareConfig) : {};
    const currentEscapeHatch = !roleChanged
        ? asObject<Record<string, unknown>>(currentUi.escapeHatch)
        : {};
    const incomingEscapeHatch = asObject<Record<string, unknown>>(incomingUi.escapeHatch);
    const currentAdminPin = normalizeOptional(String(current?.uiSettings?.escapeHatch?.adminPin || ''));
    const allowedModules = normalizeAllowedModules(incoming.allowedModules);
    const currentAllowedModules = Array.isArray(current?.allowedModules)
        ? normalizeAllowedModules(current.allowedModules)
        : [];
    const defaultAllowedModules = normalizeAllowedModules(defaults.allowedModules);
    const resolvedAllowedModules = allowedModules.length > 0
        ? allowedModules
        : currentAllowedModules.length > 0 && !roleChanged
            ? currentAllowedModules
            : defaultAllowedModules;
    const roleChangedToHeadless = roleChanged && defaults.authLevel === AuthLevel.HEADLESS;
    const touchTargetSize = toFiniteNumber(
        incomingUi.touchTargetSize
        ?? (!roleChangedToHeadless ? incoming.touchTargetSize : undefined)
        ?? currentUi.touchTargetSize
        ?? defaults.uiSettings.touchTargetSize
    ) ?? defaults.uiSettings.touchTargetSize;
    const fullscreenForced = pickBoolean(
        incoming.fullscreenForced,
        incomingUi.fullscreenForced,
        currentUi.fullscreenForced,
        defaults.uiSettings.fullscreenForced
    ) ?? defaults.uiSettings.fullscreenForced;
    const navigationLocked = pickBoolean(
        incoming.navigationLocked,
        incomingUi.navigationLocked,
        currentUi.navigationLocked,
        defaults.uiSettings.navigationLocked
    ) ?? defaults.uiSettings.navigationLocked;
    const incomingAuthLevel = resolveAuthLevel(incoming.authLevel);
    const authLevel =
        roleChangedToHeadless && incomingAuthLevel === AuthLevel.USER_REQUIRED
            ? defaults.authLevel
            : incomingAuthLevel
            || (!roleChanged ? resolveAuthLevel(current?.authLevel) : null)
            || defaults.authLevel;
    const defaultRoute = normalizeOptional(String(incoming.defaultRoute || ''))
        || (!roleChanged ? normalizeOptional(String(current?.defaultRoute || '')) : '')
        || defaults.defaultRoute;
    const apiToken = normalizeOptional(String(incoming.apiToken || ''))
        || normalizeOptional(String(current?.apiToken || ''))
        || undefined;

    return {
        ...defaults,
        ...(roleChanged ? {} : current || {}),
        ...incoming,
        role,
        authLevel,
        defaultRoute,
        apiToken,
        allowedModules: resolvedAllowedModules,
        uiSettings: {
            ...defaults.uiSettings,
            ...currentUi,
            ...incomingUi,
            fullscreenForced,
            touchTargetSize,
            navigationLocked,
            escapeHatch: {
                ...defaults.uiSettings.escapeHatch,
                ...currentEscapeHatch,
                ...incomingEscapeHatch,
                ...(currentAdminPin && !normalizeOptional(String(incomingEscapeHatch.adminPin || ''))
                    ? { adminPin: currentAdminPin }
                    : {}),
            },
        },
        hardwareConfig: {
            ...defaults.hardwareConfig,
            ...currentHardware,
            ...incomingHardware,
        },
    };
};

const buildIncomingConfigPushDeviceRole = (
    snapshot: Record<string, unknown>,
    incomingConfig: Record<string, unknown>
): Record<string, unknown> => {
    const resolved = asObject<Record<string, unknown>>(snapshot.resolved);
    const resolvedIdentity = asObject<Record<string, unknown>>(resolved.identity);
    const resolvedTerminal = asObject<Record<string, unknown>>(resolved.terminal);
    const camelRole = asObject<Record<string, unknown>>(incomingConfig.deviceRole);
    const snakeRole = asObject<Record<string, unknown>>(incomingConfig.device_role);
    const resolvedCamelRole = asObject<Record<string, unknown>>(resolved.deviceRole);
    const resolvedSnakeRole = asObject<Record<string, unknown>>(resolved.device_role);
    const roleValue = resolveDeviceRoleValue([
        camelRole.role,
        camelRole.device_role,
        camelRole.deviceRole,
        camelRole.role_code,
        camelRole.device_role_code,
        snakeRole.role,
        snakeRole.device_role,
        snakeRole.deviceRole,
        snakeRole.role_code,
        snakeRole.device_role_code,
        incomingConfig.deviceRole,
        incomingConfig.device_role,
        incomingConfig.terminalType,
        incomingConfig.terminal_type,
        incomingConfig.deviceType,
        incomingConfig.device_type,
        resolvedCamelRole.role,
        resolvedCamelRole.device_role,
        resolvedCamelRole.deviceRole,
        resolvedCamelRole.role_code,
        resolvedCamelRole.device_role_code,
        resolvedSnakeRole.role,
        resolvedSnakeRole.device_role,
        resolvedSnakeRole.deviceRole,
        resolvedSnakeRole.role_code,
        resolvedSnakeRole.device_role_code,
        resolvedIdentity.deviceRole,
        resolvedIdentity.device_role,
        resolvedIdentity.role_code,
        resolvedIdentity.device_role_code,
        resolvedTerminal.deviceRole,
        resolvedTerminal.device_role,
        resolvedTerminal.terminalType,
        resolvedTerminal.terminal_type,
        resolvedTerminal.deviceType,
        resolvedTerminal.device_type,
        resolvedTerminal.role_code,
        resolvedTerminal.device_role_code,
        snapshot.deviceRole,
        snapshot.device_role,
        snapshot.role_code,
        snapshot.device_role_code,
        resolved.deviceRole,
        resolved.device_role,
        resolved.terminalType,
        resolved.terminal_type,
        resolved.deviceType,
        resolved.device_type,
        resolved.role_code,
        resolved.device_role_code,
        incomingConfig.device_role_code,
        resolvedIdentity.role,
        resolvedTerminal.role,
        snapshot.role,
        resolved.role,
        incomingConfig.role,
    ]);

    return {
        ...resolvedCamelRole,
        ...resolvedSnakeRole,
        ...camelRole,
        ...snakeRole,
        ...(roleValue ? { role: roleValue } : {}),
    };
};

const buildCompatibleInventoryScope = (
    currentInventoryScope: TerminalConfig['inventoryScope'],
    resolvedInventory: Record<string, unknown>
): TerminalConfig['inventoryScope'] => {
    const warehouses = Array.isArray(resolvedInventory.warehouses)
        ? resolvedInventory.warehouses as Array<Record<string, unknown>>
        : [];
    const visibleWarehouseIds = Array.from(
        new Set(
            warehouses
                .map((warehouse) => normalizeOptional(String(warehouse?.id || '')))
                .filter(Boolean)
        )
    );
    const defaultSalesWarehouseId = normalizeOptional(
        String(
            resolvedInventory.default_warehouse_id
            || asObject<Record<string, unknown>>(resolvedInventory.default_warehouse).id
            || ''
        )
    );

    if (!defaultSalesWarehouseId && visibleWarehouseIds.length === 0) {
        return {
            defaultSalesWarehouseId: '',
            visibleWarehouseIds: [],
        };
    }

    return {
        defaultSalesWarehouseId: defaultSalesWarehouseId || visibleWarehouseIds[0] || '',
        visibleWarehouseIds,
    };
};

const applyErpConfigPushToLocalTerminal = async ({
    deviceId,
    fallbackTerminalId,
    payload,
}: {
    deviceId: string;
    fallbackTerminalId?: string | null;
    payload: Record<string, unknown>;
}): Promise<boolean> => {
    const snapshot = asObject<SyncTerminalSnapshot>(payload.terminal_config);
    const snapshotRecord = snapshot as unknown as Record<string, unknown>;
    const incomingConfig = asObject<Record<string, unknown>>(snapshot.config);
    const incomingMasters = asObject<Record<string, unknown>>(snapshot.masters);
    const incomingResolved = asObject<Record<string, unknown>>(snapshot.resolved);
    const incomingIdentity = asObject<Record<string, unknown>>(incomingResolved.identity);
    const incomingTerminal = asObject<Record<string, unknown>>(incomingResolved.terminal);

    if (
        !snapshot.terminal_id &&
        Object.keys(incomingIdentity).length === 0 &&
        Object.keys(incomingTerminal).length === 0 &&
        Object.keys(incomingConfig).length === 0 &&
        Object.keys(incomingMasters).length === 0 &&
        Object.keys(incomingResolved).length === 0
    ) {
        return false;
    }

    const localConfigRaw = await db.get('config');
    if (!localConfigRaw || Array.isArray(localConfigRaw)) {
        return false;
    }

    const localConfig = localConfigRaw as BusinessConfig;
    if (!Array.isArray(localConfig.terminals)) {
        return false;
    }

    const resolvedTerminalId = normalizeOptional(String(
        snapshot.terminal_id ||
        incomingIdentity.terminal_id ||
        incomingIdentity.id ||
        incomingTerminal.terminal_id ||
        incomingTerminal.id ||
        fallbackTerminalId ||
        ''
    ));
    const resolvedDeviceId = normalizeOptional(String(
        snapshot.device_id ||
        incomingIdentity.device_id ||
        incomingTerminal.device_id ||
        incomingConfig.device_id ||
        ''
    ));
    const exactTargetIndex = localConfig.terminals.findIndex((terminal) =>
        (resolvedTerminalId && terminal.id === resolvedTerminalId)
        || (resolvedTerminalId && terminal.config?.erpTerminalId === resolvedTerminalId)
        || (resolvedTerminalId && terminal.config?.erpBinding?.terminalId === resolvedTerminalId)
    );
    const canFallbackToDevice = !resolvedTerminalId || !resolvedDeviceId || resolvedDeviceId === deviceId;
    const deviceTargetIndex = canFallbackToDevice
        ? localConfig.terminals.findIndex((terminal) => terminal.config?.currentDeviceId === deviceId)
        : -1;
    const targetIndex = exactTargetIndex !== -1 ? exactTargetIndex : deviceTargetIndex;

    if (targetIndex === -1) {
        return false;
    }

    const targetTerminal = localConfig.terminals[targetIndex];
    const localTerminalId = targetTerminal.id || resolvedTerminalId || fallbackTerminalId || '';
    const currentConfig: TerminalConfig = targetTerminal.config || ({} as TerminalConfig);
    const incomingOperational = asObject<Record<string, unknown>>(incomingConfig.operational);
    const incomingCatalog = asObject<Record<string, unknown>>(incomingConfig.catalog);
    const incomingPricing = asObject<Record<string, unknown>>(incomingConfig.pricing);
    const incomingDocuments = asObject<Record<string, unknown>>(incomingConfig.documents);
    const incomingDeviceRole = buildIncomingConfigPushDeviceRole(snapshotRecord, incomingConfig);
    const resolvedSnapshot = asObject<Record<string, unknown>>(snapshot.resolved);
    const resolvedInventory = asObject<Record<string, unknown>>(resolvedSnapshot.inventory);
    const allowedCategories = Array.isArray(incomingCatalog.allowedCategories)
        ? asStringList(incomingCatalog.allowedCategories)
        : [];
    const allowedTariffIds = Array.isArray(incomingPricing.allowedTariffIds)
        ? asStringList(incomingPricing.allowedTariffIds)
        : [];
    const defaultTariffId = normalizeOptional(
        String(incomingPricing.defaultTariffId || '')
    );
    const incomingAssignments = asObject<Record<string, string>>(incomingDocuments.assignments);
    const nextOperational = {
        ...(currentConfig.operational || {}),
        ...incomingOperational,
    } as TerminalConfig['operational'];
    const nextCatalog = {
        ...(currentConfig.catalog || {}),
        ...incomingCatalog,
        allowedCategories,
    } as NonNullable<TerminalConfig['catalog']>;
    const nextPricing = {
        ...(currentConfig.pricing || {}),
        ...incomingPricing,
        allowedTariffIds,
        defaultTariffId,
    } as TerminalConfig['pricing'];
    const nextDocumentAssignments = {
        ...DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS,
        ...(currentConfig.documentAssignments || {}),
        ...incomingAssignments,
    } as NonNullable<TerminalConfig['documentAssignments']>;
    const existingSnapshot =
        currentConfig.erpSnapshot ||
        (localTerminalId ? localConfig.terminalSnapshots?.[localTerminalId] : null) ||
        (resolvedTerminalId ? localConfig.terminalSnapshots?.[resolvedTerminalId] : null) ||
        null;
    const nextErpSnapshot = mergeTerminalConfigSnapshots(
        existingSnapshot,
        snapshot as TerminalConfigSnapshot
    ) || (snapshot as TerminalConfigSnapshot);
    const terminalTypeContract = resolveOrderTakerContract({
        ...incomingConfig,
        ...incomingResolved,
        ...incomingIdentity,
        ...incomingTerminal,
        terminalType: incomingDeviceRole.role,
        config: {
            ...incomingConfig,
            ...incomingResolved,
            ...incomingIdentity,
            ...incomingTerminal,
        },
    });
    const deviceProfileContract = toDeviceProfileContract(resolveDeviceProfile([
        incomingTerminal.deviceProfile,
        incomingTerminal.device_profile,
        incomingIdentity.deviceProfile,
        incomingIdentity.device_profile,
        incomingResolved.deviceProfile,
        incomingResolved.device_profile,
        incomingConfig.deviceProfile,
        incomingConfig.device_profile,
        currentConfig.deviceProfile,
        currentConfig.device_profile,
    ], resolveDeviceRole(incomingDeviceRole.role)));
    const nextTerminalConfig: TerminalConfig = {
        ...currentConfig,
        ...deviceProfileContract,
        terminalType: String(incomingDeviceRole.role || terminalTypeContract.terminalType),
        terminal_type: String(incomingDeviceRole.role || terminalTypeContract.terminalType),
        masterTerminalId: terminalTypeContract.masterTerminalId || currentConfig.masterTerminalId,
        master_terminal_id: terminalTypeContract.masterTerminalId || currentConfig.master_terminal_id,
        capabilities: terminalTypeContract.capabilities.length > 0
            ? terminalTypeContract.capabilities
            : currentConfig.capabilities,
        restrictions: terminalTypeContract.restrictions.length > 0
            ? terminalTypeContract.restrictions
            : currentConfig.restrictions,
        deviceRole: buildCompatibleDeviceRoleConfig(currentConfig.deviceRole, incomingDeviceRole),
        operational: nextOperational,
        catalog: nextCatalog,
        pricing: nextPricing,
        documentAssignments: nextDocumentAssignments,
        inventoryScope: buildCompatibleInventoryScope(currentConfig.inventoryScope, resolvedInventory),
        erpBinding: {
            ...(currentConfig.erpBinding || {}),
            terminalId: normalizeOptional(snapshot.terminal_id || currentConfig.erpBinding?.terminalId || null) || undefined,
            terminalName:
                normalizeOptional(snapshot.terminal_name || currentConfig.erpBinding?.terminalName || null) ||
                currentConfig.terminalName ||
                localTerminalId ||
                undefined,
            deviceId: normalizeOptional(snapshot.device_id || currentConfig.erpBinding?.deviceId || deviceId || null) || undefined,
            role:
                normalizeOptional(
                    String(
                        snapshot.role ||
                        snapshotRecord.device_role ||
                        snapshotRecord.role_code ||
                        snapshotRecord.device_role_code ||
                        incomingIdentity.role ||
                        incomingIdentity.device_role ||
                        incomingIdentity.deviceRole ||
                        incomingIdentity.role_code ||
                        incomingIdentity.device_role_code ||
                        incomingTerminal.role ||
                        incomingTerminal.device_role ||
                        incomingTerminal.deviceRole ||
                        incomingTerminal.role_code ||
                        incomingTerminal.device_role_code ||
                        incomingResolved.role ||
                        incomingResolved.device_role ||
                        incomingResolved.deviceRole ||
                        incomingResolved.role_code ||
                        incomingResolved.device_role_code ||
                        incomingDeviceRole.role ||
                        currentConfig.erpBinding?.role ||
                        ''
                    )
                ) || undefined,
        },
        erpSnapshot: nextErpSnapshot,
    };

    const nextTerminals = localConfig.terminals.map((terminal, index) => {
        if (index !== targetIndex) {
            return terminal;
        }

        return {
            ...terminal,
            id: terminal.id || resolvedTerminalId,
            config: nextTerminalConfig,
        };
    });

    const terminalSnapshots = {
        ...(localConfig.terminalSnapshots || {}),
        ...(localTerminalId ? { [localTerminalId]: nextErpSnapshot } : {}),
        ...(resolvedTerminalId ? { [resolvedTerminalId]: nextErpSnapshot } : {}),
    };

    const nextConfig: BusinessConfig = {
        ...localConfig,
        terminals: nextTerminals,
        terminalSnapshots,
    };

    console.info('[ERP SYNC] CONFIG_PUSH terminal role applied', {
        localTerminalId,
        erpTerminalId: resolvedTerminalId || null,
        currentDeviceId: deviceId,
        incomingRole: incomingDeviceRole.role || null,
        appliedRole: nextTerminalConfig.deviceRole?.role || null,
    });

    await db.save('config', nextConfig);
    window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfig }));

    return true;
};

const pullErpOutbox = async (bindingTerminalId: string | null, deviceId: string): Promise<SyncOutboxPullResponse | null> => {
    if (!isConfigured()) return null;
    if (!bindingTerminalId && !deviceId) return null;

    const binding = getStoredErpSyncBinding();
    return getJson<SyncOutboxPullResponse>('/outbox/pull', {
        tenant_id: binding.tenantId || undefined,
        terminal_id: bindingTerminalId || undefined,
        device_id: deviceId || undefined,
        limit: 20,
    });
};

const ackErpOutboxEvent = async (
    outboxId: string,
    status: 'APPLIED' | 'FAILED',
    errorDetail?: string
): Promise<SyncOutboxAckResponse | null> => {
    if (!outboxId) return null;

    const startedAt = Date.now();
    configPushV2Log('OUTBOX_ACK_STARTED', {
        outbox_id: outboxId,
        status,
    });
    try {
        const binding = getStoredErpSyncBinding();
        const deviceId = resolveLocalDeviceId();
        const response = await postJson<SyncOutboxAckResponse>('/outbox/ack', {
            outbox_id: outboxId,
            status,
            error_detail: errorDetail || null,
            tenant_id: binding.tenantId || null,
            terminal_id: binding.terminalId || null,
            device_id: deviceId || null,
        });
        configPushV2Log('OUTBOX_ACK_COMPLETED', {
            outbox_id: outboxId,
            status,
            http_status: 200,
            duration_ms: Date.now() - startedAt,
        });
        authenticatedActivityTracker.record('ACK');
        syncMetrics.increment('ack_total');
        syncMetrics.markAckFinished();
        return response;
    } catch (error) {
        const requestError = error as SyncRequestError;
        if (!requestError.status || requestError.status >= 500) {
            requestError.retryable = true;
        }
        configPushV2Log('OUTBOX_ACK_FAILED', {
            outbox_id: outboxId,
            status,
            http_status: requestError.status || 0,
            duration_ms: Date.now() - startedAt,
            error: compactErrorDetail(error),
        });
        throw error;
    }
};

export const clearStoredErpSyncBinding = () => {
    localStorage.removeItem(SYNC_BINDING_TENANT_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_UUID_KEY);
    localStorage.removeItem(SYNC_BINDING_LOCAL_TERMINAL_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_NAME_KEY);
    localStorage.removeItem(SYNC_BINDING_COMPANY_KEY);
    localStorage.removeItem(SYNC_BINDING_STORE_KEY);
    localStorage.removeItem(SYNC_BINDING_LAST_SEEN_KEY);
    localStorage.removeItem(SYNC_BINDING_STATUS_KEY);
};

export const getStoredErpSyncBinding = () => ({
    tenantId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY)) || null,
    terminalId: normalizeCanonicalErpTerminalId(localStorage.getItem(SYNC_BINDING_TERMINAL_KEY)),
    terminalUuid: normalizeCanonicalErpTerminalId(localStorage.getItem(SYNC_BINDING_TERMINAL_UUID_KEY)),
    localTerminalId: normalizeOptional(localStorage.getItem(SYNC_BINDING_LOCAL_TERMINAL_KEY)) || null,
    terminalName: normalizeOptional(localStorage.getItem(SYNC_BINDING_TERMINAL_NAME_KEY)) || null,
    companyId: normalizeOptional(localStorage.getItem(SYNC_BINDING_COMPANY_KEY)) || null,
    storeId: normalizeOptional(localStorage.getItem(SYNC_BINDING_STORE_KEY)) || null,
    lastSeen: normalizeOptional(localStorage.getItem(SYNC_BINDING_LAST_SEEN_KEY)) || null,
    status: normalizeOptional(localStorage.getItem(SYNC_BINDING_STATUS_KEY)) || null,
});

export const bootstrapErpSyncLifecycle = async (
    deviceId: string,
    terminalId?: string | null,
): Promise<SyncBootstrapResponse | null> => {
    if (!isConfigured() || !deviceId) return null;

    const identity = getStoredTenantIdentity();
    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) {
        return null;
    }

    clearBindingIfTenantChanged(identity);

    const payload = await postJson<SyncBootstrapResponse>('/bootstrap/check', {
        tenant_id: identity.tenantId || null,
        company_ref: identity.tenantSlug || null,
        email: identity.tenantEmail || null,
        device_id: deviceId,
        terminal_id: resolveCanonicalErpTerminalId(terminalId) || undefined,
        erp_terminal_id: resolveCanonicalErpTerminalId(terminalId) || undefined,
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal, identity);
    }

    return payload;
};

export const registerErpSyncTerminal = async (params: EnsureLifecycleParams): Promise<SyncRegisterResponse | null> => {
    if (!isConfigured() || !params.deviceId) return null;

    const identity = getStoredTenantIdentity();
    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) {
        return null;
    }

    clearBindingIfTenantChanged(identity);

	    const runtimeTelemetry = await resolveRuntimeTelemetry();
	    const storedBinding = getStoredErpSyncBinding();
	    const syncCapabilities = getSyncCapabilities();
        const existingCanonicalTerminalId = resolveCanonicalErpTerminalId(
            params.terminalId,
            storedBinding.terminalId,
            storedBinding.terminalUuid,
        );

	    const payload = await postJson<SyncRegisterResponse>('/terminals/register', {
	        device_id: params.deviceId,
        terminal_id: existingCanonicalTerminalId || undefined,
        erp_terminal_id: existingCanonicalTerminalId || undefined,
        tenant_id: identity.tenantId || null,
        company_ref: identity.tenantSlug || null,
        company_id: params.companyId || storedBinding.companyId || null,
        store_id: params.storeId || storedBinding.storeId || null,
        name: params.terminalName || params.localTerminalId || params.terminalId,
	        app_version: runtimeTelemetry.appVersion || null,
	        ip_address: runtimeTelemetry.ipAddress || null,
        sync_capabilities: syncCapabilities,
        capabilities: syncCapabilities,
	        capability_versions: POS_SYNC_CAPABILITY_VERSIONS,
	        metadata: {
	            source: 'CLIC_POS_APK',
            terminal_id: existingCanonicalTerminalId || undefined,
            erp_terminal_id: existingCanonicalTerminalId || undefined,
            terminal_code: params.localTerminalId || null,
            station_number: params.localTerminalId || null,
            terminal_name: params.terminalName || params.localTerminalId || params.terminalId,
            is_primary: params.isPrimary ?? true,
        },
    });

    const resolvedTerminalId = resolveCanonicalErpTerminalId(payload);
    if (!resolvedTerminalId) {
        throw new CanonicalErpTerminalIdError();
    }

    if (payload?.terminal) {
        persistBinding(payload.terminal, identity, {
            localTerminalId: params.localTerminalId || storedBinding.localTerminalId || null,
            terminalName: params.terminalName || storedBinding.terminalName || null,
        });
    }

    const registerAuth = extractErpRegisterAuth(payload);
    const deviceToken = resolveNormalizedRegisterDeviceToken(payload, registerAuth);
    if (deviceToken) {
        persistSyncDeviceToken(deviceToken, 'ERP_REGISTER', registerAuth.tokenExpiresAt);
    }
    if (registerAuth.syncToken) {
        localStorage.setItem('clic_erp_sync_token', registerAuth.syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        if (registerAuth.tokenExpiresAt) {
            localStorage.setItem('clic_erp_sync_token_expires_at', registerAuth.tokenExpiresAt);
        }
    }
    if (deviceToken || registerAuth.syncToken) {
        saveTerminalCredentialsSync({
            terminalId: resolvedTerminalId,
            erpTerminalId: resolvedTerminalId,
            deviceId: params.deviceId,
            tenantId: identity.tenantId || null,
            erpTenantId: identity.tenantId || null,
            cloudAdminTenantId: identity.tenantId || null,
            ...(deviceToken ? {
                deviceToken,
                deviceTokenSource: 'ERP_REGISTER',
                deviceTokenUpdatedAt: new Date().toISOString(),
                deviceTokenExpiresAt: registerAuth.tokenExpiresAt || null,
            } : {}),
            ...(registerAuth.syncToken ? {
                syncToken: registerAuth.syncToken,
                syncTokenUpdatedAt: new Date().toISOString(),
                syncTokenExpiresAt: registerAuth.tokenExpiresAt || null,
            } : {}),
        });
    }

    return payload;
};

export const heartbeatErpSyncTerminal = (
    params: EnsureLifecycleParams,
    fallbackDeviceId?: string
): Promise<SyncHeartbeatResponse | null> => {
    if (!isConfigured()) return Promise.resolve(null);
    if (heartbeatRequestPromise) return heartbeatRequestPromise;

    const operation = (async () => {
	    const runtimeTelemetry = await resolveRuntimeTelemetry();
	    const storedBinding = getStoredErpSyncBinding();
	    const resolvedDeviceId = params.deviceId || fallbackDeviceId || resolveLocalDeviceId();
	    const terminalRef = resolveCanonicalErpTerminalId(
            storedBinding.terminalId,
            storedBinding.terminalUuid,
            params.terminalId,
        ) || null;
	    const syncCapabilities = getSyncCapabilities();

        if (!terminalRef) {
            return null;
        }

	    let payload: SyncHeartbeatResponse;
	    try {
	        payload = await postJson<SyncHeartbeatResponse>('/terminals/heartbeat', {
	            tenant_id: storedBinding.tenantId || undefined,
	            company_id: storedBinding.companyId || params.companyId || undefined,
	            store_id: storedBinding.storeId || params.storeId || undefined,
	            terminal_id: terminalRef || undefined,
	            device_id: resolvedDeviceId || undefined,
	            app_version: runtimeTelemetry.appVersion || null,
	            ip_address: runtimeTelemetry.ipAddress || null,
	            pending_events: Math.max(params.pendingEvents || 0, getConfigPushV2PendingEventCount()),
            sync_capabilities: syncCapabilities,
            capabilities: syncCapabilities,
	            capability_versions: POS_SYNC_CAPABILITY_VERSIONS,
	        });
	    } catch (error) {
	        if (isDeviceSupersededError(error)) {
	            dispatchDeviceRevoked({
	                reason: 'DEVICE_SUPERSEDED',
	                message: getLifecycleBlockingMessageFromError(error) || DEVICE_SUPERSEDED_MESSAGE,
	                terminalId: terminalRef || params.terminalId,
	                previousDeviceId: resolvedDeviceId || params.deviceId,
	                payload: (error as SyncRequestError)?.payload || null,
	            });
	        }
	        throw error;
	    }

        if (payload?.terminal) {
            persistBinding(payload.terminal, undefined, {
                localTerminalId: params.localTerminalId || storedBinding.localTerminalId || null,
                terminalName: params.terminalName || storedBinding.terminalName || null,
            });
        }

        return payload;
    })();

    const trackedOperation = operation.finally(() => {
        if (heartbeatRequestPromise === trackedOperation) {
            heartbeatRequestPromise = null;
        }
    });
    heartbeatRequestPromise = trackedOperation;
    return trackedOperation;
};

export const processErpSyncOutbox = async (
    params: Pick<EnsureLifecycleParams, 'deviceId' | 'terminalId' | 'localTerminalId' | 'terminalName'>
): Promise<{ processed: number; applied: number; failed: number } | null> => {
    if (!isConfigured() || !params.deviceId) return null;

    if (outboxProcessingPromise) {
        return outboxProcessingPromise;
    }

    outboxProcessingPromise = (async () => {
        const startedAt = Date.now();
        const binding = getStoredErpSyncBinding();
        configPushV2Log('OUTBOX_PULL_STARTED', {
            tenant_id: binding.tenantId || null,
            terminal_id: binding.terminalId || params.terminalId || null,
            local_terminal_id: binding.localTerminalId || params.localTerminalId || null,
            device_id: params.deviceId,
        });
        let outbox: SyncOutboxPullResponse | null = null;
        try {
            outbox = await pullErpOutbox(binding.terminalId, params.deviceId);
        } catch (error) {
            const requestError = error as SyncRequestError;
            configPushV2Log('OUTBOX_PULL_COMPLETED', {
                terminal_id: binding.terminalId || params.terminalId || null,
                status: 'FAILED',
                http_status: requestError.status || 0,
                duration_ms: Date.now() - startedAt,
                error: compactErrorDetail(error),
            });
            throw error;
        }
        const events = Array.isArray(outbox?.events) ? outbox.events : [];

        configPushV2Log('OUTBOX_PULL_COMPLETED', {
            terminal_id: binding.terminalId || params.terminalId || null,
            status: 'COMPLETED',
            http_status: 200,
            count: events.length,
            duration_ms: Date.now() - startedAt,
        });

        if (events.length === 0) {
            return { processed: 0, applied: 0, failed: 0 };
        }

        let applied = 0;
        let failed = 0;

	        for (const event of events) {
	            const eventType = normalizeOptional(event.event_type || null).toUpperCase();
	            const eventPayload = asObject<ConfigPushV2Payload>(event.payload);
	            configPushV2Log('OUTBOX_EVENT_RECEIVED', {
	                outbox_id: event.id,
	                event_type: eventType || 'UNKNOWN',
	                snapshot_id: eventPayload.snapshot_id || null,
	                scopes: normalizeConfigPushV2Scopes(eventPayload.scopes),
	                status: event.status || null,
	            });

	            try {
	                if (eventType === 'CONFIG_PUSH_V2') {
	                    const result = await processConfigPushV2Event(event, params, binding);
	                    if (result === 'APPLIED') {
	                        applied += 1;
	                    }
	                    continue;
	                }

	                if (eventType === 'CONFIG_PUSH') {
	                    const payload = asObject<Record<string, unknown>>(event.payload);
	                    const appliedLocally = await applyErpConfigPushToLocalTerminal({
                        deviceId: params.deviceId,
                        fallbackTerminalId: binding.terminalId || params.terminalId,
                        payload,
                    });

                    console.info(
                        appliedLocally
                            ? '[ERP SYNC] CONFIG_PUSH aplicado localmente y se marca reinicio requerido.'
                            : '[ERP SYNC] CONFIG_PUSH recibido sin cambios locales aplicables. Se marca reinicio requerido.'
                    );
                    persistPendingTerminalConfigSnapshot(event);
                    persistTerminalConfigRestartNotice(event);
                    syncMetrics.markApplyFinished();
                    await ackErpOutboxEvent(event.id, 'APPLIED');
                    applied += 1;
                    continue;
                }

                await ackErpOutboxEvent(event.id, 'FAILED', `Evento no soportado por el POS: ${eventType || 'UNKNOWN'}`);
	                failed += 1;
	            } catch (error: any) {
	                console.warn(`[ERP SYNC] Error procesando ${eventType || 'UNKNOWN'}:`, error);
	                if (eventType === 'CONFIG_PUSH_V2') {
	                    configPushV2Log('CONFIG_PUSH_V2_APPLY_FAILED', {
	                        outbox_id: event.id,
	                        event_type: eventType,
	                        snapshot_id: eventPayload.snapshot_id || null,
	                        scopes: normalizeConfigPushV2Scopes(eventPayload.scopes),
	                        status: error?.retryable ? 'RETRY' : 'FAILED',
	                        error: compactErrorDetail(error),
	                    });
	                }
	                if (error?.retryable) {
	                    continue;
	                }
	                await ackErpOutboxEvent(event.id, 'FAILED', error?.message || 'Error procesando evento ERP outbox');
	                if (eventType === 'CONFIG_PUSH_V2') {
	                    clearConfigPushV2InFlight();
	                }
	                failed += 1;
	            }
        }

        return {
            processed: events.length,
            applied,
            failed,
        };
    })();

    try {
        return await outboxProcessingPromise;
    } finally {
        outboxProcessingPromise = null;
    }
};

export const triggerErpSyncOutbox = async (
    reason: 'manual_sync' | 'force_sync' | 'connection_restored' | 'app_resumed' | 'online' | 'periodic' | 'startup'
): Promise<{ processed: number; applied: number; failed: number } | null> => {
    const binding = getStoredErpSyncBinding();
    const deviceId = resolveLocalDeviceId();
    if (!deviceId) return null;

    configPushV2Log('OUTBOX_TRIGGERED', {
        reason,
        tenant_id: binding.tenantId,
        terminal_id: binding.terminalId,
        local_terminal_id: binding.localTerminalId,
        device_id: deviceId,
    });
    return processErpSyncOutbox({
        deviceId,
        terminalId: binding.terminalId || binding.localTerminalId || '',
        localTerminalId: binding.localTerminalId,
        terminalName: binding.terminalName,
    });
};

export const ensureErpSyncLifecycle = async (params: EnsureLifecycleParams): Promise<{
    bootstrap?: SyncBootstrapResponse | null;
    registered?: SyncRegisterResponse | null;
    heartbeat?: SyncHeartbeatResponse | null;
    outbox?: { processed: number; applied: number; failed: number } | null;
} | null> => {
    if (!isConfigured()) return null;

    const storedBinding = getStoredErpSyncBinding();
    const bootstrap = storedBinding.terminalId ? null : await bootstrapErpSyncLifecycle(params.deviceId);
    const activation = bootstrap?.activation;

    if (activation && activation.erp_enabled === false) {
        return { bootstrap, registered: null, heartbeat: null };
    }

    let registered: SyncRegisterResponse | null = null;

    if (!storedBinding.terminalId) {
        registered = await registerErpSyncTerminal({
            ...params,
            companyId: params.companyId || storedBinding.companyId,
            storeId: params.storeId || storedBinding.storeId,
        });
    }

    let heartbeat: SyncHeartbeatResponse | null = null;

    try {
        heartbeat = await heartbeatErpSyncTerminal(params, params.deviceId);
    } catch (error) {
        if (isDeviceSupersededError(error)) {
            throw error;
        }

        if (!shouldRecoverErpBinding(error)) {
            throw error;
        }

        console.warn('[ERP SYNC] binding obsoleto detectado, reintentando registro de terminal.', error);
        const rebound = await recoverErpSyncBinding({
            ...params,
            companyId: params.companyId || storedBinding.companyId,
            storeId: params.storeId || storedBinding.storeId,
        });

        heartbeat = rebound.heartbeat;
        registered = rebound.registered || registered;
    }

    const outbox = await processErpSyncOutbox(params);

    return { bootstrap, registered, heartbeat, outbox };
};

/**
 * POST genérico al canal de sincronización del ERP (`{base}/api/sync/<path>`).
 *
 * Es el mismo canal que usan `/inbox`, `/bootstrap` y `/terminals`: sin `x-role-id`,
 * con el contexto de la terminal (tenant, empresa, sucursal, binding y device) en el
 * cuerpo. Existe para que la fidelización (EGO Club) viaje por aquí y no por
 * `/api/settings/crm/loyalty/*`, que exige RBAC.
 *
 * Devuelve `null` si el canal no está configurado (POS aún sin vincular): en ese
 * caso la operación debe quedarse en la cola local, no perderse.
 */
export const postErpSyncJson = async <T>(
    path: string,
    body: Record<string, unknown> = {},
): Promise<T | null> => {
    if (!isConfigured()) return null;

    const identity = getStoredTenantIdentity();
    const binding = getStoredErpSyncBinding();

    return postJson<T>(path, {
        ...body,
        tenant_id: identity.tenantId || binding.tenantId || null,
        company_ref: identity.tenantSlug || null,
        company_id: binding.companyId || null,
        store_id: binding.storeId || null,
        terminal_binding_id: binding.terminalId || null,
        device_id: resolveLocalDeviceId() || null,
    });
};
