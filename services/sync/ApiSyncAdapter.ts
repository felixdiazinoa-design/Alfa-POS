import { isSyncFeatureEnabled } from './SyncFeatureFlags';
import { originalProvenance } from '../recovery/RecoveryRuntime';
import { isRecoveredOperation } from '../recovery/PendingOperationsRecovery';
import { readErpPaymentMethodsSnapshot } from '../../utils/erpPaymentMethods';
import { Product } from '../../types';
import {
    buildErpCashMovementPayload,
    buildErpInventoryLedgerPayload,
    buildErpLoyaltyEventPayload,
    buildErpSalePayload,
    buildErpWalletEventPayload,
    buildErpZReportPayload
} from './erpOutboundPayloads';
import { permissionService } from './PermissionService';
import { getSyncDeviceToken, markSyncDeviceTokenInvalid, persistSyncDeviceToken, previewSyncDeviceToken, resolveSyncDeviceToken } from './deviceToken';
import { DEVICE_SUPERSEDED_MESSAGE, dispatchDeviceRevoked, resolveLocalDeviceId, resolveOrCreateLocalDeviceId } from '../../utils/deviceRevocation';
import {
    getSyncProfileSourcePriority,
    loadSyncProfile,
    resolveSyncTarget,
    ResolvedSyncTarget,
    isPosOnlyCloudStagingTarget,
} from './SyncProfile';
import { isPosCloudStagingPushCollection } from './PosCloudStagingService';
import { looksLikeUuidString } from '../../utils/documentSeriesIdentity';
import {
    reportSyncErrorDiagnostic,
    setCatalogDiagnosticStatus,
    setSalesPushDiagnosticStatus,
    setSyncAuthDiagnosticStatus,
    setTerminalBindingDiagnosticStatus,
    type SyncDiagnosticOperation,
    type SyncFetchDiagnostic,
} from './SyncErrorDiagnostic';
import { requestJson } from '../network/httpClient';
import {
    buildTerminalSyncAuthHeaders,
    clearStoredSyncToken,
    readTerminalCredentialsSync,
    saveTerminalCredentialsSync,
} from './TerminalCredentialStore';
import { extractErpRegisterAuth } from './erpRegisterResponse';
import { isLoopbackHost, isNativeAndroidRuntime } from '../../utils/erpBaseUrl';
import { getSupportsBatchInbox, logErpIdentity, markBatchInboxUnavailable } from '../../utils/erpCapabilities';
import { toErpInboxEvent } from '../../utils/erpSyncContract';
import {
    clearErpIncrementalSyncState,
    erpSyncAuthRequiresFullBootstrap,
    markErpFullBootstrapRequired,
    persistErpSyncAuthIdentity,
} from '../../utils/erpSyncLifecycle';
import {
    ERP_CRITICAL_MASTER_COLLECTIONS,
    ERP_SUPPORTED_MASTER_COLLECTIONS,
} from './ErpMasterSyncContract';
import { assertOperationalAcknowledgement } from './operationalAcknowledgement';
import { assertCustomerNumberAcknowledgement, buildCustomerMutationEnvelope } from './customerIdentityContract';
import {
    POS_SYNC_CAPABILITY_VERSIONS,
    VARIANT_PROMOTIONS_CAPABILITY,
} from '../../utils/syncCapabilities';
import { classifyMasterPullFailure } from './masterPullFailure';
import { isTerminalAuthorizationSuperseded } from '../../utils/terminalAuthorizationGuard';

/**
 * API Sync Adapter
 * 
 * Synchronization adapter that uses REST API to communicate with the Master terminal.
 * Replaces the localStorage-based LocalSyncAdapter with a modern HTTP-based approach.
 */

export interface SyncChange {
    collection: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'BULK_UPDATE';
    items: any[];
    timestamp: string;
    sourceTerminalId: string;
    version: number;
}

export interface SyncMetadata {
    collection: string;
    lastSyncedAt: string;
    version: number;
    itemCount: number;
    fullSyncVersion?: number;
}

interface PullDeltaOptions {
    cursor?: string | null;
    limit?: number;
}

interface PullDeltaResult {
    items: any[];
    serverTime: string;
    isFullDownload: boolean;
    latestVersion?: number;
    syncStatus?: 'SYNCED_WITH_FULL_FALLBACK';
    cursor?: string | null;
    nextCursor?: string | null;
    lastSyncedAt?: string | null;
    hasMore?: boolean;
}

export interface ProductImageManifestItem {
    id: string;
    hash: string;
    hasImage: boolean;
    updatedAt: string | null;
}

export interface ProductImagePayloadItem {
    id: string;
    image: string | null;
    images: string[];
    hash: string;
    updatedAt: string | null;
}

interface SyncConfig {
    masterUrl: string;
    terminalId: string;
    autoRetry: boolean;
    retryDelayMs: number;
}

interface TerminalInventoryBalancePayload {
    item_id?: string | null;
    product_id?: string | null;
    id?: string | null;
    warehouse_id?: string | null;
    qty_on_hand?: number | null;
    qty_reserved?: number | null;
    qty_committed?: number | null;
    updated_at?: string | null;
}

interface TerminalInventoryPayload {
    cursor?: string | null;
    balances?: TerminalInventoryBalancePayload[];
    has_changes?: boolean;
    inventory?: {
        cursor?: string | null;
        balances?: TerminalInventoryBalancePayload[];
        has_changes?: boolean;
    };
}

type CircuitBreakerChannel = 'sales' | 'background';
type OperationalSyncOperation = Exclude<SyncDiagnosticOperation, 'REGISTER_TERMINAL'>;

const ERP_TEMPORARILY_UNAVAILABLE_ERROR = 'ERP temporalmente no disponible';
const ERP_SYNC_TOKEN_KEYS = [
    'clic_erp_sync_token',
    'clic_erp_sync_auth_token',
    'CLIC_ERP_SYNC_TOKEN',
    'syncAuthToken',
    'sync_auth_token',
    'erp_sync_token',
];
const ERP_SYNC_TOKEN_EXPIRES_AT_KEY = 'clic_erp_sync_token_expires_at';
const ERP_SYNC_TOKEN_UPDATED_AT_KEY = 'clic_erp_sync_token_updated_at';
const ERP_MASTER_PULL_COLLECTIONS = ERP_SUPPORTED_MASTER_COLLECTIONS;
const ERP_RUNTIME_UNSUPPORTED_MASTER_COLLECTIONS = new Set<string>();
const ERP_UNSUPPORTED_WARNING_COLLECTIONS = new Set<string>();
const ERP_OPERATION_PUSH_COLLECTIONS = new Set([
    'transactions',
    'payments',
    'cashClosures',
    'cashOpenings',
    'zReports',
    'cashMovements',
    'cashDrawerEvents',
    'inventoryLedger',
    'inventoryMovements',
    'transfers',
    'receptions',
    'returns',
    'creditNotes',
    'promotionRedemptions',
    'couponRedemptions',
    'loyaltyPointMovements',
    'loyaltyPointAccruals',
    'loyaltyPointRedemptions',
    'pointAdjustments',
    'issuedFiscalDocuments',
    'fiscalDocumentUsages',
    'purchaseOrders',
    'activities',
    'crmOpportunities',
    'customers',
    'customerMutations',
    'erp_sales_documents',
]);
const isErpMasterPullCollection = (collection: string): boolean =>
    ERP_MASTER_PULL_COLLECTIONS.has(collection)
    && !ERP_RUNTIME_UNSUPPORTED_MASTER_COLLECTIONS.has(collection);

const markErpMasterCollectionUnsupported = (
    collection: string,
    details: Record<string, unknown>,
): void => {
    ERP_RUNTIME_UNSUPPORTED_MASTER_COLLECTIONS.add(collection);
    if (ERP_UNSUPPORTED_WARNING_COLLECTIONS.has(collection)) return;
    ERP_UNSUPPORTED_WARNING_COLLECTIONS.add(collection);
    console.warn('[SYNC_COLLECTION_SKIPPED_UNSUPPORTED_COLLECTION]', {
        collection,
        retry_policy: 'disabled_for_runtime_session',
        ...details,
    });
};

const isErpOperationPushCollection = (collection: string): boolean =>
    ERP_OPERATION_PUSH_COLLECTIONS.has(collection);

const logSkippedNonMasterPull = (
    collection: string,
    operation: OperationalSyncOperation,
    endpoint?: string
): void => {
    if (ERP_RUNTIME_UNSUPPORTED_MASTER_COLLECTIONS.has(collection)) return;
    console.warn('[SYNC_COLLECTION_SKIPPED_NOT_A_MASTER]', {
        collection,
        operation,
        endpoint,
        isMasterCollection: isErpMasterPullCollection(collection),
        isOperationCollection: isErpOperationPushCollection(collection),
        isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
        skippedReason: isErpOperationPushCollection(collection) ? 'OPERATION_COLLECTION' : 'NOT_A_MASTER_ERP_COLLECTION',
        userVisibleSeverity: 'warning',
        message: 'Colección omitida: no es maestro ERP.',
    });
};

const safeLocalStorageGet = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const safeLocalStorageSet = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage quota must not break the operational binding.
    }
};

const safeLocalStorageRemove = (key: string): void => {
    try {
        localStorage.removeItem(key);
    } catch {
        // Non-critical cleanup.
    }
};

const normalizeIdentityValue = (value?: unknown): string => String(value || '').trim().toUpperCase();

const previewSyncToken = (token?: string | null): string | null => {
    const normalized = String(token || '').trim();
    return normalized ? '(redacted)' : null;
};

const sanitizeSyncToken = (token?: string | null): string | null => {
    const normalized = String(token || '')
        .replace(/[\r\n\t]/g, '')
        .trim();

    if (!normalized) return null;
    if (['undefined', 'null', 'nan'].includes(normalized.toLowerCase())) return null;
    if (normalized === '[object Object]') return null;
    if (normalized.length < 8) return null;
    return normalized;
};

const pickFirstString = (...values: unknown[]): string | null => {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return null;
};

const ERP_TIMESTAMP_CURSOR_COLLECTIONS = new Set(['products', 'items']);

const isValidIsoTimestampCursor = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || Number.isNaN(Date.parse(trimmed))) return false;
    return /^\d{4}-\d{2}-\d{2}T/.test(trimmed);
};

const readArrayPayload = (payload: any, collection?: string): any[] => {
    const collectionKeys: Record<string, string[]> = {
        products: ['products', 'items'],
        items: ['items', 'products'],
        customers: ['customers', 'clients', 'clients_data'],
        suppliers: ['suppliers', 'vendors'],
    };
    for (const key of collectionKeys[collection || ''] || []) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.records)) return payload.records;
    return [];
};

const normalizePullDeltaPayload = (collection: string, payload: any): PullDeltaResult => ({
    ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
    items: readArrayPayload(payload, collection),
});

const readBooleanPayload = (...values: unknown[]): boolean => {
    for (const value of values) {
        if (typeof value === 'boolean') return value;
    }
    return false;
};

const readCursorPayload = (payload: any): string | null => pickFirstString(
    payload?.nextCursor,
    payload?.next_cursor,
    payload?.cursor,
    payload?.metadata?.nextCursor,
    payload?.metadata?.next_cursor,
    payload?.metadata?.cursor,
    payload?.lastSyncedAt,
    payload?.last_synced_at,
    payload?.serverTime,
    payload?.server_time,
    payload?.timestamp,
);

class SyncCircuitBreaker {
    private consecutiveFailures = 0;
    private openedAt = 0;

    constructor(
        private readonly channel: CircuitBreakerChannel,
        private readonly maxConsecutiveFailures = 3,
        private readonly resetTimeoutMs = 30000
    ) {}

    assertAvailable() {
        if (this.consecutiveFailures < this.maxConsecutiveFailures) return;

        const elapsed = Date.now() - this.openedAt;
        if (elapsed < this.resetTimeoutMs) {
            console.warn(`[SYNC_HTTP] circuit=${this.channel} open message="${ERP_TEMPORARILY_UNAVAILABLE_ERROR}"`);
            throw new Error(ERP_TEMPORARILY_UNAVAILABLE_ERROR);
        }

        console.log(`[SYNC_HTTP] circuit=${this.channel} half-open after cooldown; retrying ERP connectivity.`);
        this.consecutiveFailures = 0;
        this.openedAt = 0;
    }

    recordSuccess(): boolean {
        const wasOpen = this.consecutiveFailures >= this.maxConsecutiveFailures;
        this.reset();
        return wasOpen;
    }

    recordConnectionFailure(): boolean {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures < this.maxConsecutiveFailures) return false;

        this.openedAt = Date.now();
        console.error(
            `[SYNC_HTTP] circuit=${this.channel} opened message="${ERP_TEMPORARILY_UNAVAILABLE_ERROR}" failures=${this.consecutiveFailures}`
        );
        return true;
    }

    canRetry(): boolean {
        return this.consecutiveFailures < this.maxConsecutiveFailures;
    }

    reset() {
        this.consecutiveFailures = 0;
        this.openedAt = 0;
    }
}

class ApiSyncAdapter {
    private config: SyncConfig | null = null;
    private authToken: string | null = null;
    private erpAuthToken: string | null = null;
    private operationalTargetHint: { terminalId: string | null; baseUrl: string | null } = { terminalId: null, baseUrl: null };
    private isOnline: boolean = true;
    private authInFlight: Record<CircuitBreakerChannel, Promise<void> | null> = { sales: null, background: null };
    private erpAuthInFlight: Record<CircuitBreakerChannel, Promise<string> | null> = { sales: null, background: null };
    private lastOperationalStockBalanceMaps = new Map<string, Record<string, number>>();
    private onlineListener: (() => void) | null = null;
    private offlineListener: (() => void) | null = null;

    private readonly salesCircuitBreaker = new SyncCircuitBreaker('sales');
    private readonly backgroundCircuitBreaker = new SyncCircuitBreaker('background');
    private onConnectionRestored: (() => void) | null = null;
    private lastAuthLogAt: Record<'master' | 'erp', number> = { master: 0, erp: 0 };
    private readonly AUTH_LOG_THROTTLE_MS = 5000;
    private readonly ERP_REAUTH_RETRY_WINDOW_MS = 30000;

    private isCircuitBreakerOpenError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error || '');
        return message.includes(ERP_TEMPORARILY_UNAVAILABLE_ERROR);
    }

    private safeParseSyncJson(text: string): any | null {
        try {
            return text ? JSON.parse(text) : null;
        } catch {
            return null;
        }
    }

    private collectResponseFacts(value: unknown, facts: {
        success: boolean;
        applied: boolean;
        alreadyApplied: boolean;
        duplicate: boolean;
        realApplyError: boolean;
        errors: string[];
    }) {
        if (value === null || value === undefined) return;

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized) return;
            if (
                normalized.includes('already_applied') ||
                normalized.includes('already applied') ||
                normalized.includes('already exists') ||
                normalized.includes('ya existe') ||
                normalized.includes('ya fue aplicado') ||
                normalized.includes('previamente aplicado') ||
                normalized.includes('applied previously') ||
                normalized.includes('apply_skipped_reason') && normalized.includes('already_applied')
            ) {
                facts.alreadyApplied = true;
            }
            if (
                normalized.includes('duplicate') ||
                normalized.includes('duplicado') ||
                normalized.includes('duplicada') ||
                normalized.includes('duplicated')
            ) {
                facts.duplicate = true;
            }
            if (normalized === 'success' || normalized === 'ok') facts.success = true;
            if (normalized === 'applied') facts.applied = true;
            if (normalized === 'already_applied') facts.alreadyApplied = true;
            return;
        }

        if (typeof value !== 'object') return;

        if (Array.isArray(value)) {
            value.forEach(item => this.collectResponseFacts(item, facts));
            return;
        }

        for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
            const key = rawKey.toLowerCase();
            const stringVal = typeof rawVal === 'string' ? rawVal.trim().toLowerCase() : '';

            if ((key === 'status' || key === 'sync_status' || key === 'applied_status') && stringVal === 'success') {
                facts.success = true;
            }
            if ((key === 'sync_status' || key === 'applied_status' || key === 'status') && stringVal === 'applied') {
                facts.applied = true;
            }
            if (key === 'success' && rawVal === true) facts.success = true;
            if (key === 'applied' && rawVal === true) facts.applied = true;
            if (key === 'duplicate' && rawVal === true) facts.duplicate = true;
            if (key === 'already_applied' && rawVal === true) facts.alreadyApplied = true;
            if (key === 'apply_skipped_reason' && stringVal === 'already_applied') facts.alreadyApplied = true;

            if ((key === 'apply_error' || key === 'error') && rawVal && typeof rawVal !== 'object') {
                const errorText = String(rawVal);
                const errorFacts = { success: false, applied: false, alreadyApplied: false, duplicate: false, realApplyError: false, errors: [] as string[] };
                this.collectResponseFacts(errorText, errorFacts);
                if (!errorFacts.alreadyApplied && !errorFacts.duplicate) {
                    facts.realApplyError = true;
                    facts.errors.push(errorText);
                }
            }

            this.collectResponseFacts(rawVal, facts);
        }
    }

    private isIdempotentAppliedResponse(body: any, text = '', responseOk = true): boolean {
        const facts = {
            success: false,
            applied: false,
            alreadyApplied: false,
            duplicate: false,
            realApplyError: false,
            errors: [] as string[]
        };

        this.collectResponseFacts(body, facts);
        this.collectResponseFacts(text, facts);

        if (facts.realApplyError && !facts.alreadyApplied) return false;
        if (facts.alreadyApplied) return true;
        if (facts.duplicate) return false;
        if (responseOk && (facts.success || facts.applied)) return true;
        return false;
    }

    private hasRealApplyErrorResponse(body: any, text = ''): boolean {
        const facts = {
            success: false,
            applied: false,
            alreadyApplied: false,
            duplicate: false,
            realApplyError: false,
            errors: [] as string[]
        };

        this.collectResponseFacts(body, facts);
        this.collectResponseFacts(text, facts);
        return facts.realApplyError && !facts.alreadyApplied && !facts.duplicate;
    }

    private hasErpApplyConfirmation(body: any, text = ''): boolean {
        const facts = {
            success: false,
            applied: false,
            alreadyApplied: false,
            duplicate: false,
            realApplyError: false,
            errors: [] as string[]
        };

        this.collectResponseFacts(body, facts);
        this.collectResponseFacts(text, facts);
        if (facts.realApplyError && !facts.alreadyApplied) return false;
        if (facts.alreadyApplied) return true;
        if (facts.duplicate) return false;

        const erpInbox = body && typeof body === 'object' ? (body as any).erpInbox : null;
        if (erpInbox?.skipped || erpInbox?.failed) return false;
        const numeric = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
        const appliedCount = numeric((body as any)?.appliedCount ?? erpInbox?.appliedCount);
        const addedCount = numeric((body as any)?.addedCount ?? erpInbox?.addedCount);
        const duplicateCount = numeric((body as any)?.duplicateCount ?? erpInbox?.duplicateCount);
        if (duplicateCount > 0 && appliedCount <= 0 && addedCount <= 0) return false;

        const resultCandidates = [
            ...(Array.isArray(erpInbox?.results) ? erpInbox.results : []),
            ...(Array.isArray((body as any)?.results) ? (body as any).results : []),
            ...(Array.isArray((body as any)?.applyResults) ? (body as any).applyResults : []),
            ...(Array.isArray((body as any)?.items) ? (body as any).items : [])
        ];

        const hasAppliedResult = resultCandidates.some((result: any) => {
            if (!result || typeof result !== 'object') return false;
            if (result.error || result.applyError) return false;
            const status = String(result.status || result.syncStatus || result.appliedStatus || '').trim().toLowerCase();
            const eventType = String(result.eventType || result.type || '').trim().toUpperCase();
            return Boolean(
                result.erpDocumentId ||
                result.erp_document_id ||
                result.documentId ||
                result.document_id ||
                status === 'success' ||
                status === 'applied' ||
                eventType === 'SALE_POSTED'
            );
        });

        if (hasAppliedResult) return true;
        if (appliedCount > 0) return true;
        return facts.applied;
    }

    private allApplyIssuesAreIdempotent(issues: unknown): boolean {
        const list = Array.isArray(issues) ? issues : issues ? [issues] : [];
        return list.length > 0 && list.every(issue => this.isIdempotentAppliedResponse(issue, JSON.stringify(issue), true));
    }

    private attachTransactionSyncAudit(transaction: any, response: any, mode: 'APPLIED' | 'SKIPPED_ALREADY_APPLIED' | 'STAGED') {
        if (!transaction || typeof transaction !== 'object') return;
        const appliedAt = new Date().toISOString();
        transaction.syncResponse = response;
        transaction.syncedAt = appliedAt;
        transaction.erpSyncStatus = mode;
        transaction.erpSyncResponse = response;
        transaction.erpSyncedAt = appliedAt;
        transaction.syncError = undefined;
    }

    private onConnectionLostCallback: (() => void) | null = null;

    private logAuthFailure(kind: 'master' | 'erp', error: unknown) {
        const now = Date.now();
        if (now - this.lastAuthLogAt[kind] < this.AUTH_LOG_THROTTLE_MS) {
            return;
        }

        this.lastAuthLogAt[kind] = now;
        const prefix = kind === 'master' ? '❌ Authentication failed:' : '❌ ERP authentication failed:';
        console.error(prefix, error);
    }

    setOnConnectionLost(callback: () => void) {
        this.onConnectionLostCallback = callback;
    }

    updateMasterUrl(newUrl: string) {
        if (this.config) {
            console.log(`🔄 ApiSyncAdapter: Updating Master URL to ${newUrl}`);
            this.config.masterUrl = newUrl;
            this.authToken = null;
            this.resetCircuitBreaker();
        }
    }

    resetCircuitBreaker() {
        this.salesCircuitBreaker.reset();
        this.backgroundCircuitBreaker.reset();
        this.isOnline = true;
        console.log('🔄 ApiSyncAdapter: ERP circuit breakers manually RESET.');
    }

    /**
     * Public alias for resetCircuitBreaker to match expected interface
     */
    public resetCircuit() {
        this.resetCircuitBreaker();
    }

    isRecoverableConnectionError(error: unknown): boolean {
        if (this.isCircuitBreakerOpenError(error)) return true;
        if (!error) return false;
        const errorMessage = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
        const normalizedMessage = errorMessage.toLowerCase();
        if (normalizedMessage.includes('failed to fetch')) return true;
        if (normalizedMessage.includes('network error')) return true;
        if (!(error instanceof Error)) return false;
        return error.name === 'AbortError' || error.message === 'Failed to fetch';
    }

    private isRecoverableMetadataTimeout(error: unknown): boolean {
        const message = error instanceof Error
            ? error.message
            : typeof error === 'string'
                ? error
                : '';
        const normalized = message.toLowerCase();
        return normalized.includes('timeout')
            || normalized.includes('timed out')
            || normalized.includes('aborterror');
    }

    private resolveRequestTimeoutMs(url: string, operation: OperationalSyncOperation = 'PULL_MASTERS'): number {
        const normalizedUrl = url.toLowerCase();
        if (operation === 'PULL_MASTERS') {
            if (normalizedUrl.includes('/metadata')) return 45000;
            if (normalizedUrl.includes('/delta')) return 45000;
            if (normalizedUrl.includes('/full')) return 90000;
            return 45000;
        }
        if (operation === 'PULL_CONFIG') return 45000;
        if (operation === 'PUSH_OPERATIONS') return 20000;
        if (operation === 'PUSH_MASTERS') return 30000;
        return 15000;
    }

    private getCircuitBreaker(channel: CircuitBreakerChannel): SyncCircuitBreaker {
        return channel === 'sales' ? this.salesCircuitBreaker : this.backgroundCircuitBreaker;
    }

    /**
     * Helper: Fetch with Retry and Timeout
     */
    private async fetchWithRetry(
        url: string,
        options: RequestInit = {},
        retries = 2,
        backoff = 500,
        channel: CircuitBreakerChannel = 'background',
        operation: OperationalSyncOperation = channel === 'sales' ? 'PUSH_OPERATIONS' : 'PULL_MASTERS'
    ): Promise<Response> {
        // Add jitter to backoff (±20% randomness)
        const jitter = backoff * 0.2;
        const effectiveBackoff = backoff + (Math.random() * jitter * 2 - jitter);
        const circuitBreaker = this.getCircuitBreaker(channel);
        const shouldGateWithCircuit = operation === 'PUSH_OPERATIONS' || channel === 'sales';
        if (shouldGateWithCircuit) {
            circuitBreaker.assertAvailable();
        }

        const method = String(options.method || 'GET').toUpperCase();
        const headers = this.normalizeFetchHeaders(options.headers);
        const headersSummary = this.summarizeFetchHeaders(headers);
        const bodySize = this.getBodySize(options.body);
        const capacitorPlatform = this.resolveCapacitorPlatform();
        const syncProfile = loadSyncProfile();
        // The request already carries the effective token. Reading the complete
        // terminal credential store here was diagnostic-only work and forced a
        // synchronous localStorage scan for every background request.
        const tokenDiagnostic = {
            length: headersSummary.tokenLength || 0,
            source: headersSummary.xSyncToken
                ? 'REQUEST_X_SYNC_TOKEN'
                : headersSummary.authorization
                    ? 'REQUEST_AUTHORIZATION'
                    : null,
            updatedAt: null,
        };
        const fetchContext = {
            method,
            url,
            endpoint: url,
            headersPresent: {
                authorization: headersSummary.authorization,
                xSyncToken: headersSummary.xSyncToken,
                xTerminalId: headersSummary.xTerminalId,
                xDeviceId: headersSummary.xDeviceId,
                xDeviceToken: headersSummary.xDeviceToken,
            },
            tokenPresent: Boolean(headersSummary.tokenPreview),
            tokenPreview: headersSummary.tokenPreview,
            tokenLength: headersSummary.tokenLength || tokenDiagnostic.length || 0,
            tokenSource: tokenDiagnostic.source,
            tokenUpdatedAt: tokenDiagnostic.updatedAt,
            bodySize,
            contentType: headersSummary.contentType,
            contractSource: syncProfile.contractSource || null,
            profileSourcePriority: syncProfile.profileSourcePriority ?? getSyncProfileSourcePriority(syncProfile.contractSource),
            networkOnline: typeof navigator !== 'undefined' ? navigator.onLine : null,
            navigatorUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            platform: typeof navigator !== 'undefined' ? navigator.platform : null,
            capacitorPlatform,
            origin: typeof window !== 'undefined' ? window.location.origin : null,
        };

        console.log('[FETCH_PREPARE]', { ...fetchContext, fetchStage: 'PREPARE_HEADERS' });
        console.log('[FETCH_HEADERS]', {
            method,
            url,
            headersPresent: fetchContext.headersPresent,
            tokenPreview: headersSummary.tokenPreview,
            tokenLength: fetchContext.tokenLength,
            tokenSource: fetchContext.tokenSource,
            tokenUpdatedAt: fetchContext.tokenUpdatedAt,
            contentType: headersSummary.contentType,
            contractSource: fetchContext.contractSource,
            profileSourcePriority: fetchContext.profileSourcePriority,
        });

        try {
            const nativeResponse = await requestJson({
                url,
                method,
                headers,
                body: options.body,
                timeoutMs: this.resolveRequestTimeoutMs(url, operation),
                diagnosticContext: fetchContext,
            });
            const response = new Response(nativeResponse.text, {
                status: nativeResponse.status,
                headers: nativeResponse.headers,
            });
            console.log('[FETCH_RESPONSE]', {
                ...fetchContext,
                networkEngine: nativeResponse.networkEngine,
                fetchStage: nativeResponse.fetchStage || 'RESPONSE_RECEIVED',
                httpStatus: response.status,
                ok: response.ok,
                statusText: response.statusText,
            });

            // Success resets the breaker
            if (response.ok) {
                const wasBreakerOpen = circuitBreaker.recordSuccess();
                if (wasBreakerOpen && this.onConnectionRestored) {
                    console.log('📶 ApiSyncAdapter: Connection restored, notifying listeners.');
                    this.onConnectionRestored();
                }
            }

            if (response.status === 401) {
                this.authToken = null;
                console.warn(`[SYNC_HTTP] 401 Unauthorized at ${url}. Caller must re-authenticate and replay if safe.`);
            }

            // If 503 Service Unavailable or 504 Gateway Timeout, retry
            if ((response.status === 503 || response.status === 504) && retries > 0) {
                console.warn(`⚠️ Request failed with ${response.status}, retrying in ${Math.round(effectiveBackoff)}ms...`);
                await new Promise(r => setTimeout(r, effectiveBackoff));
                return this.fetchWithRetry(url, options, retries - 1, backoff * 2, channel, operation);
            }

            return response;
        } catch (error: any) {
            const isConnectionError = this.isRecoverableConnectionError(error);
            const isTimeout = error?.name === 'AbortError';
            const httpClientDiagnostic = error?.__httpClientDiagnostic;
            const networkEngine = httpClientDiagnostic?.networkEngine || 'fetch';
            const fetchStage = httpClientDiagnostic?.fetchStage
                || (isConnectionError && networkEngine !== 'capacitor-http' && (headersSummary.authorization || headersSummary.xSyncToken || headersSummary.xTerminalId || headersSummary.xDeviceId)
                    ? 'PREFLIGHT_FAILED'
                    : 'FETCH_FAILED');
            const fetchDiagnostic = {
                ...fetchContext,
                ...(httpClientDiagnostic || {}),
                operation,
                networkEngine,
                requestTimeoutMs: this.resolveRequestTimeoutMs(url, operation),
                fetchStage,
                errorName: error?.name || null,
                errorMessage: error?.message || String(error || ''),
                errorStack: error?.stack || null,
                errorCause: error?.cause ? String(error.cause) : null,
                corsExpectedHeaders: [
                    'Authorization',
                    'X-Sync-Token',
                    'X-Terminal-Id',
                    'X-POS-Terminal-Id',
                    'X-Device-Id',
                    'X-POS-Device-Id',
                    'Content-Type',
                ],
            };
            this.attachFetchDiagnostic(error, fetchDiagnostic);
            if (isConnectionError && operation === 'PULL_CONFIG') {
                console.warn('[FETCH_FAILED_CONFIG]', fetchDiagnostic);
            }
            if (isTimeout) {
                console.warn('[FETCH_TIMEOUT]', fetchDiagnostic);
            }
            console.error('[FETCH_FAILED]', fetchDiagnostic);

            // Increment failure count on network errors
            if (isConnectionError || isTimeout) {
                const opened = circuitBreaker.recordConnectionFailure();
                if (opened) {
                    // Notify listeners about connection loss to trigger auto-discovery
                    if (this.onConnectionLostCallback) {
                        this.onConnectionLostCallback();
                    }
                }
            }

            if ((isConnectionError || isTimeout) && retries > 0 && circuitBreaker.canRetry()) {
                console.warn(`⚠️ Connection error (${error.message}), retrying in ${Math.round(effectiveBackoff)}ms...`);
                await new Promise(r => setTimeout(r, effectiveBackoff));
                return this.fetchWithRetry(url, options, retries - 1, backoff * 1.5, channel, operation);
            }

            throw error;
        }
    }

    private async fetchWithoutCircuitBreaker(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
        const method = String(options.method || 'GET').toUpperCase();
        const headers = this.normalizeFetchHeaders(options.headers);
        const nativeResponse = await requestJson({
            url,
            method,
            headers,
            body: options.body,
            timeoutMs,
            diagnosticContext: { method, url, endpoint: url, circuitBreaker: false },
        });
        return new Response(nativeResponse.text, {
            status: nativeResponse.status,
            headers: nativeResponse.headers,
        });
    }

    /**
     * Initialize the adapter with configuration
     */
    async initialize(config: SyncConfig): Promise<void> {
        this.config = config;
        await this.authenticate();
        this.setupOnlineDetection();
        console.log(`🌐 ApiSyncAdapter initialized for Master at ${config.masterUrl}`);

        // Identidad del ERP (GET /version commit + /health projectRef): deja rastro en el
        // diagnóstico al iniciar. No bloquea el arranque ni expone secretos.
        void logErpIdentity();
    }

    /**
     * Test connection to a specific URL
     */
    async testConnection(url: string): Promise<boolean> {
        try {
            const cleanUrl = url.replace(/\/$/, '');
            const response = await fetch(`${cleanUrl}/api/sync/ping`);
            return response.ok;
        } catch (e) {
            console.error('Ping failed:', e);
            return false;
        }
    }

    /**
     * Authenticate with the Master terminal
     */
    async authenticate(force = false, channel: CircuitBreakerChannel = 'background'): Promise<void> {
        this.ensureConfig();
        if (!this.config) throw new Error('ApiSyncAdapter not initialized'); // Should be caught by ensureConfig

        if (!force && this.authToken) {
            return;
        }

        if (!force && this.authInFlight[channel]) {
            return this.authInFlight[channel]!;
        }

        const authPromise = (async () => {
            try {
                const response = await this.fetchWithRetry(`${this.config!.masterUrl}/api/sync/auth`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.getLocalDeviceHeaders(),
                    },
                    body: JSON.stringify({
                        terminalId: this.config!.terminalId,
                        terminal_id: this.config!.terminalId,
                        deviceToken: this.getLocalDeviceId(),
                        device_id: this.getLocalDeviceId()
                    })
                }, 2, 500, channel);

                if (!response.ok) {
                    await this.handleDeviceSupersededResponse(response, this.config!.terminalId);
                    let errorMessage = `Authentication failed: ${response.status} ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        errorMessage += ` - ${errorData.message} (${errorData.code})`;

                        if (errorData.code === 'DEVICE_MISMATCH') {
                            console.error('🛑 CRITICAL: DEVICE MISMATCH. This terminal ID is bound to another device.');
                        }
                    } catch {
                        // Ignore json parse error
                    }
                    throw new Error(errorMessage);
                }

                const data = await response.json();
                if (data?.terminal_id || data?.terminal_uuid || data?.operational_identity || data?.sync_state) {
                    persistErpSyncAuthIdentity(data, this.config!.terminalId);
                    if (erpSyncAuthRequiresFullBootstrap(data)) {
                        clearErpIncrementalSyncState();
                        markErpFullBootstrapRequired(data);
                        this.resetCircuitBreaker();
                    }
                }
                this.authToken = data.token;
                this.isOnline = true;
                console.log(`✅ Authenticated with Master terminal: ${this.config!.terminalId}`);
            } catch (error: unknown) {
                if (this.isCircuitBreakerOpenError(error)) {
                    console.warn(`⚠️ Authentication deferred: ${ERP_TEMPORARILY_UNAVAILABLE_ERROR}, waiting before retry.`);
                } else {
                    this.logAuthFailure('master', error);
                }
                this.isOnline = false;
                throw error;
            }
        })();

        this.authInFlight[channel] = authPromise.finally(() => {
            this.authInFlight[channel] = null;
        });

        return this.authInFlight[channel]!;
    }

    private buildSyncApiBase(url: string): string {
        const trimmed = url.replace(/\/$/, '');
        return /\/api\/sync$/i.test(trimmed) ? trimmed : `${trimmed}/api/sync`;
    }

    private getLocalDeviceId(): string | null {
        return resolveLocalDeviceId() || getSyncDeviceToken();
    }

    private getLocalDeviceHeaders(): Record<string, string> {
        const deviceId = this.getLocalDeviceId();
        return deviceId
            ? {
                'X-Device-Id': deviceId,
                'X-POS-Device-Id': deviceId,
            }
            : {};
    }

    private async parseErrorPayload(response: Response): Promise<Record<string, any>> {
        try {
            const payload = await response.clone().json();
            return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        } catch {
            return {};
        }
    }

    private async handleDeviceSupersededResponse(response: Response, terminalId?: string | null): Promise<void> {
        if (response.status !== 403) return;

        const payload = await this.parseErrorPayload(response);
        const code = String(payload.code || '').trim().toUpperCase();
        if (code !== 'DEVICE_SUPERSEDED') return;

        dispatchDeviceRevoked({
            reason: 'DEVICE_SUPERSEDED',
            message: String(payload.message || '').trim() || DEVICE_SUPERSEDED_MESSAGE,
            terminalId: terminalId || payload.terminal_id || null,
            previousDeviceId: this.getLocalDeviceId(),
            newDeviceId: payload.canonical_device_id || payload.new_device_id || null,
            payload,
        });
    }

    private resolveConfigErpBaseUrl(value: unknown): string | null {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return null;

        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;

        try {
            const url = new URL(withProtocol);
            return url
                .toString()
                .replace(/\/api\/sync\/?$/i, '')
                .replace(/\/api\/?$/i, '')
                .replace(/\/+$/, '');
        } catch {
            return null;
        }
    }

    private resolveOperationalInventoryContext(): {
        terminalId: string | null;
        localTerminalId: string | null;
        tenantId: string | null;
        erpBaseUrl: string | null;
        posDeviceId: string | null;
        syncApiBase: string | null;
    } {
        const syncApiBase = this.operationalTargetHint.baseUrl
            ? this.buildSyncApiBase(this.operationalTargetHint.baseUrl)
            : (localStorage.getItem('CLIC_ERP_SYNC_URL') || '').trim() || null;

        const erpBaseUrl =
            this.resolveConfigErpBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL')) ||
            this.resolveConfigErpBaseUrl(localStorage.getItem('erp_base_url')) ||
            this.resolveConfigErpBaseUrl(syncApiBase) ||
            null;

        return {
            terminalId:
                this.operationalTargetHint.terminalId ||
                localStorage.getItem('clic_erp_sync_terminal_id') ||
                null,
            localTerminalId:
                localStorage.getItem('clic_erp_sync_local_terminal_id') ||
                localStorage.getItem('active_terminal_id') ||
                localStorage.getItem('CLIC_POS_TERMINAL_ID') ||
                null,
            tenantId:
                localStorage.getItem('clic_erp_sync_tenant_id') ||
                localStorage.getItem('active_tenant_id') ||
                localStorage.getItem('clic_tenant_id') ||
                null,
            erpBaseUrl,
            posDeviceId: localStorage.getItem('CLIC_POS_DEVICE_ID') || null,
            syncApiBase,
        };
    }

    private matchesInventoryBalanceProduct(balance: TerminalInventoryBalancePayload | Record<string, unknown>, productId?: string): boolean {
        const target = String(productId || '').trim();
        if (!target) return true;

        const candidateValues = [
            balance?.item_id,
            balance?.product_id,
            balance?.id,
        ];

        return candidateValues.some((value) => String(value || '').trim() === target);
    }

    private buildOperationalStockBalanceCacheKey(productId?: string): string {
        return String(productId || '__ALL__').trim() || '__ALL__';
    }

    private buildOperationalStockBalanceMap(
        balances: Array<TerminalInventoryBalancePayload | Record<string, unknown>> = []
    ): Record<string, number> {
        const normalized: Record<string, number> = {};

        for (const balance of balances) {
            const warehouseId = String(
                (balance as any)?.warehouse_id
                || (balance as any)?.warehouseId
                || (balance as any)?.id
                || ''
            ).trim();
            const qtyOnHand = Number(
                (balance as any)?.qty_on_hand
                ?? (balance as any)?.qtyOnHand
                ?? (balance as any)?.quantity
                ?? (balance as any)?.qty
                ?? (balance as any)?.stock
                ?? (balance as any)?.balance
            );

            if (!warehouseId || !Number.isFinite(qtyOnHand)) {
                continue;
            }

            normalized[warehouseId] = Number(normalized[warehouseId] || 0) + qtyOnHand;
        }

        return normalized;
    }

    private normalizeTerminalInventoryPayload(payload: unknown): Required<Pick<TerminalInventoryPayload, 'balances' | 'cursor' | 'has_changes'>> {
        const root = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {};
        const nested = root.inventory && typeof root.inventory === 'object' && !Array.isArray(root.inventory)
            ? root.inventory as Record<string, unknown>
            : {};

        const balances = Array.isArray(nested.balances)
            ? nested.balances
            : Array.isArray(nested.stock_balances)
                ? nested.stock_balances
                : Array.isArray(nested.stockBalances)
                    ? nested.stockBalances
                    : Array.isArray(root.balances)
                        ? root.balances
                        : Array.isArray(root.stock_balances)
                            ? root.stock_balances
                            : Array.isArray(root.stockBalances)
                                ? root.stockBalances
                                : Array.isArray((root.data as any)?.inventory?.balances)
                                    ? (root.data as any).inventory.balances
                                    : Array.isArray((root.data as any)?.inventory?.stock_balances)
                                        ? (root.data as any).inventory.stock_balances
                                        : [];

        const cursor = typeof nested.cursor === 'string'
            ? nested.cursor.trim() || null
            : typeof root.cursor === 'string'
                ? root.cursor.trim() || null
                : null;

        const hasChanges = typeof nested.has_changes === 'boolean'
            ? nested.has_changes
            : typeof root.has_changes === 'boolean'
                ? root.has_changes
                : true;

        return {
            balances: balances as TerminalInventoryBalancePayload[],
            cursor,
            has_changes: hasChanges,
        };
    }

    setOperationalTargetHint(input: { terminalId?: string | null; baseUrl?: string | null }) {
        const terminalId = String(input.terminalId || '').trim();
        const baseUrl = String(input.baseUrl || '').trim();
        this.operationalTargetHint = {
            terminalId: terminalId || null,
            baseUrl: baseUrl || null,
        };
        if (baseUrl) {
            localStorage.setItem('CLIC_ERP_BASE_URL', baseUrl.replace(/\/api\/sync\/?$/i, '').replace(/\/+$/, ''));
            localStorage.setItem('erp_base_url', baseUrl.replace(/\/api\/sync\/?$/i, '').replace(/\/+$/, ''));
            localStorage.setItem('CLIC_ERP_SYNC_URL', this.buildSyncApiBase(baseUrl));
        }
        if (terminalId) {
            localStorage.setItem('clic_erp_sync_terminal_id', terminalId);
        }
    }

    isUsingErpOperationalTarget(): boolean {
        return this.resolveOperationalTarget()?.useLocalTarget === false;
    }

    isErpActiveOperationalTarget(): boolean {
        return resolveSyncTarget().kind === 'ERP_ACTIVE';
    }

    isPosOnlyCloudStagingOperationalTarget(): boolean {
        return isPosOnlyCloudStagingTarget();
    }

    private resolveCurrentDeviceId(): string | null {
        const storedCredentials = readTerminalCredentialsSync();
        return pickFirstString(
            storedCredentials.deviceId,
            safeLocalStorageGet('CLIC_POS_DEVICE_ID'),
            safeLocalStorageGet('pos_device_id'),
            safeLocalStorageGet('clic_pos_device_id'),
            resolveOrCreateLocalDeviceId()
        );
    }

    private resolveCurrentTenantId(): string | null {
        const profile = loadSyncProfile();
        const storedCredentials = readTerminalCredentialsSync();
        return pickFirstString(
            storedCredentials.erpTenantId,
            storedCredentials.tenantId,
            storedCredentials.cloudAdminTenantId,
            safeLocalStorageGet('clic_erp_sync_tenant_id'),
            safeLocalStorageGet('active_tenant_id'),
            safeLocalStorageGet('clic_tenant_id'),
            profile.erpTenantId,
            profile.cloudTenantId,
            profile.localTenantId
        );
    }

    private resolveStoredErpSyncToken(): string | null {
        return this.resolveStoredErpSyncTokenDiagnostic().token;
    }

    private resolveStoredErpSyncTokenDiagnostic(): { token: string | null; source: string | null; updatedAt: string | null; length: number } {
        const storedCredentials = readTerminalCredentialsSync();
        const credentialToken = sanitizeSyncToken(storedCredentials.syncToken || null);
        if (credentialToken) {
            return {
                token: credentialToken,
                source: 'TERMINAL_CREDENTIAL_STORE',
                updatedAt: storedCredentials.syncTokenUpdatedAt || null,
                length: credentialToken.length,
            };
        }

        for (const key of ERP_SYNC_TOKEN_KEYS) {
            const token = sanitizeSyncToken(safeLocalStorageGet(key));
            if (token) {
                return {
                    token,
                    source: key,
                    updatedAt: safeLocalStorageGet(ERP_SYNC_TOKEN_UPDATED_AT_KEY),
                    length: token.length,
                };
            }
        }
        return { token: null, source: null, updatedAt: safeLocalStorageGet(ERP_SYNC_TOKEN_UPDATED_AT_KEY), length: 0 };
    }

    private persistErpSyncToken(token: string, expiresAt?: unknown): void {
        const normalized = sanitizeSyncToken(token);
        if (!normalized) return;
        safeLocalStorageSet('clic_erp_sync_token', normalized);
        const updatedAt = new Date().toISOString();
        safeLocalStorageSet(ERP_SYNC_TOKEN_UPDATED_AT_KEY, updatedAt);
        if (typeof expiresAt === 'string' && expiresAt.trim()) {
            safeLocalStorageSet(ERP_SYNC_TOKEN_EXPIRES_AT_KEY, expiresAt.trim());
        }
        saveTerminalCredentialsSync({
            syncToken: normalized,
            syncTokenUpdatedAt: updatedAt,
            syncTokenExpiresAt: typeof expiresAt === 'string' && expiresAt.trim() ? expiresAt.trim() : null,
        });
    }

    private clearCanonicalErpSyncToken(): void {
        safeLocalStorageRemove('clic_erp_sync_token');
        safeLocalStorageRemove(ERP_SYNC_TOKEN_EXPIRES_AT_KEY);
        safeLocalStorageRemove(ERP_SYNC_TOKEN_UPDATED_AT_KEY);
        clearStoredSyncToken();
    }

    private clearStaleOperationalAuthFlags(): void {
        [
            'clic_sync_last_auth_error',
            'clic_sync_last_reauth_attempt_at',
            'clic_last_sync_error_diagnostic',
            'clic_device_taken',
            'clic_device_reauth_required',
            'clic_pos_device_taken',
            'clic_pos_reauth_required',
            'clic_auth_blocked',
            'clic_terminal_blocked_message',
            'device_taken',
            'reauth_required',
            'blocked',
        ].forEach(safeLocalStorageRemove);
    }

    private reconcileStaleOperationalAuthState(input: {
        target: { terminalId: string; baseUrl?: string | null };
        staleStatus: string;
        deviceId: string | null;
        deviceTokenPresent: boolean;
    }): boolean {
        const credentials = readTerminalCredentialsSync();
        const currentDeviceId = normalizeIdentityValue(input.deviceId);
        const credentialDeviceId = normalizeIdentityValue(credentials.deviceId);
        const credentialTerminalIds = [
            credentials.erpTerminalId,
            credentials.terminalId,
            safeLocalStorageGet('clic_erp_sync_terminal_id'),
            safeLocalStorageGet('active_terminal_id'),
        ].map(normalizeIdentityValue).filter(Boolean);
        const targetTerminalId = normalizeIdentityValue(input.target.terminalId);
        const terminalMatches = !targetTerminalId || credentialTerminalIds.length === 0 || credentialTerminalIds.includes(targetTerminalId);
        const deviceMatches = Boolean(currentDeviceId) && (!credentialDeviceId || credentialDeviceId === currentDeviceId);
        const storedSyncToken = this.resolveStoredErpSyncToken();

        if (!deviceMatches || !terminalMatches || (!storedSyncToken && !input.deviceTokenPresent)) {
            return false;
        }

        setTerminalBindingDiagnosticStatus('BOUND');
        setCatalogDiagnosticStatus('SYNCED');
        setSalesPushDiagnosticStatus('ENABLED');
        setSyncAuthDiagnosticStatus(storedSyncToken ? 'AUTHENTICATED' : 'BOUND');
        safeLocalStorageSet('clic_sync_auth_status', storedSyncToken ? 'AUTHENTICATED' : 'BOUND');
        this.clearStaleOperationalAuthFlags();
        saveTerminalCredentialsSync({
            terminalId: input.target.terminalId,
            erpTerminalId: input.target.terminalId,
            deviceId: input.deviceId || credentials.deviceId || null,
            authStatus: storedSyncToken ? 'AUTHENTICATED' : 'BOUND',
            lastAuthError: null,
        });
        if (storedSyncToken) {
            this.erpAuthToken = storedSyncToken;
        }
        console.info('pos_reauth_state_ignored_because_device_authorized', {
            terminalId: input.target.terminalId,
            deviceId: input.deviceId,
            staleStatus: input.staleStatus,
            syncTokenPresent: Boolean(storedSyncToken),
            deviceTokenPresent: input.deviceTokenPresent,
        });
        console.info('pos_auth_success_clearing_reauth', {
            terminalId: input.target.terminalId,
            deviceId: input.deviceId,
            source: 'LOCAL_CREDENTIAL_RECONCILIATION',
        });
        console.info('pos_terminal_identity_persisted', {
            terminalId: input.target.terminalId,
            erpTerminalId: input.target.terminalId,
            deviceId: input.deviceId || credentials.deviceId || null,
            source: 'LOCAL_CREDENTIAL_RECONCILIATION',
        });
        return true;
    }

    private buildOperationalHeaders(
        target: { terminalId: string; useLocalTarget: boolean },
        token: string,
        includeContentType = false
    ): Record<string, string> {
        const headers: Record<string, string> = {};
        if (includeContentType) {
            headers['Content-Type'] = 'application/json';
        }

        const sharedAuthHeaders = target.useLocalTarget
            ? {}
            : buildTerminalSyncAuthHeaders();
        const normalizedToken = target.useLocalTarget
            ? sanitizeSyncToken(token)
            : sanitizeSyncToken(sharedAuthHeaders['X-Sync-Token']);
        if (normalizedToken) {
            headers.Authorization = `Bearer ${normalizedToken}`;
            headers['X-Sync-Token'] = normalizedToken;
        } else if (token) {
            console.warn('[INVALID_SYNC_HEADERS]', {
                reason: 'INVALID_OR_EMPTY_SYNC_TOKEN',
                tokenPreview: previewSyncToken(token),
            });
        }

        if (!target.useLocalTarget && target.terminalId) {
            headers['X-Terminal-Id'] = target.terminalId;
            headers['X-POS-Terminal-Id'] = target.terminalId;
        }

        const deviceId = this.resolveCurrentDeviceId();
        if (!target.useLocalTarget && deviceId) {
            headers['X-Device-Id'] = deviceId;
            headers['X-POS-Device-Id'] = deviceId;
        }

        const tenantId = this.resolveCurrentTenantId();
        if (!target.useLocalTarget && tenantId) {
            headers['X-Tenant-Id'] = tenantId;
            headers['X-POS-Tenant-Id'] = tenantId;
        }

        if (!target.useLocalTarget) {
            const deviceToken = resolveSyncDeviceToken().token;
            if (deviceToken) {
                headers['X-Device-Token'] = deviceToken;
            }
        }

        return headers;
    }

    private buildRequestAuthDiagnostic(headers: Record<string, string>) {
        const authHeader = headers.Authorization || '';
        const syncToken = headers['X-Sync-Token'] || '';
        return {
            authorizationPresent: Boolean(authHeader),
            syncTokenPresent: Boolean(syncToken),
            syncTokenPreview: previewSyncToken(syncToken || authHeader.replace(/^Bearer\s+/i, '')),
            terminalIdHeaderPresent: Boolean(headers['X-Terminal-Id'] || headers['X-POS-Terminal-Id']),
            deviceIdHeaderPresent: Boolean(headers['X-Device-Id'] || headers['X-POS-Device-Id']),
        };
    }

    private normalizeFetchHeaders(headers: HeadersInit | undefined): Record<string, string> {
        const normalized: Record<string, string> = {};
        if (!headers) return normalized;

        const assign = (key: string, value: unknown) => {
            const headerName = String(key || '').trim();
            const headerValue = String(value ?? '').replace(/[\r\n]/g, '').trim();
            if (!headerName || !headerValue || ['undefined', 'null', '[object object]'].includes(headerValue.toLowerCase())) {
                if (headerName) {
                    console.warn('[INVALID_SYNC_HEADERS]', { headerName, reason: 'EMPTY_OR_INVALID_VALUE' });
                }
                return;
            }
            normalized[headerName] = headerValue;
        };

        if (headers instanceof Headers) {
            headers.forEach((value, key) => assign(key, value));
            return normalized;
        }

        if (Array.isArray(headers)) {
            headers.forEach(([key, value]) => assign(key, value));
            return normalized;
        }

        Object.entries(headers).forEach(([key, value]) => assign(key, value));
        return normalized;
    }

    private summarizeFetchHeaders(headers: Record<string, string>) {
        const syncToken = headers['X-Sync-Token'] || headers['x-sync-token'] || '';
        const authorization = headers.Authorization || headers.authorization || '';
        const deviceToken = headers['X-Device-Token'] || headers['x-device-token'] || '';
        const effectiveToken = syncToken || authorization.replace(/^Bearer\s+/i, '') || deviceToken;
        return {
            authorization: Boolean(authorization),
            xSyncToken: Boolean(syncToken),
            xTerminalId: Boolean(headers['X-Terminal-Id'] || headers['X-POS-Terminal-Id'] || headers['x-terminal-id'] || headers['x-pos-terminal-id']),
            xDeviceId: Boolean(headers['X-Device-Id'] || headers['X-POS-Device-Id'] || headers['x-device-id'] || headers['x-pos-device-id']),
            xDeviceToken: Boolean(deviceToken),
            tokenPreview: previewSyncToken(syncToken || authorization.replace(/^Bearer\s+/i, '')) || previewSyncDeviceToken(deviceToken),
            tokenLength: sanitizeSyncToken(effectiveToken)?.length || deviceToken.length || 0,
            contentType: headers['Content-Type'] || headers['content-type'] || null,
        };
    }

    private resolveCapacitorPlatform(): string {
        try {
            const capacitor = (window as any)?.Capacitor;
            if (capacitor && typeof capacitor.getPlatform === 'function') {
                return String(capacitor.getPlatform() || 'unknown');
            }
        } catch {
            // ignore
        }
        return 'web';
    }

    private getBodySize(body: BodyInit | null | undefined): number {
        if (!body) return 0;
        if (typeof body === 'string') return body.length;
        if (body instanceof Blob) return body.size;
        if (body instanceof FormData) return -1;
        if (body instanceof URLSearchParams) return body.toString().length;
        return -1;
    }

    private attachFetchDiagnostic(error: unknown, diagnostic: Record<string, unknown>): void {
        if (!error || typeof error !== 'object') return;
        try {
            Object.defineProperty(error, '__syncFetchDiagnostic', {
                value: diagnostic,
                configurable: true,
                enumerable: false,
            });
        } catch {
            (error as any).__syncFetchDiagnostic = diagnostic;
        }
    }

    private extractSyncTokenFromAuthResponse(data: any): { token: string | null; expiresAt?: unknown } {
        const token = pickFirstString(
            data?.token,
            data?.syncToken,
            data?.sync_token,
            data?.syncAuthToken,
            data?.sync_auth_token,
            data?.access_token,
            data?.session?.syncToken,
            data?.session?.sync_token,
            data?.terminal_config?.syncToken,
            data?.terminal_config?.sync_token,
            data?.terminal_config?.syncAuthToken,
            data?.terminal_config?.sync_auth_token,
            data?.config?.syncToken,
            data?.config?.sync_token,
            data?.config?.security?.syncAuthToken,
            data?.config?.runtime?.syncAuthToken
        );

        const expiresAt = pickFirstString(
            data?.tokenExpiresAt,
            data?.token_expires_at,
            data?.expiresAt,
            data?.expires_at,
            data?.session?.tokenExpiresAt,
            data?.session?.expires_at
        );

        return { token, expiresAt };
    }

    private isDeviceTokenRequiredResponse(status: number, payload: any, bodyText?: string): boolean {
        if (status !== 401 && status !== 403) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = [
            backendCode,
            payload?.code,
            payload?.error,
            payload?.message,
            payload?.detail,
            bodyText,
        ].map((entry) => String(entry || '').toUpperCase()).join(' ');
        return /DEVICE[_\s-]?TOKEN[_\s-]?REQUIRED/.test(message);
    }

    private isRecoverableAuthResponse(status: number, payload: any, bodyText?: string): boolean {
        if (status !== 401 && status !== 403) return false;
        const backendCode = String(this.normalizeBackendCode(payload) || '').toUpperCase();
        const message = [
            backendCode,
            payload?.code,
            payload?.error,
            payload?.message,
            payload?.detail,
            bodyText,
        ].map((entry) => String(entry || '').toUpperCase()).join(' ');
        return /DEVICE_NOT_AUTHORIZED|BOUND_AUTH_MISMATCH|DEVICE_TOKEN_MISSING_LOCAL|LOCKED_AUTH_REQUIRED|AUTH_ERROR|DEVICE[_\s-]?TOKEN[_\s-]?REQUIRED/.test(message);
    }

    private isWaitingCloudAdminAuthResponse(status: number, payload: any, bodyText?: string): boolean {
        if (status < 400) return false;
        const backendCode = String(this.normalizeBackendCode(payload) || '').toUpperCase();
        const message = [
            backendCode,
            payload?.code,
            payload?.error,
            payload?.message,
            payload?.detail,
            bodyText,
        ].map((entry) => String(entry || '').toUpperCase()).join(' ');
        return /DEVICE_NOT_AUTHORIZED|WAITING_CLOUD_ADMIN_REAUTHORIZATION|TAKEOVER_REQUIRED|ERP_REPAIR_PENDING|BOUND_AUTH_MISMATCH/.test(message);
    }

    private markOperationalAuthNeedsReauth(input: {
        operation: OperationalSyncOperation;
        endpoint: string | null;
        error: Error;
        backendCode: string;
        httpStatus?: number | string | null;
        responseBody?: string | null;
        nextAction?: string | null;
        target?: { terminalId?: string | null; baseUrl?: string | null } | null;
    }): Error {
        const credentials = readTerminalCredentialsSync();
        const deviceId = this.resolveCurrentDeviceId();
        const terminalId = input.target?.terminalId || credentials.erpTerminalId || credentials.terminalId || safeLocalStorageGet('clic_erp_sync_terminal_id') || null;
        const timestamp = new Date().toISOString();
        this.erpAuthToken = null;
        this.clearCanonicalErpSyncToken();
        setTerminalBindingDiagnosticStatus('NEEDS_REAUTH');
        setCatalogDiagnosticStatus('AUTH_ERROR');
        setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
        setSyncAuthDiagnosticStatus('NEEDS_REAUTH');
        safeLocalStorageSet('clic_sync_auth_status', 'NEEDS_REAUTH');
        safeLocalStorageSet('clic_sync_last_auth_error', input.backendCode);
        saveTerminalCredentialsSync({
            terminalId,
            erpTerminalId: terminalId,
            deviceId,
            authStatus: 'NEEDS_REAUTH',
            lastAuthError: input.backendCode,
        });
        console.warn('POS_SYNC_PAUSED_AUTH_REQUIRED', {
            terminalId,
            deviceId,
            backendCode: input.backendCode,
            nextAction: input.nextAction || 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
        });
        reportSyncErrorDiagnostic({
            operation: input.operation,
            endpoint: input.endpoint,
            httpStatus: input.httpStatus ?? null,
            responseBody: input.responseBody || null,
            error: input.error,
            authStatus: 'NEEDS_REAUTH',
            backendCode: input.backendCode,
            nextAction: input.nextAction || 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
            blockedByLocalGuard: true,
            guardReason: input.backendCode,
            terminalId,
            deviceId,
            userVisibleSeverity: 'warning',
            timestamp,
        } as any);
        return input.error;
    }

    private canAttemptOperationalReauth(): boolean {
        const credentials = readTerminalCredentialsSync();
        const rawLastAttempt = credentials.lastReauthAttemptAt || safeLocalStorageGet('clic_sync_last_reauth_attempt_at');
        if (!rawLastAttempt) return true;
        const lastAttemptMs = Date.parse(rawLastAttempt);
        return !Number.isFinite(lastAttemptMs) || Date.now() - lastAttemptMs >= this.ERP_REAUTH_RETRY_WINDOW_MS;
    }

    private persistErpAuthPayloadFromResponse(input: {
        data: any;
        target: { terminalId: string };
        deviceId: string | null;
        tenantId: string | null;
        existingDeviceToken: string | null;
        deviceTokenSourceWhenNew: string;
        deviceTokenSourceWhenRefresh: string;
    }): { syncToken: string; deviceToken: string | null; canonicalTerminalId: string; expiresAt?: unknown } {
        const { data, target, deviceId, tenantId, existingDeviceToken, deviceTokenSourceWhenNew, deviceTokenSourceWhenRefresh } = input;
        const identity = persistErpSyncAuthIdentity(data, target.terminalId);
        if (identity.terminalId && identity.terminalId !== target.terminalId) {
            this.operationalTargetHint.terminalId = identity.terminalId;
            console.info('POS_CANONICAL_TERMINAL_UPDATED', {
                previousTerminalId: target.terminalId,
                canonicalTerminalId: identity.terminalId,
            });
            console.info('local_terminal_id_replaced_with_canonical', {
                previousTerminalId: target.terminalId,
                canonicalTerminalId: identity.terminalId,
            });
        }
        if (erpSyncAuthRequiresFullBootstrap(data)) {
            clearErpIncrementalSyncState();
            markErpFullBootstrapRequired(data);
            this.resetCircuitBreaker();
        }

        const authPayload = extractErpRegisterAuth(data);
        const resolvedDeviceToken = authPayload.deviceToken || authPayload.terminalToken || authPayload.activationToken || null;
        const { token, expiresAt } = this.extractSyncTokenFromAuthResponse(data);
        const resolvedToken = authPayload.syncToken || token || String(data?.token || '');
        const resolvedExpiresAt = authPayload.tokenExpiresAt || expiresAt;
        const canonicalTerminalId =
            identity.terminalId
            || pickFirstString(
                data?.erp_terminal_id,
                data?.erpTerminalId,
                data?.terminal_id,
                data?.terminalId,
                data?.terminal?.erp_terminal_id,
                data?.terminal?.erpTerminalId,
                data?.terminal?.terminal_id,
                data?.terminal?.terminalId,
                data?.terminal?.id,
                data?.profile?.erp_terminal_id,
                data?.profile?.erpTerminalId,
                data?.profile?.terminal_id,
                data?.profile?.terminalId,
            )
            || target.terminalId;
        const deviceTokenSource = existingDeviceToken ? deviceTokenSourceWhenRefresh : deviceTokenSourceWhenNew;

        if (resolvedDeviceToken) {
            persistSyncDeviceToken(resolvedDeviceToken, deviceTokenSource, resolvedExpiresAt as string | null | undefined);
        }
        if (resolvedToken) {
            this.persistErpSyncToken(resolvedToken, resolvedExpiresAt);
        }
        if (resolvedDeviceToken || resolvedToken) {
            saveTerminalCredentialsSync({
                terminalId: canonicalTerminalId,
                erpTerminalId: canonicalTerminalId,
                terminalCode: pickFirstString(data?.terminalCode, data?.terminal_code, data?.terminal?.code, data?.terminal?.terminal_code),
                terminalName: pickFirstString(data?.terminalName, data?.terminal_name, data?.terminal?.name, data?.terminal?.terminal_name),
                deviceId,
                tenantId,
                erpTenantId: tenantId,
                cloudAdminTenantId: readTerminalCredentialsSync().cloudAdminTenantId || safeLocalStorageGet('cloud_admin_tenant_id') || safeLocalStorageGet('clic_cloud_admin_tenant_id') || null,
                authStatus: 'AUTHENTICATED',
                lastAuthError: null,
                ...(resolvedDeviceToken ? {
                    deviceToken: resolvedDeviceToken,
                    deviceTokenSource,
                    deviceTokenUpdatedAt: new Date().toISOString(),
                    deviceTokenExpiresAt: typeof resolvedExpiresAt === 'string' ? resolvedExpiresAt : null,
                } : {}),
                ...(resolvedToken ? {
                    syncToken: resolvedToken,
                    syncTokenUpdatedAt: new Date().toISOString(),
                    syncTokenExpiresAt: typeof resolvedExpiresAt === 'string' ? resolvedExpiresAt : null,
                } : {}),
            });
            setTerminalBindingDiagnosticStatus('BOUND');
            setSyncAuthDiagnosticStatus('AUTHENTICATED');
            safeLocalStorageSet('clic_sync_auth_status', 'AUTHENTICATED');
            this.clearStaleOperationalAuthFlags();
            console.info('pos_auth_success_clearing_reauth', {
                terminalId: canonicalTerminalId,
                erpTerminalId: canonicalTerminalId,
                deviceId,
                source: 'ERP_AUTH_RESPONSE',
            });
            console.info('pos_terminal_identity_persisted', {
                terminalId: canonicalTerminalId,
                erpTerminalId: canonicalTerminalId,
                deviceId,
                tenantId,
                source: 'ERP_AUTH_RESPONSE',
            });
            console.info('POS_REAUTH_SUCCEEDED', {
                terminalId: canonicalTerminalId,
                deviceId,
                deviceTokenPresent: Boolean(resolvedDeviceToken),
                syncTokenPresent: Boolean(resolvedToken),
            });
            console.info('POS_SYNC_RESUMED_AFTER_REAUTH', {
                terminalId: canonicalTerminalId,
                deviceId,
            });
            console.info('reauth_token_saved', {
                terminalId: canonicalTerminalId,
                deviceId,
                deviceTokenPresent: Boolean(resolvedDeviceToken),
                syncTokenPresent: Boolean(resolvedToken),
                source: deviceTokenSource,
            });
        }

        return {
            syncToken: sanitizeSyncToken(resolvedToken) || '',
            deviceToken: resolvedDeviceToken,
            canonicalTerminalId,
            expiresAt: resolvedExpiresAt,
        };
    }

    private async recoverErpCredentialsViaRegister(input: {
        target: { baseUrl: string; terminalId: string; useLocalTarget: boolean; kind: ResolvedSyncTarget['kind'] };
        deviceId: string | null;
        tenantId: string | null;
        existingDeviceToken: string | null;
        channel: CircuitBreakerChannel;
        operation: OperationalSyncOperation;
        reason: string;
    }): Promise<{ syncToken: string; deviceToken: string | null; canonicalTerminalId: string }> {
        const { target, deviceId, tenantId, existingDeviceToken, channel, operation, reason } = input;
        const credentials = readTerminalCredentialsSync();
        const endpoint = `${target.baseUrl}/terminals/register`;
        const cloudAdminTenantId = credentials.cloudAdminTenantId || safeLocalStorageGet('cloud_admin_tenant_id') || safeLocalStorageGet('clic_cloud_admin_tenant_id') || null;
        const attemptAt = new Date().toISOString();
        if (!deviceId) {
            const error = new Error('DEVICE_ID_REQUIRED: No hay device_id local para reautenticar esta terminal.');
            console.error('pos_device_id_missing', {
                terminalId: target.terminalId,
                tenantId,
                operation,
                endpoint: '/terminals/register',
            });
            throw this.markOperationalAuthNeedsReauth({
                operation,
                endpoint,
                error,
                backendCode: 'DEVICE_ID_REQUIRED',
                nextAction: 'RESTORE_DEVICE_ID',
                target,
            });
        }
        safeLocalStorageSet('clic_sync_last_reauth_attempt_at', attemptAt);
        saveTerminalCredentialsSync({
            lastReauthAttemptAt: attemptAt,
            authStatus: 'NEEDS_REAUTH',
            lastAuthError: reason,
        });
        const headers = {
            ...this.buildOperationalHeaders(target, '', true),
            ...this.getLocalDeviceHeaders(),
            ...(existingDeviceToken ? { 'X-Device-Token': existingDeviceToken } : {}),
        };

        console.info('pos_auth_started', {
            terminalId: target.terminalId,
            erpTerminalId: target.terminalId,
            deviceId,
            tenantId,
            endpoint: '/terminals/register',
            reason,
        });
        console.info('POS_REAUTH_STARTED', {
            terminalId: target.terminalId,
            erpTerminalId: target.terminalId,
            deviceId,
            tenantId,
            endpoint: '/terminals/register',
            reason,
        });
        console.info('reauth_started', {
            terminalId: target.terminalId,
            erpTerminalId: target.terminalId,
            deviceId,
            tenantId,
            endpoint: '/terminals/register',
            reason,
        });

        const response = await this.fetchWithRetry(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                terminalId: target.terminalId,
                terminal_id: target.terminalId,
                erp_terminal_id: target.terminalId,
                terminalName: credentials.terminalName || null,
                terminal_name: credentials.terminalName || null,
                terminalCode: credentials.terminalCode || null,
                terminal_code: credentials.terminalCode || null,
                local_terminal_id: credentials.terminalCode || credentials.terminalId || safeLocalStorageGet('active_terminal_id') || target.terminalId,
                contract_source: 'ERP_REGISTER',
                ...(existingDeviceToken ? { deviceToken: existingDeviceToken, device_token: existingDeviceToken } : {}),
                deviceId,
                device_id: deviceId,
                tenantId,
                tenant_id: tenantId,
                erp_tenant_id: tenantId,
                cloud_admin_tenant_id: cloudAdminTenantId,
                app_version: safeLocalStorageGet('CLIC_POS_APP_VERSION') || safeLocalStorageGet('app_version') || null,
                sync_capabilities: [VARIANT_PROMOTIONS_CAPABILITY],
                capabilities: [VARIANT_PROMOTIONS_CAPABILITY],
                capability_versions: POS_SYNC_CAPABILITY_VERSIONS,
                metadata: {
                    source: 'CLIC_POS_APK_REAUTH',
                    reauth: true,
                    reason,
                    terminal_id: target.terminalId,
                    erp_terminal_id: target.terminalId,
                    device_id: deviceId,
                },
            }),
        }, 2, 500, channel, operation);

        if (!response.ok) {
            await this.handleDeviceSupersededResponse(response, target.terminalId);
            const parsedError = await this.parseJsonResponseSafely(response);
            const backendCode = this.normalizeBackendCode(parsedError.data)
                || (this.isWaitingCloudAdminAuthResponse(response.status, parsedError.data, parsedError.text)
                    ? 'WAITING_CLOUD_ADMIN_REAUTHORIZATION'
                    : `HTTP_${response.status}`);
            if (this.isWaitingCloudAdminAuthResponse(response.status, parsedError.data, parsedError.text)) {
                const error = new Error('WAITING_CLOUD_ADMIN_REAUTHORIZATION: Este equipo todavía no está autorizado. Solicita reautorización desde Cloud-Admin.');
                console.warn('POS_REAUTH_FAILED', {
                    terminalId: target.terminalId,
                    deviceId,
                    backendCode,
                    httpStatus: response.status,
                    nextAction: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
                });
                throw this.markOperationalAuthNeedsReauth({
                    operation,
                    endpoint,
                    responseBody: parsedError.text,
                    httpStatus: response.status,
                    error,
                    backendCode,
                    nextAction: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
                    target,
                });
            }
            if (this.isDeviceTokenInvalidResponse(response.status, parsedError.data, parsedError.text)) {
                throw this.handleDeviceTokenInvalid({
                    operation,
                    endpoint,
                    response,
                    payload: parsedError.data,
                    responseBody: parsedError.text,
                    requestHeaders: headers,
                    tokenResolution: resolveSyncDeviceToken(),
                });
            }
            const errorData = parsedError.data;
            console.warn('POS_REAUTH_FAILED', {
                terminalId: target.terminalId,
                deviceId,
                backendCode,
                httpStatus: response.status,
            });
            throw new Error(`ERP reauthentication failed: ${response.status} ${response.statusText} - ${errorData?.message || errorData?.error || parsedError.text || 'unknown error'}`);
        }

        const data = await response.json();
        const persisted = this.persistErpAuthPayloadFromResponse({
            data,
            target,
            deviceId,
            tenantId,
            existingDeviceToken,
            deviceTokenSourceWhenNew: 'ERP_REGISTER_REAUTH',
            deviceTokenSourceWhenRefresh: 'ERP_REGISTER_REFRESH',
        });

        if (!persisted.syncToken && !persisted.deviceToken) {
            throw new Error('ERP reauthentication failed: register response did not include deviceToken or syncToken.');
        }

        return persisted;
    }

    private buildSyncTokenError(
        code: 'SYNC_TOKEN_MISSING_LOCAL' | 'SYNC_TOKEN_REJECTED',
        detail?: string
    ): Error {
        const message = code === 'SYNC_TOKEN_MISSING_LOCAL'
            ? 'SYNC_TOKEN_MISSING_LOCAL: No hay syncToken local para la terminal vinculada.'
            : 'SYNC_TOKEN_REJECTED: El ERP rechazó el token de sincronización.';
        return new Error(detail ? `${message} ${detail}` : message);
    }

    private buildProtectedPullError(input: {
        collection: string;
        endpoint: string;
        status: number;
        responseBody: string;
        headers: Record<string, string>;
        backendCode?: string | null;
    }): Error {
        const classification = classifyMasterPullFailure({
            collection: input.collection,
            status: input.status,
            backendCode: input.backendCode,
            responseBody: input.responseBody,
        });
        const error = this.attachSyncErrorMetadata(
            new Error(classification.message),
            input.collection,
            classification.backendCode,
            input.status,
        );
        reportSyncErrorDiagnostic({
            operation: 'PULL_MASTERS',
            collection: input.collection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            responseBody: input.responseBody,
            error,
            authStatus: classification.authStatus,
            backendCode: classification.backendCode,
            requestAuth: this.buildRequestAuthDiagnostic(input.headers),
            isMasterCollection: true,
            isOperationCollection: false,
            isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(input.collection),
            userVisibleSeverity: 'critical',
        });
        return this.markDiagnosticReported(error);
    }

    private normalizeBackendCode(payload: any): string | null {
        return pickFirstString(
            payload?.code,
            payload?.errorCode,
            payload?.error_code,
            payload?.statusCode,
            payload?.status_code,
            payload?.error?.code
        );
    }

    private async buildOperationalSyncAuthRejection(input: {
        response: Response;
        endpoint: string;
        target: { terminalId: string; baseUrl?: string | null };
    }): Promise<Error | null> {
        if (input.response.status !== 401 && input.response.status !== 403) return null;
        const parsed = await this.parseJsonResponseSafely(input.response);
        const backendCode = String(this.normalizeBackendCode(parsed.data) || '').toUpperCase();
        if (!['SYNC_TOKEN_MISSING', 'SYNC_TOKEN_INVALID', 'SYNC_SCOPE_FORBIDDEN'].includes(backendCode)) {
            return null;
        }

        const nextAction = backendCode === 'SYNC_SCOPE_FORBIDDEN'
            ? 'REPAIR_TERMINAL_SCOPE'
            : 'REPAIR_TERMINAL_PAIRING';
        const error = new Error(`${backendCode}: La sincronización requiere reautenticar o volver a vincular esta terminal.`);
        Object.defineProperties(error, {
            retryAfterMs: { value: 5 * 60_000, configurable: true },
            retryable: { value: true, configurable: true },
            backendCode: { value: backendCode, configurable: true },
        });
        return this.markOperationalAuthNeedsReauth({
            operation: 'PUSH_OPERATIONS',
            endpoint: input.endpoint,
            responseBody: parsed.text,
            httpStatus: input.response.status,
            error,
            backendCode,
            nextAction,
            target: input.target,
        });
    }

    private attachSyncErrorMetadata(error: Error, collection: string, backendCode: string, status?: number): Error {
        const taggedError = error as Error & {
            __syncBackendCode?: string;
            __syncCollection?: string;
            __syncHttpStatus?: number;
        };
        taggedError.__syncBackendCode = backendCode;
        taggedError.__syncCollection = collection;
        if (status) {
            taggedError.__syncHttpStatus = status;
        }
        return taggedError;
    }

    private getSyncErrorBackendCode(error: unknown): string | null {
        if (!error || typeof error !== 'object') return null;
        return (error as { __syncBackendCode?: string; backendCode?: string }).__syncBackendCode
            || (error as { backendCode?: string }).backendCode
            || null;
    }

    private parseResponsePayload(responseBody: string): any {
        if (!responseBody) return null;
        try {
            return JSON.parse(responseBody);
        } catch {
            return null;
        }
    }

    private isPaymentMethodsMissingError(input: {
        collection: string;
        backendCode: string | null;
        statusText: string;
        message?: string;
        supported?: boolean;
        critical?: boolean;
        status?: number;
    }): boolean {
        const normalizedCollection = (input.collection || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const normalizeCode = (code: string | null | undefined): string => String(code || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const normalizeMessage = String(input.message || '').toLowerCase();
        const normalizedBackendCode = normalizeCode(input.backendCode);
        const backendCodeHint =
            normalizedBackendCode === 'PAYMENT_METHODS_MISSING'
            || normalizedBackendCode === 'PAYMENTMETHODS_MISSING'
            || /PAYMENT[_\s-]?METHODS?[_\s-]?MISSING/.test(input.backendCode || '');
        if (normalizedCollection !== 'paymentmethods') return false;
        if (backendCodeHint || /payment methods missing/.test(normalizeMessage)) return true;
        if (input.supported === false && input.critical === true) return true;
        if (input.status === 409 && /m[eé]todo/i.test(normalizeMessage)) return true;
        if (/payment_methods_missing/i.test(input.statusText)) return true;
        if (/falta[mn]? met[oó]dos de pago|sin m[eé]todo|faltan m[eó]todos de pago/i.test(normalizeMessage)) return true;
        return false;
    }

    private normalizeBackendNextAction(payload: any): string | null {
        return pickFirstString(
            payload?.nextAction,
            payload?.next_action,
            payload?.error?.nextAction,
            payload?.error?.next_action,
        );
    }

    private isDeviceTokenInvalidResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 403) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'DEVICE_TOKEN_INVALID' || /device token invalid/i.test(message);
    }

    private isDeviceNotAuthorizedResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 403) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'DEVICE_NOT_AUTHORIZED' || /este equipo ya no es la terminal autorizada/i.test(message);
    }

    private isFiscalConfigMissingResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 409) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const collection = pickFirstString(payload?.collection, payload?.error?.collection);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'FISCAL_CONFIG_MISSING'
            || collection === 'fiscalSequences'
            || /falta configuraci[oó]n fiscal/i.test(message);
    }

    private logOptionalMasterUnavailable(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        reason: string;
    }): void {
        console.warn('[SYNC_COLLECTION_OPTIONAL_UNAVAILABLE]', {
            collection: input.collection,
            operation: input.operation,
            endpoint: input.endpoint,
            httpStatus: input.status,
            reason: input.reason,
            userVisibleSeverity: 'warning',
        });
    }

    private isBlockingOperationalAuthError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error || '');
        const backendCode = this.getSyncErrorBackendCode(error);
        return /AUTH_REQUIRED|AUTH_FAILED|SYNC_TOKEN|DEVICE_TOKEN|DEVICE_NOT_AUTHORIZED/i.test(message)
            || /AUTH_REQUIRED|AUTH_FAILED|SYNC_TOKEN|DEVICE_TOKEN|DEVICE_NOT_AUTHORIZED/i.test(String(backendCode || ''));
    }

    private markDiagnosticReported(error: Error): Error {
        try {
            Object.defineProperty(error, '__syncDiagnosticReported', {
                value: true,
                configurable: true,
                enumerable: false,
            });
        } catch {
            (error as any).__syncDiagnosticReported = true;
        }
        return error;
    }

    private wasDiagnosticReported(error: unknown): boolean {
        return Boolean(error && typeof error === 'object' && (error as any).__syncDiagnosticReported);
    }

    private handleFiscalConfigMissing(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
    }): Error {
        const isPosOnlyStaging = isPosOnlyCloudStagingTarget();
        const canIssueNonFiscalSales = safeLocalStorageGet('canIssueNonFiscalSales') === 'true'
            || safeLocalStorageGet('clic_can_issue_non_fiscal_sales') === 'true';
        if (!isPosOnlyStaging && !canIssueNonFiscalSales) {
            setCatalogDiagnosticStatus('FISCAL_CONFIG_MISSING');
            setSalesPushDiagnosticStatus('LOCKED_FISCAL_CONFIG_REQUIRED');
        } else if (canIssueNonFiscalSales) {
            setCatalogDiagnosticStatus('SYNCED');
            setSalesPushDiagnosticStatus('ENABLED');
        }

        const backendCode = this.normalizeBackendCode(input.payload) || 'FISCAL_CONFIG_MISSING';
        const backendNextAction = this.normalizeBackendNextAction(input.payload);
        const nextAction = canIssueNonFiscalSales
            ? 'CONFIGURE_FISCAL_OR_USE_NON_FISCAL_POLICY'
            : (backendNextAction || 'CONFIGURE_TERMINAL_FISCAL_SETTINGS');
        const baseMessage = 'FISCAL_CONFIG_MISSING: Falta configuración fiscal para esta terminal. Configura las series, rangos y consecutivos en el ERP.';
        const error = new Error(canIssueNonFiscalSales
            ? `${baseMessage} Las ventas no fiscales pueden habilitarse según la política de esta terminal.`
            : baseMessage);

        console.warn('[FISCAL_CONFIG_MISSING]', {
            collection: input.collection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            backendCode,
            catalogSyncStatus: isPosOnlyStaging ? 'unchanged' : 'FISCAL_CONFIG_MISSING',
            salesPushStatus: isPosOnlyStaging ? 'unchanged' : 'LOCKED_FISCAL_CONFIG_REQUIRED',
            canIssueNonFiscalSales,
            nextAction,
            posOnlyStagingIgnored: isPosOnlyStaging,
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            collection: input.collection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            responseBody: input.responseBody,
            error,
            backendCode,
            nextAction,
            requestAuth: this.buildRequestAuthDiagnostic(input.requestHeaders),
            isMasterCollection: true,
            isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(input.collection),
            userVisibleSeverity: isPosOnlyStaging ? 'warning' : 'critical',
            blockedByLocalGuard: isPosOnlyStaging,
            guardReason: isPosOnlyStaging ? 'POS_ONLY_FISCAL_PULL_IGNORED' : null,
        });

        return this.markDiagnosticReported(error);
    }

    private normalizeBackendDebugId(payload: any): string | null {
        return pickFirstString(
            payload?.debugId,
            payload?.debug_id,
            payload?.error?.debugId,
            payload?.error?.debug_id,
        );
    }

    private resolveFailedMasterCollection(requestCollection: string, payload: any): string {
        return pickFirstString(
            payload?.collection,
            payload?.error?.collection,
            requestCollection,
        ) || requestCollection || 'desconocida';
    }

    private isMasterCollectionPullFailedResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 500) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'SYNC_COLLECTION_PULL_FAILED'
            || /sync_collection_pull_failed/i.test(message);
    }

    private throwIfKnownMasterPullFailure(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
    }): void {
        if (input.payload?.supported === false) {
            markErpMasterCollectionUnsupported(input.collection, {
                operation: input.operation,
                endpoint: input.endpoint,
                httpStatus: input.status,
                reason: 'ERP_DECLARED_UNSUPPORTED',
                userVisibleSeverity: 'warning',
            });
            return;
        }
        if (this.isFiscalConfigMissingResponse(input.status, input.payload, input.responseBody)) {
            throw this.handleFiscalConfigMissing(input);
        }
        if (this.isMasterCollectionPullFailedResponse(input.status, input.payload, input.responseBody)) {
            throw this.handleMasterCollectionPullFailed(input);
        }
    }

    private handleMasterCollectionPullFailed(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
    }): Error {
        const isPosOnlyStaging = isPosOnlyCloudStagingTarget();
        if (!isPosOnlyStaging) {
            setCatalogDiagnosticStatus('ERP_MASTER_PULL_FAILED');
            setSalesPushDiagnosticStatus('LOCKED_MASTER_SYNC_REQUIRED');
        }

        const backendCode = this.normalizeBackendCode(input.payload) || 'SYNC_COLLECTION_PULL_FAILED';
        const failedCollection = this.resolveFailedMasterCollection(input.collection, input.payload);
        const debugId = this.normalizeBackendDebugId(input.payload);
        const baseMessage = `SYNC_COLLECTION_PULL_FAILED: El ERP falló al generar la colección ${failedCollection}. Revisa el backend ERP.`;
        const error = new Error(debugId ? `${baseMessage} (debugId: ${debugId})` : baseMessage);

        console.warn('[ERP_MASTER_PULL_FAILED]', {
            collection: failedCollection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            backendCode,
            debugId,
            catalogSyncStatus: isPosOnlyStaging ? 'unchanged' : 'ERP_MASTER_PULL_FAILED',
            salesPushStatus: isPosOnlyStaging ? 'unchanged' : 'LOCKED_MASTER_SYNC_REQUIRED',
            posOnlyStagingIgnored: isPosOnlyStaging,
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            collection: failedCollection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            responseBody: input.responseBody,
            error,
            backendCode,
            debugId,
            requestAuth: this.buildRequestAuthDiagnostic(input.requestHeaders),
            isMasterCollection: true,
            isOperationCollection: false,
            isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(failedCollection),
            userVisibleSeverity: isPosOnlyStaging ? 'warning' : 'critical',
            blockedByLocalGuard: isPosOnlyStaging,
            guardReason: isPosOnlyStaging ? 'POS_ONLY_MASTER_PULL_IGNORED' : null,
        });

        return this.markDiagnosticReported(error);
    }

    private async parseJsonResponseSafely(response: Response): Promise<{ data: any; text: string }> {
        const text = await response.text().catch(() => '');
        if (!text) return { data: null, text: '' };
        try {
            return { data: JSON.parse(text), text };
        } catch {
            return { data: null, text };
        }
    }

    private handleDeviceTokenInvalid(input: {
        operation: OperationalSyncOperation;
        endpoint: string;
        response: Response;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
        tokenResolution: ReturnType<typeof resolveSyncDeviceToken>;
    }): Error {
        this.erpAuthToken = null;
        this.clearCanonicalErpSyncToken();
        markSyncDeviceTokenInvalid('DEVICE_TOKEN_INVALID');
        setTerminalBindingDiagnosticStatus('TOKEN_INVALID');
        setCatalogDiagnosticStatus('AUTH_ERROR');
        setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
        setSyncAuthDiagnosticStatus('DEVICE_TOKEN_INVALID');

        const backendCode = this.normalizeBackendCode(input.payload) || 'DEVICE_TOKEN_INVALID';
        const error = new Error('DEVICE_TOKEN_INVALID: El token de esta terminal no coincide con el registrado en el ERP. Debe renovarse el token de terminal o revincular la caja.');
        console.warn('[DEVICE_TOKEN_INVALID]', {
            endpoint: input.endpoint,
            terminalId: this.resolveOperationalTarget(input.operation)?.terminalId || null,
            deviceId: this.resolveCurrentDeviceId(),
            tokenPresent: Boolean(input.tokenResolution.token),
            tokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            tokenSource: input.tokenResolution.sourceKey,
            tokenUpdatedAt: input.tokenResolution.updatedAt || null,
            backendCode,
            nextAction: 'ROTATE_DEVICE_TOKEN_OR_REBIND',
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            endpoint: input.endpoint,
            httpStatus: input.response.status,
            responseBody: input.responseBody,
            error,
            authStatus: 'DEVICE_TOKEN_INVALID',
            backendCode,
            nextAction: 'ROTATE_DEVICE_TOKEN_OR_REBIND',
            requestAuth: {
                ...this.buildRequestAuthDiagnostic(input.requestHeaders),
                syncTokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            },
            userVisibleSeverity: 'critical',
        });

        return error;
    }

    private handleDeviceNotAuthorized(input: {
        operation: OperationalSyncOperation;
        endpoint: string;
        response: Response;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
        tokenResolution: ReturnType<typeof resolveSyncDeviceToken>;
    }): Error {
        this.erpAuthToken = null;
        this.clearCanonicalErpSyncToken();
        setTerminalBindingDiagnosticStatus('BOUND_AUTH_MISMATCH');
        setCatalogDiagnosticStatus('AUTH_ERROR');
        setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
        setSyncAuthDiagnosticStatus('DEVICE_NOT_AUTHORIZED');

        const backendCode = this.normalizeBackendCode(input.payload) || 'DEVICE_NOT_AUTHORIZED';
        const error = new Error('DEVICE_NOT_AUTHORIZED: Esta Caja está vinculada, pero este equipo no está autorizado en el ERP. Solicita reautorización desde Cloud-Admin o usa un código de vinculación.');
        console.warn('[DEVICE_NOT_AUTHORIZED]', {
            endpoint: input.endpoint,
            terminalId: this.resolveOperationalTarget(input.operation)?.terminalId || null,
            deviceId: this.resolveCurrentDeviceId(),
            tokenPresent: Boolean(input.tokenResolution.token),
            tokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            tokenSource: input.tokenResolution.sourceKey,
            tokenUpdatedAt: input.tokenResolution.updatedAt || null,
            backendCode,
            canTakeover: true,
            nextAction: 'REAUTHORIZE_TERMINAL',
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            endpoint: input.endpoint,
            httpStatus: input.response.status,
            responseBody: input.responseBody,
            error,
            authStatus: 'DEVICE_NOT_AUTHORIZED',
            backendCode,
            nextAction: 'REAUTHORIZE_TERMINAL',
            requestAuth: {
                ...this.buildRequestAuthDiagnostic(input.requestHeaders),
                syncTokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            },
            fetchDiagnostic: {
                fetchStage: 'RESPONSE_RECEIVED',
                method: 'POST',
                endpoint: input.endpoint,
                tokenPresent: Boolean(input.tokenResolution.token),
                tokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
                tokenLength: input.tokenResolution.token?.length || 0,
                tokenSource: input.tokenResolution.sourceKey,
                tokenUpdatedAt: input.tokenResolution.updatedAt || null,
                headersPresent: {
                    authorization: false,
                    xSyncToken: false,
                    xTerminalId: Boolean(input.requestHeaders['X-Terminal-Id']),
                    xDeviceId: Boolean(input.requestHeaders['X-Device-Id']),
                    xDeviceToken: Boolean(input.requestHeaders['X-Device-Token']),
                },
                networkOnline: typeof navigator !== 'undefined' ? navigator.onLine : null,
            },
            userVisibleSeverity: 'critical',
        });

        return error;
    }

    private buildOperationalPostBody(
        target: { terminalId: string; useLocalTarget: boolean; kind?: string },
        body: Record<string, unknown>
    ): Record<string, unknown> {
        if (target.useLocalTarget) return body;

        const deviceId = this.resolveCurrentDeviceId();
        const tenantId = this.resolveCurrentTenantId();
        const credentials = readTerminalCredentialsSync();
        const companyId = pickFirstString(credentials.companyId, safeLocalStorageGet('clic_erp_sync_company_id'));
        const storeId = pickFirstString(credentials.storeId, safeLocalStorageGet('clic_erp_sync_store_id'));

        const normalizedBody: Record<string, unknown> = {
            ...body,
            terminalId: target.terminalId,
            terminal_id: target.terminalId,
            ...(tenantId ? { tenantId, tenant_id: tenantId } : {}),
            ...(companyId ? { companyId, company_id: companyId } : {}),
            ...(storeId ? { storeId, store_id: storeId } : {}),
            ...(target.kind ? { sync_channel: target.kind } : {}),
            ...(deviceId ? { device_id: deviceId, deviceId } : {})
        };

        if (Array.isArray(body.items)) {
            normalizedBody.items = body.items.map((item) => {
                const record = item && typeof item === 'object' && !Array.isArray(item)
                    ? item as Record<string, unknown>
                    : {};
                const localTerminalId = String(
                    record.local_terminal_id
                    || record.localTerminalId
                    || record.source_terminal_id
                    || record.terminalId
                    || ''
                ).trim();
                const normalizedPayments = Array.isArray((record as any).payments)
                    ? (record as any).payments.map((payment: unknown) => {
                        const paymentRecord = payment && typeof payment === 'object' && !Array.isArray(payment)
                            ? payment as Record<string, unknown>
                            : {};
                        const paymentLocalTerminalId = String(
                            paymentRecord.local_terminal_id
                            || paymentRecord.localTerminalId
                            || paymentRecord.source_terminal_id
                            || paymentRecord.terminalId
                            || localTerminalId
                            || ''
                        ).trim();

                        return {
                            ...paymentRecord,
                            terminalId: target.terminalId,
                            terminal_id: target.terminalId,
                            erp_terminal_id: target.terminalId,
                            source_terminal_id: target.terminalId,
                            ...(paymentLocalTerminalId && paymentLocalTerminalId !== target.terminalId
                                ? { local_terminal_id: paymentLocalTerminalId, localTerminalId: paymentLocalTerminalId }
                                : {}),
                            ...(deviceId ? { device_id: deviceId } : {})
                        };
                    })
                    : (record as any).payments;

                return {
                    ...record,
                    terminalId: target.terminalId,
                    terminal_id: target.terminalId,
                    erp_terminal_id: target.terminalId,
                    source_terminal_id: target.terminalId,
                    ...(localTerminalId && localTerminalId !== target.terminalId
                        ? { local_terminal_id: localTerminalId, localTerminalId }
                        : {}),
                    ...(normalizedPayments ? { payments: normalizedPayments } : {}),
                    ...(deviceId ? { device_id: deviceId } : {})
                };
            });
        }

        return normalizedBody;
    }

    private buildCloudStagingMasterPushBody(
        target: {
            terminalId: string;
            useLocalTarget: boolean;
            kind: ResolvedSyncTarget['kind'];
        },
        collection: string,
        items: any[],
        mode: 'UPSERT' | 'FULL_REPLACE',
        action: SyncChange['action']
    ): Record<string, unknown> {
        return this.buildOperationalPostBody(target, {
            items,
            mode,
            action,
            source: 'POS',
            master_type: collection,
            collection,
        });
    }

    private async finishCloudStagingPushResponse(
        response: Response,
        collection: string,
        itemCount: number,
        phase: 'initial' | 'reauth' = 'initial'
    ): Promise<void> {
        const phaseLabel = phase === 'reauth' ? ' after re-auth' : '';

        if (response.ok) {
            console.log(`📤 ApiSyncAdapter: Staged ${itemCount} ${collection} item(s)${phaseLabel} to cloud.`);
            return;
        }

        if (response.status === 404 || response.status === 405) {
            console.warn(`[POS_CLOUD_STAGING] push skipped collection=${collection} (${response.status})${phaseLabel}.`);
            return;
        }

        const detail = await response.text().catch(() => '');
        const isServerSchemaError = /22P02|invalid input syntax for type uuid|cloud-staging-master-/i.test(detail);

        if (response.status >= 500 || isServerSchemaError) {
            console.warn(
                `[POS_CLOUD_STAGING] push deferred collection=${collection} server=${response.status}${phaseLabel}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
            );
            return;
        }

        throw new Error(
            `Cloud staging push failed${phaseLabel}: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
        );
    }

    private resolveOperationalTarget(
        operation: OperationalSyncOperation = 'PUSH_OPERATIONS'
    ): ({ baseUrl: string; terminalId: string; useLocalTarget: boolean; kind: ResolvedSyncTarget['kind'] }) | null {
        const routedTarget = resolveSyncTarget();
        console.log(
            `[SYNC_ROUTER] operation=${operation} kind=${routedTarget.kind} dataMaster=${routedTarget.dataMaster} customerErpAccess=${routedTarget.customerErpAccess ? 'yes' : 'no'} canPullMasters=${routedTarget.canPullMasters ? 'yes' : 'no'} canPushOperations=${routedTarget.canPushOperations ? 'yes' : 'no'} reason=${routedTarget.reason || 'OK'}`
        );

        const canRunOperation =
            operation === 'PULL_MASTERS'
                ? routedTarget.canPullMasters
                : operation === 'PULL_CONFIG'
                    ? routedTarget.canPullMasters
                    : operation === 'PUSH_MASTERS'
                        ? routedTarget.canPushMasters
                        : routedTarget.canPushOperations;

        if (routedTarget.kind === 'NONE' || !canRunOperation) {
            console.warn(
                `[SYNC_ROUTER] operation=${operation} blocked locally kind=${routedTarget.kind} reason=${routedTarget.reason || 'INSUFFICIENT_SYNC_PERMISSION'} canPullMasters=${routedTarget.canPullMasters ? 'yes' : 'no'} canPushOperations=${routedTarget.canPushOperations ? 'yes' : 'no'}`
            );
            return null;
        }

        if (routedTarget.baseUrl && routedTarget.terminalId) {
            const credentials = readTerminalCredentialsSync();
            const credentialTerminalId = String(
                credentials.erpTerminalId
                || credentials.terminalId
                || ''
            ).trim();
            const terminalId = routedTarget.useLocalTarget
                ? routedTarget.terminalId
                : (credentialTerminalId || routedTarget.terminalId);
            if (!routedTarget.useLocalTarget && credentialTerminalId && credentialTerminalId !== routedTarget.terminalId) {
                console.info('[SYNC_ROUTER] canonical ERP terminal selected from credentials', {
                    routedTerminalId: routedTarget.terminalId,
                    credentialTerminalId,
                });
            }
            return {
                baseUrl: routedTarget.baseUrl,
                terminalId,
                useLocalTarget: routedTarget.kind === 'POS_MASTER',
                kind: routedTarget.kind,
            };
        }

        const localMasterTarget: { baseUrl: string; terminalId: string; useLocalTarget: boolean } | null = this.config?.masterUrl && this.config?.terminalId
            ? {
                baseUrl: this.buildSyncApiBase(this.config.masterUrl),
                terminalId: this.config.terminalId,
                useLocalTarget: true
            }
            : null;

        if (localMasterTarget && permissionService.isSlaveTerminal()) {
            return { ...localMasterTarget, kind: 'POS_MASTER' };
        }

        return localMasterTarget ? { ...localMasterTarget, kind: 'POS_MASTER' } : null;
    }

    private canUseLocalMasterSyncFallback(): boolean {
        const routedTarget = resolveSyncTarget();
        if (routedTarget.kind !== 'POS_MASTER') {
            return false;
        }

        if (!this.config?.masterUrl) {
            return false;
        }

        try {
            const hostname = new URL(this.config.masterUrl).hostname;
            if (isNativeAndroidRuntime() && isLoopbackHost(hostname)) {
                return false;
            }
        } catch {
            return false;
        }

        return true;
    }

    private buildEmptyDeltaResult(sinceVersion?: number): PullDeltaResult {
        return {
            items: [],
            serverTime: new Date().toISOString(),
            isFullDownload: false,
            latestVersion: sinceVersion || 0,
        };
    }

    private async authenticateOperationalTarget(
        force = false,
        channel: CircuitBreakerChannel = 'background',
        operation: OperationalSyncOperation = channel === 'sales' ? 'PUSH_OPERATIONS' : 'PULL_MASTERS'
    ): Promise<{
        baseUrl: string;
        terminalId: string;
        token: string;
        useLocalTarget: boolean;
        kind: ResolvedSyncTarget['kind'];
    }> {
        const target = this.resolveOperationalTarget(operation);
        if (!target) {
            const routedTarget = resolveSyncTarget();
            const guardReason = routedTarget.reason || 'INSUFFICIENT_SYNC_PERMISSION';
            const error = new Error(
                operation === 'PULL_MASTERS' || operation === 'PULL_CONFIG'
                    ? 'No se pudo iniciar descarga de maestros'
                    : 'Operational sync target is not configured'
            );
            reportSyncErrorDiagnostic({
                operation,
                endpoint: null,
                httpStatus: null,
                error,
                blockedByLocalGuard: true,
                guardReason,
            });
            throw error;
        }

        if (target.useLocalTarget) {
            if (!this.authToken || force) {
                await this.authenticate(force, channel);
            }

            if (!this.authToken) {
                throw new Error('Operational sync token unavailable for local target');
            }

            return {
                ...target,
                token: this.authToken
            };
        }

        if (!navigator.onLine) {
            throw new Error('Browser offline');
        }

        const localAuthStatus = String(safeLocalStorageGet('clic_sync_auth_status') || '').toUpperCase();
        if (!force && ['DEVICE_NOT_AUTHORIZED', 'NEEDS_REAUTH', 'BOUND_AUTH_MISMATCH', 'DEVICE_TOKEN_MISSING_LOCAL', 'LOCKED_AUTH_REQUIRED', 'AUTH_ERROR'].includes(localAuthStatus)) {
            const deviceId = this.resolveCurrentDeviceId();
            const deviceTokenResolution = resolveSyncDeviceToken();
            const tenantId = this.resolveCurrentTenantId();
            const deviceWasSuperseded = isTerminalAuthorizationSuperseded();
            console.warn('POS_AUTH_MISMATCH_DETECTED', {
                terminalId: target.terminalId,
                deviceId,
                authStatus: localAuthStatus,
                deviceWasSuperseded,
            });
            if (!deviceWasSuperseded && this.reconcileStaleOperationalAuthState({
                target,
                staleStatus: localAuthStatus,
                deviceId,
                deviceTokenPresent: Boolean(deviceTokenResolution.token),
            })) {
                const storedToken = this.resolveStoredErpSyncToken();
                if (storedToken) {
                    return {
                        ...target,
                        token: storedToken,
                    };
                }
            }
            if (!deviceWasSuperseded && this.canAttemptOperationalReauth()) {
                const recovered = await this.recoverErpCredentialsViaRegister({
                    target,
                    deviceId,
                    tenantId,
                    existingDeviceToken: deviceTokenResolution.token,
                    channel,
                    operation,
                    reason: localAuthStatus || 'NEEDS_REAUTH',
                });
                if (recovered.syncToken) {
                    this.erpAuthToken = recovered.syncToken;
                    return {
                        ...target,
                        terminalId: recovered.canonicalTerminalId || target.terminalId,
                        token: recovered.syncToken,
                    };
                }
            }
            const error = new Error('DEVICE_NOT_AUTHORIZED: Esta Caja está vinculada, pero este equipo no está autorizado en el ERP. Solicita reautorización desde Cloud-Admin o usa un código de vinculación.');
            this.markOperationalAuthNeedsReauth({
                operation,
                endpoint: `${target.baseUrl}/auth`,
                httpStatus: null,
                error,
                backendCode: 'DEVICE_NOT_AUTHORIZED',
                nextAction: 'REAUTHORIZE_TERMINAL',
                target,
            });
            throw error;
        }

        if (!force && this.erpAuthToken) {
            return {
                ...target,
                token: this.erpAuthToken
            };
        }

        if (!force) {
            const storedToken = this.resolveStoredErpSyncToken();
            if (storedToken) {
                this.erpAuthToken = storedToken;
                return {
                    ...target,
                    token: storedToken
                };
            }
        }

        if (!force && this.erpAuthInFlight[channel]) {
            const token = await this.erpAuthInFlight[channel]!;
            return {
                ...target,
                token
            };
        }

        const erpAuthPromise = (async () => {
            const deviceId = this.resolveCurrentDeviceId();
            const tenantId = this.resolveCurrentTenantId();
            const deviceTokenResolution = resolveSyncDeviceToken();
            let deviceToken = deviceTokenResolution.token;
            const storedSyncTokenDiagnostic = this.resolveStoredErpSyncTokenDiagnostic();
            console.info('pos_device_id_loaded', {
                terminalId: target.terminalId,
                deviceId,
                tenantId,
                source: deviceId ? 'PERSISTENT_STORAGE' : 'MISSING',
            });
            if (!deviceId) {
                const error = new Error('DEVICE_ID_REQUIRED: No hay device_id local para autenticar esta terminal. Reinicia la identidad del dispositivo o vuelve a abrir el POS.');
                console.error('pos_device_id_missing', {
                    terminalId: target.terminalId,
                    tenantId,
                    operation,
                });
                throw this.markOperationalAuthNeedsReauth({
                    operation,
                    endpoint: `${target.baseUrl}/auth`,
                    error,
                    backendCode: 'DEVICE_ID_REQUIRED',
                    nextAction: 'RESTORE_DEVICE_ID',
                    target,
                });
            }
            console.log('[SYNC_AUTH_PREPARE]', {
                baseUrl: target.baseUrl,
                terminalId: target.terminalId,
                deviceId,
                tokenPresent: Boolean(deviceToken),
                tokenSource: deviceTokenResolution.sourceKey,
                tokenLength: deviceToken?.length || 0,
                tokenUpdatedAt: deviceTokenResolution.updatedAt || null,
                syncTokenPresent: Boolean(storedSyncTokenDiagnostic.token),
            });

            if (!deviceToken) {
                console.warn('local_bound_missing_token_detected', {
                    terminalId: target.terminalId,
                    deviceId,
                    tenantId,
                });
                setTerminalBindingDiagnosticStatus('NEEDS_REAUTH');
                setSyncAuthDiagnosticStatus('NEEDS_REAUTH');
                console.warn('[SYNC_AUTH_REAUTH_REQUIRED]', {
                    reason: 'DEVICE_TOKEN_MISSING_LOCAL',
                    terminalId: target.terminalId,
                    deviceId,
                    tenantId,
                });
                if (!this.canAttemptOperationalReauth()) {
                    const error = new Error('DEVICE_TOKEN_MISSING_LOCAL: Esta caja necesita reautorización. Reintenta autorización o aprueba el equipo desde Cloud-Admin.');
                    throw this.markOperationalAuthNeedsReauth({
                        operation,
                        endpoint: `${target.baseUrl}/terminals/register`,
                        error,
                        backendCode: 'DEVICE_TOKEN_MISSING_LOCAL',
                        nextAction: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
                        target,
                    });
                }
                const recovered = await this.recoverErpCredentialsViaRegister({
                    target,
                    deviceId,
                    tenantId,
                    existingDeviceToken: null,
                    channel,
                    operation,
                    reason: 'DEVICE_TOKEN_MISSING_LOCAL',
                });
                if (recovered.deviceToken) {
                    deviceToken = recovered.deviceToken;
                }
                if (recovered.syncToken) {
                    return recovered.syncToken;
                }
            }

            const authEndpoint = `${target.baseUrl}/auth`;
            console.info('pos_auth_started', {
                terminalId: target.terminalId,
                erpTerminalId: target.terminalId,
                deviceId,
                tenantId,
                endpoint: '/auth',
            });
            console.info('reauth_started', {
                terminalId: target.terminalId,
                erpTerminalId: target.terminalId,
                deviceId,
                tenantId,
            });
            const authHeaders = {
                ...this.buildOperationalHeaders(target, '', true),
                ...this.getLocalDeviceHeaders(),
                ...(deviceToken ? { 'X-Device-Token': deviceToken } : {}),
            };
            const response = await this.fetchWithRetry(authEndpoint, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    terminalId: target.terminalId,
                    terminal_id: target.terminalId,
                    erp_terminal_id: target.terminalId,
                    ...(deviceToken ? { deviceToken, device_token: deviceToken } : {}),
                    deviceId,
                    device_id: deviceId,
                    tenantId,
                    tenant_id: tenantId,
                    erp_tenant_id: tenantId,
                    cloud_admin_tenant_id: readTerminalCredentialsSync().cloudAdminTenantId || safeLocalStorageGet('cloud_admin_tenant_id') || safeLocalStorageGet('clic_cloud_admin_tenant_id') || null,
                    app_version: safeLocalStorageGet('CLIC_POS_APP_VERSION') || safeLocalStorageGet('app_version') || null,
                })
            }, 2, 500, channel, operation);

            if (!response.ok) {
                await this.handleDeviceSupersededResponse(response, target.terminalId);
                let errorMessage = `ERP authentication failed: ${response.status} ${response.statusText}`;
                const parsedError = await this.parseJsonResponseSafely(response);
                if (this.isRecoverableAuthResponse(response.status, parsedError.data, parsedError.text)) {
                    const backendCode = this.normalizeBackendCode(parsedError.data) || 'BOUND_AUTH_MISMATCH';
                    console.warn('POS_AUTH_MISMATCH_DETECTED', {
                        terminalId: target.terminalId,
                        deviceId,
                        tenantId,
                        backendCode,
                        httpStatus: response.status,
                    });
                    if (this.canAttemptOperationalReauth()) {
                        const recovered = await this.recoverErpCredentialsViaRegister({
                            target,
                            deviceId,
                            tenantId,
                            existingDeviceToken: deviceToken,
                            channel,
                            operation,
                            reason: backendCode,
                        });
                        if (recovered.syncToken) {
                            return recovered.syncToken;
                        }
                        if (recovered.deviceToken) {
                            deviceToken = recovered.deviceToken;
                        }
                    }
                    const error = new Error('WAITING_CLOUD_ADMIN_REAUTHORIZATION: Esta caja necesita reautorización. Solicita reautorización desde Cloud-Admin.');
                    console.warn('pos_auth_blocked_by_erp', {
                        terminalId: target.terminalId,
                        deviceId,
                        tenantId,
                        backendCode,
                        httpStatus: response.status,
                        nextAction: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
                    });
                    throw this.markOperationalAuthNeedsReauth({
                        operation,
                        endpoint: authEndpoint,
                        responseBody: parsedError.text,
                        httpStatus: response.status,
                        error,
                        backendCode,
                        nextAction: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
                        target,
                    });
                }
                if (this.isDeviceTokenInvalidResponse(response.status, parsedError.data, parsedError.text)) {
                    throw this.handleDeviceTokenInvalid({
                        operation,
                        endpoint: authEndpoint,
                        response,
                        payload: parsedError.data,
                        responseBody: parsedError.text,
                        requestHeaders: authHeaders,
                        tokenResolution: deviceTokenResolution,
                    });
                }
                if (this.isDeviceTokenRequiredResponse(response.status, parsedError.data, parsedError.text)) {
                    const recovered = await this.recoverErpCredentialsViaRegister({
                        target,
                        deviceId,
                        tenantId,
                        existingDeviceToken: deviceToken,
                        channel,
                        operation,
                        reason: 'DEVICE_TOKEN_REQUIRED_BY_AUTH',
                    });
                    if (recovered.syncToken) {
                        return recovered.syncToken;
                    }
                    if (recovered.deviceToken) {
                        deviceToken = recovered.deviceToken;
                    }
                }
                const errorData = parsedError.data;
                errorMessage += ` - ${errorData?.message || errorData?.error || parsedError.text || 'unknown error'}`;
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return this.persistErpAuthPayloadFromResponse({
                data,
                target,
                deviceId,
                tenantId,
                existingDeviceToken: deviceToken,
                deviceTokenSourceWhenNew: 'ERP_AUTH_REAUTH',
                deviceTokenSourceWhenRefresh: 'ERP_AUTH_REFRESH',
            }).syncToken;
        })();

        this.erpAuthInFlight[channel] = erpAuthPromise.finally(() => {
            this.erpAuthInFlight[channel] = null;
        });

        try {
            this.erpAuthToken = await this.erpAuthInFlight[channel]!;
        } catch (error) {
            this.logAuthFailure('erp', error);
            throw error;
        }

        if (!this.erpAuthToken) {
            const error = this.buildSyncTokenError('SYNC_TOKEN_MISSING_LOCAL');
            reportSyncErrorDiagnostic({
                operation,
                endpoint: `${target.baseUrl}/auth`,
                httpStatus: null,
                error,
                requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, '', true)),
            });
            throw error;
        }

        const refreshedTarget = this.resolveOperationalTarget() || target;

        return {
            ...refreshedTarget,
            token: this.erpAuthToken
        };
    }

    async refreshOperationalAuthorization(): Promise<void> {
        const target = await this.authenticateOperationalTarget(true, 'background', 'PUSH_OPERATIONS');
        if (!target.token) {
            throw new Error('Operational sync token unavailable after refresh');
        }
    }

    private async parseOperationalResponse(response: Response): Promise<any> {
        const text = await response.clone().text().catch(() => '');
        if (!text.trim()) return null;
        try {
            return JSON.parse(text);
        } catch {
            return { raw: text.slice(0, 400) };
        }
    }

    private async postOperationalPayload(
        path: string,
        body: Record<string, unknown>,
        options: {
            maxRequestBytes?: number;
            acceptCompressedResponse?: boolean;
            includeHttpStatus?: boolean;
            reauthenticateOn401?: boolean;
            expectedRecoveryScope?: string;
            recoveryOriginal?: { document: any; collection: string };
        } = {},
    ): Promise<any> {
        const target = await this.authenticateOperationalTarget(false, 'sales', 'PUSH_OPERATIONS');
        if (options.expectedRecoveryScope && originalProvenance().key !== options.expectedRecoveryScope) {
            throw new Error('RECOVERY_SCOPE_CHANGED');
        }
        const requestBody = this.buildOperationalPostBody(target, body);
        if (options.recoveryOriginal && isSyncFeatureEnabled('pending_operations_recovery')) {
            const { prepareCommercialOriginalReference } = await import('../recovery/recoveryService');
            const reference = await prepareCommercialOriginalReference(options.recoveryOriginal.document, (requestBody.items as unknown[])[0], options.recoveryOriginal.collection);
            if (reference) requestBody.originalRefs = [{ itemIndex: 0, ...reference }];
        }
        const serializedBody = JSON.stringify(requestBody);
        if (options.maxRequestBytes && new TextEncoder().encode(serializedBody).byteLength > options.maxRequestBytes) {
            throw new Error(`BATCH_PAYLOAD_TOO_LARGE: request exceeds ${options.maxRequestBytes} bytes`);
        }
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            method: 'POST',
            headers: {
                ...this.buildOperationalHeaders(target, target.token, true),
                ...this.getLocalDeviceHeaders(),
                ...(options.acceptCompressedResponse && this.resolveCapacitorPlatform() !== 'web'
                    ? { 'Accept-Encoding': 'gzip' }
                    : {}),
            },
            body: serializedBody
        }, 2, 500, 'sales', 'PUSH_OPERATIONS');

        if (response.status === 401 && options.reauthenticateOn401 !== false) {
            if (target.useLocalTarget) {
                this.authToken = null;
            } else {
                this.erpAuthToken = null;
            }

            const retriedTarget = await this.authenticateOperationalTarget(true, 'sales', 'PUSH_OPERATIONS');
            const retryBody = this.buildOperationalPostBody(retriedTarget, body);
            const serializedRetryBody = JSON.stringify(retryBody);
            if (options.maxRequestBytes && new TextEncoder().encode(serializedRetryBody).byteLength > options.maxRequestBytes) {
                throw new Error(`BATCH_PAYLOAD_TOO_LARGE: request exceeds ${options.maxRequestBytes} bytes after re-auth`);
            }
            const retryResponse = await this.fetchWithRetry(`${retriedTarget.baseUrl}${path}`, {
                method: 'POST',
                headers: {
                    ...this.buildOperationalHeaders(retriedTarget, retriedTarget.token, true),
                    ...this.getLocalDeviceHeaders(),
                    ...(options.acceptCompressedResponse && this.resolveCapacitorPlatform() !== 'web'
                        ? { 'Accept-Encoding': 'gzip' }
                        : {}),
                },
                body: serializedRetryBody
            }, 2, 500, 'sales', 'PUSH_OPERATIONS');

            if (!retryResponse.ok) {
                const retryText = await retryResponse.clone().text().catch(() => '');
                await this.handleDeviceSupersededResponse(retryResponse, retriedTarget.terminalId);
                const authRejection = await this.buildOperationalSyncAuthRejection({
                    response: retryResponse,
                    endpoint: `${retriedTarget.baseUrl}${path}`,
                    target: retriedTarget,
                });
                if (authRejection) throw authRejection;
                throw new Error(`Operational sync failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}${retryText ? ` — ${retryText.slice(0, 400)}` : ''}`);
            }

            const data = await this.parseOperationalResponse(retryResponse);
            return options.includeHttpStatus ? { httpStatus: retryResponse.status, data } : data;
        }

        if (!response.ok) {
            const text = await response.clone().text().catch(() => '');
            await this.handleDeviceSupersededResponse(response, target.terminalId);
            const authRejection = await this.buildOperationalSyncAuthRejection({
                response,
                endpoint: `${target.baseUrl}${path}`,
                target,
            });
            if (authRejection) throw authRejection;
            throw new Error(`Operational sync failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`);
        }
        const data = await this.parseOperationalResponse(response);
        return options.includeHttpStatus ? { httpStatus: response.status, data } : data;
    }

    async postTransferReceipt(
        transferId: string,
        payload: Record<string, any>,
    ): Promise<{ httpStatus: number; data: Record<string, any> }> {
        const normalizedTransferId = String(transferId || '').trim();
        if (!normalizedTransferId) throw new Error('TRANSFER_RECEIPT_TRANSFER_ID_MISSING');
        if (payload?.closeWithDiscrepancy !== false) {
            throw new Error('TRANSFER_RECEIPT_CLOSE_WITH_DISCREPANCY_FORBIDDEN');
        }

        try {
            return await this.postOperationalPayload(
                `/transfers/${encodeURIComponent(normalizedTransferId)}/receipts`,
                payload,
                { includeHttpStatus: true, reauthenticateOn401: false },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'Transfer receipt failed');
            const statusMatch = message.match(/(?:failed(?: after re-auth)?):\s*(\d{3})/i);
            if (statusMatch) (error as any).httpStatus = Number(statusMatch[1]);
            throw error;
        }
    }

    async pushMasterNumberRangeProgress(
        terminalId: string,
        payload: Record<string, unknown>,
    ): Promise<{ httpStatus: number; data: Record<string, any> }> {
        const normalizedTerminalId = String(terminalId || '').trim();
        if (!normalizedTerminalId) throw new Error('MASTER_NUMBER_RANGE_TERMINAL_ID_MISSING');
        try {
            return await this.postOperationalPayload(
                `/terminals/${encodeURIComponent(normalizedTerminalId)}/master-number-ranges/progress`,
                payload,
                { includeHttpStatus: true, reauthenticateOn401: false },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'Master range progress failed');
            const statusMatch = message.match(/(?:failed(?: after re-auth)?):\s*(\d{3})/i);
            if (statusMatch) (error as any).httpStatus = Number(statusMatch[1]);
            throw error;
        }
    }

    async pullPaymentMethodsSnapshot(): Promise<unknown[]> {
        const payload = await this.getOperationalPayload('/collections/paymentMethods/data', 'PULL_MASTERS');
        return readErpPaymentMethodsSnapshot(payload);
    }

    async searchRefundSources(reference: string): Promise<any> {
        const normalized = String(reference || '').trim();
        if (normalized.length < 3) throw new Error('REFUND_SOURCE_REFERENCE_TOO_SHORT');
        return this.getOperationalPayload(`/refund-sources?reference=${encodeURIComponent(normalized)}`);
    }

    async getRefundSource(sourceId: string): Promise<any> {
        const normalized = String(sourceId || '').trim();
        if (!normalized) throw new Error('REFUND_SOURCE_ID_MISSING');
        return this.getOperationalPayload(`/refund-sources/${encodeURIComponent(normalized)}`);
    }

    async prepareRefundSource(
        sourceId: string,
        payload: {
            commandId: string;
            sourceRevision: string;
            terminalId: string;
            lines: Array<{ cartId: string; quantity: number }>;
        },
    ): Promise<any> {
        const normalized = String(sourceId || '').trim();
        if (!normalized) throw new Error('REFUND_SOURCE_ID_MISSING');
        return this.postOperationalPayload(`/refund-sources/${encodeURIComponent(normalized)}/prepare`, payload, {
            reauthenticateOn401: false,
        });
    }

    async recoveryCapabilities(): Promise<any> {
        const target = this.resolveOperationalTarget();
        if (!target || target.useLocalTarget) return { enabled: false, contractVersion: 1 };
        return this.getOperationalPayload('/originals/capabilities');
    }

    async receiveRecoveryOriginals(records: unknown[]): Promise<any> {
        return this.postOperationalPayload('/originals/batch', { records }, { maxRequestBytes: 2 * 1024 * 1024, reauthenticateOn401: false, expectedRecoveryScope: originalProvenance().key });
    }

    /** Frozen close bodies bypass commercial payload enrichment and automatic reauthentication. */
    async receivedCloseRequest(path: string, exactBody?: string): Promise<any> {
        if (!/^\/close-preparations(?:\/observe|\/[a-f0-9-]+\/(?:result|cancel-number-conflict))?$/i.test(path)) throw new Error('RECEIVED_CLOSE_PATH');
        const scopeKey = originalProvenance().key;
        const target = await this.authenticateOperationalTarget(false, 'sales', 'PUSH_OPERATIONS');
        if (target.useLocalTarget || originalProvenance().key !== scopeKey) throw new Error('RECOVERY_SCOPE_CHANGED');
        const response = await this.fetchWithRetry(`${target.baseUrl}/originals${path}`, {
            method: exactBody === undefined ? 'GET' : 'POST',
            headers: { ...this.buildOperationalHeaders(target, target.token, exactBody !== undefined), ...this.getLocalDeviceHeaders() },
            ...(exactBody === undefined ? {} : { body: exactBody }),
        }, 0, 500, 'sales', 'PUSH_OPERATIONS');
        if (originalProvenance().key !== scopeKey) throw new Error('RECOVERY_SCOPE_CHANGED');
        await this.handleDeviceSupersededResponse(response, target.terminalId);
        const payload = await response.json();
        if (response.status === 404 && path.endsWith('/result') && payload.code === 'CLOSE_RESULT_NOT_FOUND') return null;
        if (!response.ok) throw Object.assign(new Error(payload.code || 'RECEIVED_CLOSE_HTTP_ERROR'), { httpStatus: response.status });
        return payload;
    }

    async getOriginalCommercialStatus(references: unknown[]): Promise<any> {
        return this.postOperationalPayload('/originals/commercial-status', { references }, { reauthenticateOn401: false, expectedRecoveryScope: originalProvenance().key });
    }

    async createRecoverySnapshot(): Promise<any> {
        return this.postOperationalPayload('/originals/snapshots', {}, { reauthenticateOn401: false, expectedRecoveryScope: originalProvenance().key });
    }

    async retainedEpochRequest(requestId: string, body?: unknown): Promise<any> {
        if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('RETAINED_EPOCH_REQUEST_ID');
        const scope = originalProvenance().key;
        const target = await this.authenticateOperationalTarget(false, 'background', 'PUSH_OPERATIONS');
        if (target.useLocalTarget || originalProvenance().key !== scope) throw new Error('RECOVERY_SCOPE_CHANGED');
        const path = '/originals/retained-epochs' + (body === undefined ? '/' + encodeURIComponent(requestId) : '');
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {...this.buildOperationalHeaders(target, target.token, body !== undefined), ...this.getLocalDeviceHeaders()},
            ...(body === undefined ? {} : {body:JSON.stringify(body)}),
        }, 0, 500, 'background', 'PUSH_OPERATIONS');
        if (originalProvenance().key !== scope) throw new Error('RECOVERY_SCOPE_CHANGED');
        await this.handleDeviceSupersededResponse(response, target.terminalId);
        const payload = await response.json();
        if (response.status === 404 && body === undefined && payload.code === 'RESUME_REQUEST_NOT_FOUND') return null;
        if (!response.ok) throw Object.assign(new Error(payload.code || 'RETAINED_EPOCH_HTTP_ERROR'), {httpStatus:response.status});
        return payload;
    }

    async getRecoveryRetainedSet(snapshotId: string, manifestReceiptId: string): Promise<any> {
        return this.getOperationalPayload(`/originals/snapshots/${encodeURIComponent(snapshotId)}/retained-set?manifestReceiptId=${encodeURIComponent(manifestReceiptId)}`);
    }

    async getRecoveryPendingSelection(snapshotId: string): Promise<any> {
        return this.getOperationalPayload(`/originals/snapshots/${encodeURIComponent(snapshotId)}/pending`);
    }

    async getRecoveryPage(snapshotId: string, cursor: string): Promise<any> {
        return this.getOperationalPayload(`/originals/snapshots/${encodeURIComponent(snapshotId)}/pages?cursor=${encodeURIComponent(cursor)}`);
    }

    private async getOperationalPayload<T = any>(
        path: string,
        operation: OperationalSyncOperation = 'PULL_CONFIG'
    ): Promise<T> {
        const target = await this.authenticateOperationalTarget(false, 'background', operation);
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            headers: {
                ...this.buildOperationalHeaders(target, target.token),
                ...this.getLocalDeviceHeaders(),
            }
        }, 2, 500, 'background', operation);

        if (response.status === 401) {
            if (target.useLocalTarget) {
                this.authToken = null;
            } else {
                this.erpAuthToken = null;
            }

            const retriedTarget = await this.authenticateOperationalTarget(true, 'background', operation);
            const retryResponse = await this.fetchWithRetry(`${retriedTarget.baseUrl}${path}`, {
                headers: {
                    ...this.buildOperationalHeaders(retriedTarget, retriedTarget.token),
                    ...this.getLocalDeviceHeaders(),
                }
            }, 2, 500, 'background', operation);

            if (!retryResponse.ok) {
                await this.handleDeviceSupersededResponse(retryResponse, retriedTarget.terminalId);
                throw new Error(`Operational fetch failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
            }

            return await retryResponse.json();
        }

        if (!response.ok) {
            await this.handleDeviceSupersededResponse(response, target.terminalId);
            throw new Error(`Operational fetch failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Ensure operational push channels never fail silently.
     * If adapter is marked offline but browser has network, force re-auth recovery.
     */
    private async ensurePushReady(channel: CircuitBreakerChannel = 'background'): Promise<void> {
        this.ensureConfig();

        if (!navigator.onLine) {
            this.isOnline = false;
            throw new Error('Browser offline');
        }

        if (!this.isOnline) {
            console.warn('⚠️ ApiSyncAdapter: Recovering from offline state before push...');
            this.authToken = null;
        }

        await this.ensureAuthenticated(channel);
        this.isOnline = true;
    }

    /**
     * Lazy Load Configuration
     * Attempts to reconstruct config from localStorage if missing.
     */
    private ensureConfig() {
        if (this.config) return;

        const masterUrl = localStorage.getItem('CLIC_POS_MASTER_URL');
        const terminalId = localStorage.getItem('CLIC_POS_TERMINAL_ID'); // Ensure this is saved else where

        if (masterUrl && terminalId) {
            console.warn('⚠️ ApiSyncAdapter: Config missing. Lazy loading from localStorage.');
            this.config = {
                masterUrl,
                terminalId,
                autoRetry: true,
                retryDelayMs: 5000
            };
        } else {
            console.error('❌ ApiSyncAdapter: Critical - Cannot lazy load config. Missing masterUrl or terminalId.');
            throw new Error('Sync configuration missing in ApiSyncAdapter. Ensure SyncManager is initialized.');
        }
    }

    /**
     * Ensure we have a valid auth token
     */
    private async ensureAuthenticated(channel: CircuitBreakerChannel = 'background'): Promise<void> {
        if (!this.authToken) {
            console.log("🔄 ApiSyncAdapter: No token found, authenticating...");
            await this.authenticate(false, channel);
        }
    }

    /**
     * Setup online/offline detection
     */
    private setupOnlineDetection(): void {
        if (this.onlineListener) {
            window.removeEventListener('online', this.onlineListener);
        }
        if (this.offlineListener) {
            window.removeEventListener('offline', this.offlineListener);
        }

        this.onlineListener = () => {
            console.log('📶 Network connection restored');
            this.isOnline = true;
            this.ensureAuthenticated().catch((error) => {
                if (this.isCircuitBreakerOpenError(error) || this.isRecoverableConnectionError(error)) {
                    console.warn('⚠️ ApiSyncAdapter: Deferred auth after network restore.', error instanceof Error ? error.message : error);
                    return;
                }
                this.logAuthFailure('master', error);
            });
        };

        this.offlineListener = () => {
            console.log('📡 Network connection lost');
            this.isOnline = false;
        };

        window.addEventListener('online', this.onlineListener);
        window.addEventListener('offline', this.offlineListener);
    }

    /**
     * Set callback for connection restoration (circuit breaker reset)
     */
    setOnConnectionRestored(callback: () => void): void {
        this.onConnectionRestored = callback;
    }

    /**
     * Push changes to Master (called by Master terminal only)
     */
    async push(
        collection: string,
        items: any[],
        action: SyncChange['action'] = 'BULK_UPDATE',
        mode: 'UPSERT' | 'FULL_REPLACE' = 'UPSERT'
    ): Promise<void> {
        const normalizedItems = Array.isArray(items) ? items : [];
        if (normalizedItems.length === 0) {
            console.warn(`[POS_CLOUD_STAGING] push skipped collection=${collection}: no items to stage`);
            return;
        }

        const activeProfile = loadSyncProfile();
        const routedTarget = resolveSyncTarget(activeProfile);
        if (activeProfile.contractedProduct === 'POS_ERP') {
            console.warn('[INVALID_PUSH_MASTERS_FOR_POS_ERP]', {
                collection,
                action,
                mode,
                targetKind: routedTarget.kind,
                erpTerminalId: activeProfile.erpTerminalId,
                erpReadyForSales: activeProfile.erpReadyForSales,
            });
            return;
        }
        if (routedTarget.kind === 'POS_CLOUD_STAGING' && routedTarget.canPushMasters) {
            if (!isPosCloudStagingPushCollection(collection)) {
                console.warn(`[POS_CLOUD_STAGING] push skipped unsupported collection=${collection}`);
                return;
            }

            const target = await this.authenticateOperationalTarget(false, 'background', 'PUSH_MASTERS');
            if (!looksLikeUuidString(target.terminalId)) {
                console.warn(`[POS_CLOUD_STAGING] push skipped collection=${collection}: terminalId is not UUID (${target.terminalId})`);
                return;
            }

            const tenantId = this.resolveCurrentTenantId();
            if (tenantId && !looksLikeUuidString(tenantId)) {
                console.warn(`[POS_CLOUD_STAGING] push skipped collection=${collection}: tenantId is not UUID (${tenantId})`);
                return;
            }

            const buildBody = () => JSON.stringify(
                this.buildCloudStagingMasterPushBody(target, collection, normalizedItems, mode, action)
            );
            const postCloudStaging = async (authTarget: {
                baseUrl: string;
                terminalId: string;
                token: string;
                useLocalTarget: boolean;
                kind: ResolvedSyncTarget['kind'];
            }) => {
                const primaryUrl = `${authTarget.baseUrl}/cloud-staging/masters/${collection}`;
                const primaryResponse = await this.fetchWithRetry(primaryUrl, {
                    method: 'POST',
                    headers: this.buildOperationalHeaders(authTarget, authTarget.token, true),
                    body: buildBody()
                }, 2, 500, 'background', 'PUSH_MASTERS');

                if (primaryResponse.status === 404 || primaryResponse.status === 405) {
                    console.warn(`[POS_CLOUD_STAGING] ${primaryUrl} unavailable (${primaryResponse.status}); collection skipped.`);
                    return primaryResponse;
                }

                return primaryResponse;
            };

            const response = await postCloudStaging(target);

            if (response.status === 401) {
                this.erpAuthToken = null;
                const retriedTarget = await this.authenticateOperationalTarget(true, 'background', 'PUSH_MASTERS');
                const retryResponse = await postCloudStaging(retriedTarget);
                await this.finishCloudStagingPushResponse(retryResponse, collection, items.length, 'reauth');
                return;
            }

            await this.finishCloudStagingPushResponse(response, collection, normalizedItems.length);
            return;
        }

        if (routedTarget.kind === 'ERP_ACTIVE' && !routedTarget.canPushMasters) {
            console.warn(`[SYNC_ROUTER] push(${collection}) skipped: ERP_ACTIVE masters are governed by ERP.`);
            return;
        }

        if (routedTarget.kind === 'NONE') {
            console.warn(`[SYNC_ROUTER] push(${collection}) skipped: no cloud sync target.`);
            return;
        }

        if (!this.config) {
            throw new Error('Sync configuration missing in ApiSyncAdapter. Ensure SyncManager is initialized.');
        }

        if (!this.authToken) {
            await this.authenticate();
        }

        if (!this.isOnline) {
            throw new Error('Cannot push while offline');
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/collections/${collection}/push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken
                },
                body: JSON.stringify({ items: normalizedItems, mode })
            }, 2, 500, 'background', 'PUSH_MASTERS');

            if (response.status === 401) {
                // Token expired, re-authenticate
                await this.authenticate();
                return this.push(collection, items, action, mode);
            }

            if (!response.ok) {
                throw new Error(`Push failed: ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`📤 ApiSyncAdapter: Pushed ${normalizedItems.length} items to ${collection} (v${data.version})`);
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pushing ${collection}:`, error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull latest changes from Master (called by Slave terminals)
     */
    async pull(collection: string, sinceVersion?: number): Promise<any[]> {
        const operationalTarget = this.resolveOperationalTarget('PULL_MASTERS');
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            if (!isErpMasterPullCollection(collection)) {
                logSkippedNonMasterPull(collection, 'PULL_MASTERS', `${operationalTarget.baseUrl}/collections/${collection}/data`);
                return [];
            }
            const target = await this.authenticateOperationalTarget(false, 'background', 'PULL_MASTERS');
            const url = new URL(`${target.baseUrl}/collections/${collection}/data`);
            if (sinceVersion) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            try {
                const headers = this.buildOperationalHeaders(target, target.token);
                const response = await this.fetchWithRetry(url.toString(), {
                    method: 'GET',
                    headers
                }, 2, 500, 'background', 'PULL_MASTERS');

                if (response.status === 401) {
                    this.erpAuthToken = null;
                    this.clearCanonicalErpSyncToken();
                    const retryTarget = await this.authenticateOperationalTarget(true, 'background', 'PULL_MASTERS');
                    const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                    const retryResponse = await this.fetchWithRetry(url.toString(), {
                        method: 'GET',
                        headers: retryHeaders
                    }, 2, 500, 'background', 'PULL_MASTERS');
                    if (!retryResponse.ok) {
                        const responseBody = await retryResponse.text().catch(() => '');
                        const retryPayload = this.parseResponsePayload(responseBody);
                        const retryBackendCode = this.normalizeBackendCode(retryPayload);
                        if (this.isPaymentMethodsMissingError({
                            collection,
                            backendCode: retryBackendCode,
                            statusText: retryResponse.statusText,
                            message: retryPayload?.message,
                            status: retryResponse.status,
                            supported: retryPayload?.supported,
                            critical: retryPayload?.critical,
                        })) {
                            this.logOptionalMasterUnavailable({
                                operation: 'PULL_MASTERS',
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                reason: retryBackendCode || 'PAYMENT_METHODS_MISSING'
                            });
                            return [];
                        }
                        if (retryResponse.status === 401) {
                            const error = this.buildSyncTokenError('SYNC_TOKEN_REJECTED');
                            reportSyncErrorDiagnostic({
                                operation: 'PULL_MASTERS',
                                collection,
                                endpoint: url.toString(),
                                httpStatus: retryResponse.status,
                                responseBody,
                                error,
                                requestAuth: this.buildRequestAuthDiagnostic(retryHeaders),
                                isMasterCollection: true,
                                isOperationCollection: false,
                                isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                                userVisibleSeverity: 'critical',
                            });
                            throw error;
                        }
                        this.logOptionalMasterUnavailable({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: retryResponse.status,
                            reason: `PULL_FAILED_AFTER_REAUTH_${retryResponse.status}`
                        });
                        return [];
                    }
                    const retryData = await retryResponse.json();
                    return readArrayPayload(retryData, collection);
                }

                if (!response.ok) {
                    if (response.status === 404 && !ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                        markErpMasterCollectionUnsupported(collection, {
                            collection,
                            operation: 'PULL_MASTERS',
                            endpoint: url.toString(),
                            httpStatus: response.status,
                            reason: 'ERP_ENDPOINT_NOT_FOUND',
                            userVisibleSeverity: 'warning',
                        });
                        return [];
                    }
                    const responseBody = await response.text().catch(() => '');
                    const payload = this.parseResponsePayload(responseBody);
                    if (this.isFiscalConfigMissingResponse(response.status, payload, responseBody)) {
                        this.logOptionalMasterUnavailable({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: response.status,
                            reason: 'FISCAL_CONFIG_MISSING'
                        });
                        return [];
                    }
                    this.throwIfKnownMasterPullFailure({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: response.status,
                        payload,
                        responseBody,
                        requestHeaders: headers,
                    });
                    const backendCode = this.normalizeBackendCode(payload);
                    if (this.isPaymentMethodsMissingError({
                        collection,
                        backendCode,
                        statusText: response.statusText,
                        message: payload?.message,
                        status: response.status,
                        supported: payload?.supported,
                        critical: payload?.critical,
                    })) {
                        this.logOptionalMasterUnavailable({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: response.status,
                            reason: backendCode || 'PAYMENT_METHODS_MISSING'
                        });
                        return [];
                    }
                    this.logOptionalMasterUnavailable({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: response.status,
                        reason: `PULL_FAILED_${response.status}`
                    });
                    return [];
                }

                const data = await response.json();
                return readArrayPayload(data, collection);
            } catch (error) {
                console.error(`❌ ApiSyncAdapter: Error pulling ${collection} from ERP target:`, error);
                if (!this.isBlockingOperationalAuthError(error)) {
                    this.logOptionalMasterUnavailable({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: 0,
                        reason: error instanceof Error ? error.message : String(error || 'PULL_ERROR')
                    });
                    return [];
                }
                if (!this.wasDiagnosticReported(error)) {
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: error instanceof TypeError ? 'network error' : null,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, target.token)),
                        fetchDiagnostic: error && typeof error === 'object'
                            ? ((error as any).__syncFetchDiagnostic as SyncFetchDiagnostic | undefined)
                            : undefined,
                    });
                }
                throw error;
            }
        }

        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        if (!this.canUseLocalMasterSyncFallback()) {
            const routedTarget = resolveSyncTarget();
            logSkippedNonMasterPull(
                collection,
                'PULL_MASTERS',
                `${routedTarget.kind}:LOCAL_MASTER_SYNC_UNAVAILABLE`,
            );
            return [];
        }

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                console.warn('Auto-authentication failed during pull:', error);
                throw new Error('Authentication failed. Please check connection to Master.');
            }
        }

        if (!this.isOnline) {
            console.warn(`⚠️  Cannot pull ${collection} while offline`);
            return [];
        }

        try {
            const url = new URL(`${this.config.masterUrl}/api/sync/collections/${collection}/data`);
            if (sinceVersion) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken
                }
            }, 2, 500, 'background', 'PULL_MASTERS');

            if (response.status === 401) {
                // Token expired, re-authenticate
                await this.authenticate();
                return this.pull(collection, sinceVersion);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                const payload = this.parseResponsePayload(responseBody);
                const backendCode = this.normalizeBackendCode(payload);
                if (this.isPaymentMethodsMissingError({
                    collection,
                    backendCode,
                    statusText: response.statusText,
                    message: payload?.message,
                    status: response.status,
                    supported: payload?.supported,
                    critical: payload?.critical,
                })) {
                    const error = this.attachSyncErrorMetadata(
                        new Error('PAYMENT_METHODS_MISSING: faltan métodos de pago configurados para esta terminal en el ERP.'),
                        collection,
                        backendCode || 'PAYMENT_METHODS_MISSING',
                        response.status
                    );
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/data`,
                        httpStatus: response.status,
                        responseBody,
                        error,
                    backendCode: (error as { __syncBackendCode?: string }).__syncBackendCode || undefined,
                        isMasterCollection: true,
                        isOperationCollection: false,
                        isCriticalMaster: false,
                        userVisibleSeverity: 'warning',
                    });
                    throw error;
                }

                const error = new Error(`Pull failed: ${response.status} ${response.statusText}`);
                reportSyncErrorDiagnostic({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/data`,
                    httpStatus: response.status,
                    responseBody,
                    error,
                });
                throw error;
            }

            const data = await response.json();

            const isDebugMode = () => {
                try {
                    return window.location.search.includes('debug=sync') ||
                        localStorage.getItem('CLIC_POS_DEBUG_SYNC') === 'true';
                } catch {
                    return false;
                }
            };

            if (data.upToDate) {
                if (isDebugMode()) {
                    console.log(`✅ ApiSyncAdapter: ${collection} is up to date (v${sinceVersion})`);
                }
                return [];
            }

            const items = readArrayPayload(data, collection);
            console.log(`📥 ApiSyncAdapter: Pulled ${items.length} items from ${collection} (v${data.version})`);
            return items;

        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling ${collection}:`, error);
            reportSyncErrorDiagnostic({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/data`,
                httpStatus: error instanceof TypeError ? 'network error' : null,
                error,
            });
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pulls an authoritative full snapshot directly from the configured LAN
     * Master. This intentionally bypasses the ERP/cloud strategy selector:
     * operational clients can still need production routing from their paired
     * Master while the generic sync profile is being rehydrated.
     */
    async pullLinkedMasterSnapshot(
        collection: string,
        linkedTarget?: { masterUrl: string; terminalId: string },
    ): Promise<any[]> {
        if (!linkedTarget) {
            this.ensureConfig();
            if (!this.config) throw new Error('Sync configuration missing');
        }

        const masterUrl = String(linkedTarget?.masterUrl || this.config?.masterUrl || '').replace(/\/+$/, '');
        const terminalId = String(linkedTarget?.terminalId || this.config?.terminalId || '').trim();
        if (!masterUrl || !terminalId) throw new Error('Linked Master sync target missing');

        const requestSnapshot = async (allowReauth: boolean): Promise<any[]> => {
            let token = this.authToken;
            if (linkedTarget || !token) {
                const authResponse = await this.fetchWithRetry(`${masterUrl}/api/sync/auth`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.getLocalDeviceHeaders(),
                    },
                    body: JSON.stringify({
                        terminalId,
                        terminal_id: terminalId,
                        deviceToken: this.getLocalDeviceId(),
                        device_id: this.getLocalDeviceId(),
                    }),
                }, 2, 500, 'sales', 'PULL_MASTERS');
                if (!authResponse.ok) {
                    throw new Error(`Linked Master authentication failed: ${authResponse.status}`);
                }
                const authPayload = await authResponse.json();
                token = String(authPayload?.token || '').trim();
                if (!token) throw new Error('Linked Master authentication returned no token');
                if (!linkedTarget) this.authToken = token;
            }

            const endpoint = `${masterUrl}/api/sync/collections/${collection}/data`;
            const response = await this.fetchWithRetry(endpoint, {
                method: 'GET',
                headers: {
                    'X-Sync-Token': token || '',
                },
            }, 2, 500, 'sales', 'PULL_MASTERS');

            if (response.status === 401 && allowReauth) {
                if (!linkedTarget) this.authToken = null;
                return requestSnapshot(false);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                throw new Error(
                    `Linked Master snapshot pull failed for ${collection}: ${response.status}`
                    + (responseBody ? ` ${responseBody.slice(0, 200)}` : '')
                );
            }

            const payload = await response.json();
            return readArrayPayload(payload, collection);
        };

        return requestSnapshot(true);
    }

    /**
     * Pull incremental changes from Master (Delta Sync)
     */
	    private async pullFullFallbackForCriticalMaster(
	        collection: string,
	        target: {
	            baseUrl: string;
	            terminalId: string;
            token: string;
            useLocalTarget: boolean;
            kind: ResolvedSyncTarget['kind'];
	        },
	        headers: Record<string, string>,
	        deltaStatus: number
	    ): Promise<PullDeltaResult> {
        const fullEndpoint = `${target.baseUrl}/collections/${collection}/full`;
        const fullResponse = await this.fetchWithRetry(fullEndpoint, {
            method: 'GET',
            headers
        }, 2, 500, 'background', 'PULL_MASTERS');

        console.warn('[PULL_DELTA_FALLBACK_TO_FULL]', {
            collection,
            deltaStatus,
            fullStatus: fullResponse.status,
        });

        if (fullResponse.status === 401 || fullResponse.status === 403) {
            const responseBody = await fullResponse.text().catch(() => '');
            let backendCode: string | null = null;
            try {
                backendCode = this.normalizeBackendCode(responseBody ? JSON.parse(responseBody) : null);
            } catch {
                backendCode = null;
            }
            throw this.buildProtectedPullError({
                collection,
                endpoint: fullEndpoint,
                status: fullResponse.status,
                responseBody,
                headers,
                backendCode,
            });
        }

        if (!fullResponse.ok) {
            const responseBody = await fullResponse.text().catch(() => '');
            let payload: any = null;
            try {
                payload = responseBody ? JSON.parse(responseBody) : null;
            } catch {
                payload = null;
            }
            // ERP exposes timestamp deltas for products/items but may not expose
            // the legacy full endpoint. A first KDS bootstrap can proceed with
            // the pairing snapshot/order payload, so an absent optional full
            // endpoint must not turn into a blocking sync error.
            if (fullResponse.status === 404 && (collection === 'products' || collection === 'items')) {
                console.warn('[SYNC_FULL_ENDPOINT_UNAVAILABLE]', {
                    collection,
                    endpoint: fullEndpoint,
                    status: fullResponse.status,
                    action: 'KEEP_LOCAL_OR_SNAPSHOT',
                });
                return {
                    items: [],
                    serverTime: new Date().toISOString(),
                    isFullDownload: true,
                    latestVersion: 0,
                    syncStatus: 'SYNCED_WITH_FULL_FALLBACK',
                };
            }
            if (this.isFiscalConfigMissingResponse(fullResponse.status, payload, responseBody)) {
                this.logOptionalMasterUnavailable({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: fullEndpoint,
                    status: fullResponse.status,
                    reason: 'FISCAL_CONFIG_MISSING'
                });
                return {
                    items: [],
                    serverTime: new Date().toISOString(),
                    isFullDownload: true,
                    latestVersion: 0,
                    syncStatus: 'SYNCED_WITH_FULL_FALLBACK',
                };
            }
            this.throwIfKnownMasterPullFailure({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: fullEndpoint,
                status: fullResponse.status,
                payload,
                responseBody,
                requestHeaders: headers,
            });
            const error = new Error(`ERP no expone endpoint full de maestro crítico: ${collection}`);
            reportSyncErrorDiagnostic({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: fullEndpoint,
                httpStatus: fullResponse.status,
                responseBody,
                error,
                requestAuth: this.buildRequestAuthDiagnostic(headers),
                isMasterCollection: true,
                isOperationCollection: false,
                isCriticalMaster: true,
                userVisibleSeverity: 'critical',
            });
            throw error;
        }

        const fullData = await fullResponse.json();
        const items = readArrayPayload(fullData, collection);
	        const latestVersion = Number(
	            fullData.latestVersion
	            ?? fullData.version
	            ?? fullData.fullSyncVersion
	            ?? fullData.metadata?.version
	            ?? 0
	        );
	        const serverTime = fullData.serverTime || fullData.server_time || fullData.timestamp || new Date().toISOString();
	        const cursor = readCursorPayload(fullData) || serverTime;

	        console.log('[SYNC_DELTA_CURSOR]', {
	            collection,
	            type: 'full',
	            cursorSent: null,
	            cursorReceived: cursor,
	            count: items.length,
	            hasMore: false,
	        });

	        return {
	            items,
	            serverTime,
	            isFullDownload: true,
	            latestVersion,
	            cursor,
	            nextCursor: cursor,
	            lastSyncedAt: cursor,
	            syncStatus: 'SYNCED_WITH_FULL_FALLBACK',
	        };
    }

    private async pullErpTimestampCursorDelta(
        collection: string,
        target: {
            baseUrl: string;
            terminalId: string;
            token: string;
            useLocalTarget: boolean;
            kind: ResolvedSyncTarget['kind'];
        },
        headers: Record<string, string>,
        initialCursor: string,
        limit: number
    ): Promise<PullDeltaResult> {
        const allItems: any[] = [];
        let pageCursor = initialCursor;
        let responseCursor: string | null = initialCursor;
        let serverTime = new Date().toISOString();
        let latestVersion: number | undefined;
        let hasMore = false;
        let page = 0;

        do {
            page += 1;
            const url = new URL(`${target.baseUrl}/collections/${collection}/delta`);
            const cursorParam = collection === 'items' ? 'sinceVersion' : 'since';
            url.searchParams.set(cursorParam, pageCursor);
            url.searchParams.set('limit', String(limit));

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers
            }, 2, 500, 'background', 'PULL_MASTERS');

            if (response.status === 401) {
                this.erpAuthToken = null;
                this.clearCanonicalErpSyncToken();
                const retryTarget = await this.authenticateOperationalTarget(true, 'background', 'PULL_MASTERS');
                const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                return this.pullErpTimestampCursorDelta(collection, retryTarget, retryHeaders, initialCursor, limit);
            }

            if (!response.ok) {
                if ((response.status === 400 || response.status === 422) && ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                    console.warn('[SYNC_DELTA_CURSOR_INVALID]', {
                        collection,
                        type: 'delta',
                        cursorSent: pageCursor,
                        status: response.status,
                    });
                    return this.pullFullFallbackForCriticalMaster(collection, target, headers, response.status);
                }
                const responseBody = await response.text().catch(() => '');
                const payload = this.parseResponsePayload(responseBody);
                this.throwIfKnownMasterPullFailure({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: url.toString(),
                    status: response.status,
                    payload,
                    responseBody,
                    requestHeaders: headers,
                });
                throw new Error(`Delta pull failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const pageItems = readArrayPayload(data, collection);
            allItems.push(...pageItems);

            const nextCursor = readCursorPayload(data);
            responseCursor = nextCursor || responseCursor;
            serverTime = pickFirstString(
                data?.serverTime,
                data?.server_time,
                data?.timestamp,
                data?.lastSyncedAt,
                data?.last_synced_at,
                serverTime,
            ) || serverTime;
            latestVersion = typeof data?.latestVersion === 'number'
                ? data.latestVersion
                : typeof data?.version === 'number'
                    ? data.version
                    : latestVersion;
            hasMore = readBooleanPayload(data?.hasMore, data?.has_more, data?.metadata?.hasMore, data?.metadata?.has_more);

            console.log('[SYNC_DELTA_CURSOR]', {
                collection,
                type: 'delta',
                cursorSent: pageCursor,
                cursorReceived: responseCursor,
                count: pageItems.length,
                hasMore,
                page,
            });

            if (!hasMore) break;
            if (!nextCursor || nextCursor === pageCursor) {
                console.warn('[SYNC_DELTA_CURSOR_STOPPED]', {
                    collection,
                    cursorSent: pageCursor,
                    cursorReceived: nextCursor,
                    reason: 'MISSING_OR_REPEATED_CURSOR',
                });
                break;
            }
            pageCursor = nextCursor;
        } while (hasMore);

        return {
            items: allItems,
            serverTime,
            isFullDownload: false,
            latestVersion,
            cursor: responseCursor,
            nextCursor: responseCursor,
            lastSyncedAt: responseCursor,
            hasMore: false,
        };
    }

    async pullDelta(collection: string, sinceVersion?: number, options?: PullDeltaOptions): Promise<PullDeltaResult> {
        const routedTarget = resolveSyncTarget();
        if (routedTarget.kind === 'POS_CLOUD_STAGING') {
            logSkippedNonMasterPull(collection, 'PULL_MASTERS', 'POS_CLOUD_STAGING_PULL_BLOCKED');
            return this.buildEmptyDeltaResult(sinceVersion);
        }

        const operationalTarget = this.resolveOperationalTarget('PULL_MASTERS');
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            if (!isErpMasterPullCollection(collection)) {
                logSkippedNonMasterPull(collection, 'PULL_MASTERS', `${operationalTarget.baseUrl}/delta/${collection}`);
                return {
                    items: [],
                    serverTime: new Date().toISOString(),
                    isFullDownload: false,
                    latestVersion: sinceVersion || 0,
                };
            }
            const target = await this.authenticateOperationalTarget(false, 'background', 'PULL_MASTERS');
            const url = new URL(`${target.baseUrl}/collections/${collection}/delta`);
            if (sinceVersion !== undefined) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            try {
                if (!sanitizeSyncToken(target.token)) {
                    console.warn('[PULL_BLOCKED_NO_SYNC_TOKEN]', {
                        collection,
                        operation: 'PULL_MASTERS',
                        syncTokenPresent: false,
                        authStatus: safeLocalStorageGet('clic_sync_auth_status') || 'AUTH_REQUIRED',
                    });
                    const error = new Error(`SYNC_TOKEN_REQUIRED_BEFORE_PULL: Falta autenticación/syncToken para descargar ${collection}.`);
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: null,
                        error,
                        authStatus: 'AUTH_REQUIRED',
                        backendCode: 'SYNC_TOKEN_REQUIRED_BEFORE_PULL',
                        blockedByLocalGuard: true,
                        guardReason: 'SYNC_TOKEN_REQUIRED_BEFORE_PULL',
                        requestSkippedReason: 'SYNC_TOKEN_REQUIRED_BEFORE_PULL',
                        requestAuth: {
                            authorizationPresent: false,
                            syncTokenPresent: false,
                            syncTokenPreview: null,
                            terminalIdHeaderPresent: Boolean(target.terminalId),
                            deviceIdHeaderPresent: Boolean(this.resolveCurrentDeviceId()),
                        },
                        isMasterCollection: true,
                        isOperationCollection: false,
                        isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                        userVisibleSeverity: 'critical',
                    });
                    throw error;
	                }
	                const headers = this.buildOperationalHeaders(target, target.token);
	                if (ERP_TIMESTAMP_CURSOR_COLLECTIONS.has(collection)) {
	                    const cursor = typeof options?.cursor === 'string' ? options.cursor.trim() : '';
	                    const limit = Math.max(1, Math.min(options?.limit || 500, 1000));
	                    if (!isValidIsoTimestampCursor(cursor)) {
	                        console.log('[SYNC_DELTA_CURSOR]', {
	                            collection,
	                            type: 'full',
	                            cursorSent: cursor || null,
	                            cursorReceived: null,
	                            count: 0,
	                            hasMore: false,
	                            reason: 'MISSING_VALID_ISO_CURSOR',
	                        });
                        // A first ERP bootstrap can legitimately have no local
                        // cursor. Products/items are hydrated from the pairing
                        // snapshot; do not call the legacy /full endpoint here.
                        return {
                            items: [],
                            serverTime: new Date().toISOString(),
                            isFullDownload: true,
                            latestVersion: 0,
                            syncStatus: 'SYNCED_WITH_FULL_FALLBACK',
                        };
	                    }
	                    return this.pullErpTimestampCursorDelta(collection, target, headers, cursor, limit);
	                }
	                const response = await this.fetchWithRetry(url.toString(), {
	                    method: 'GET',
	                    headers
	                }, 2, 500, 'background', 'PULL_MASTERS');

                if (response.status === 401) {
                    this.erpAuthToken = null;
                    this.clearCanonicalErpSyncToken();
                    const retryTarget = await this.authenticateOperationalTarget(true, 'background', 'PULL_MASTERS');
                    const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                    const retryResponse = await this.fetchWithRetry(url.toString(), {
                        method: 'GET',
                        headers: retryHeaders
                    }, 2, 500, 'background', 'PULL_MASTERS');
                    if (!retryResponse.ok) {
                        const responseBody = await retryResponse.text().catch(() => '');
                        const retryPayload = this.parseResponsePayload(responseBody);
                        const retryBackendCode = this.normalizeBackendCode(retryPayload);
                    if (this.isPaymentMethodsMissingError({
                            collection,
                            backendCode: retryBackendCode,
                            statusText: retryResponse.statusText,
                            message: retryPayload?.message,
                            status: retryResponse.status,
                            supported: retryPayload?.supported,
                            critical: retryPayload?.critical,
                        })) {
                            this.logOptionalMasterUnavailable({
                                operation: 'PULL_MASTERS',
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                reason: retryBackendCode || 'PAYMENT_METHODS_MISSING'
                            });
                            return {
                                items: [],
                                serverTime: new Date().toISOString(),
                                isFullDownload: false,
                                latestVersion: sinceVersion || 0,
                            };
                        }
                        if (retryResponse.status === 401) {
                            const error = this.buildProtectedPullError({
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                responseBody,
                                headers: retryHeaders,
                                backendCode: 'SYNC_TOKEN_REJECTED',
                            });
                            throw error;
                        }
                        if (retryResponse.status === 403) {
                            throw this.buildProtectedPullError({
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                responseBody,
                                headers: retryHeaders,
                            });
                        }
                        if (this.isFiscalConfigMissingResponse(retryResponse.status, retryPayload, responseBody)) {
                            this.logOptionalMasterUnavailable({
                                operation: 'PULL_MASTERS',
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                reason: 'FISCAL_CONFIG_MISSING'
                            });
                            return {
                                items: [],
                                serverTime: new Date().toISOString(),
                                isFullDownload: false,
                                latestVersion: sinceVersion || 0,
                            };
                        }
                        this.logOptionalMasterUnavailable({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: retryResponse.status,
                            reason: `DELTA_PULL_FAILED_AFTER_REAUTH_${retryResponse.status}`
                        });
                        return {
                            items: [],
                            serverTime: new Date().toISOString(),
                            isFullDownload: false,
                            latestVersion: sinceVersion || 0,
                        };
                    }
                    return normalizePullDeltaPayload(collection, await retryResponse.json());
                }

                if (!response.ok) {
                    if (response.status === 403) {
                        const responseBody = await response.text().catch(() => '');
                        throw this.buildProtectedPullError({
                            collection,
                            endpoint: url.toString(),
                            status: response.status,
                            responseBody,
                            headers,
                        });
                    }
                    if (response.status === 404 && !ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                        markErpMasterCollectionUnsupported(collection, {
                            collection,
                            operation: 'PULL_MASTERS',
                            endpoint: url.toString(),
                            httpStatus: response.status,
                            reason: 'ERP_ENDPOINT_NOT_FOUND',
                            userVisibleSeverity: 'warning',
                        });
                        return {
                            items: [],
                            serverTime: new Date().toISOString(),
                            isFullDownload: false,
                            latestVersion: sinceVersion || 0,
                        };
                    }
                    const isCriticalMaster = ERP_CRITICAL_MASTER_COLLECTIONS.has(collection);
                    if (response.status === 404 && isCriticalMaster) {
                        return this.pullFullFallbackForCriticalMaster(collection, target, headers, response.status);
                    }
                    const responseBody = await response.text().catch(() => '');
                    const payload = this.parseResponsePayload(responseBody);
                    if (this.isFiscalConfigMissingResponse(response.status, payload, responseBody)) {
                        this.logOptionalMasterUnavailable({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: response.status,
                            reason: 'FISCAL_CONFIG_MISSING'
                        });
                        return {
                            items: [],
                            serverTime: new Date().toISOString(),
                            isFullDownload: false,
                            latestVersion: sinceVersion || 0,
                        };
                    }
                    if (this.isPaymentMethodsMissingError({
                        collection,
                        backendCode: this.normalizeBackendCode(payload),
                        statusText: response.statusText,
                        message: payload?.message,
                        status: response.status,
                        supported: payload?.supported,
                        critical: payload?.critical,
                    })) {
                        this.logOptionalMasterUnavailable({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: response.status,
                            reason: this.normalizeBackendCode(payload) || 'PAYMENT_METHODS_MISSING'
                        });
                        return {
                            items: [],
                            serverTime: new Date().toISOString(),
                            isFullDownload: false,
                            latestVersion: sinceVersion || 0,
                        };
                    }
                    this.throwIfKnownMasterPullFailure({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: response.status,
                        payload,
                        responseBody,
                        requestHeaders: headers,
                    });
                    this.logOptionalMasterUnavailable({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: response.status,
                        reason: `DELTA_PULL_FAILED_${response.status}`
                    });
                    return {
                        items: [],
                        serverTime: new Date().toISOString(),
                        isFullDownload: false,
                        latestVersion: sinceVersion || 0,
                    };
                }

                return normalizePullDeltaPayload(collection, await response.json());
            } catch (error) {
                console.error(`❌ ApiSyncAdapter: Error pulling ERP delta for ${collection}:`, error);
                if (!this.isBlockingOperationalAuthError(error)) {
                    this.logOptionalMasterUnavailable({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: 0,
                        reason: error instanceof Error ? error.message : String(error || 'DELTA_PULL_ERROR')
                    });
                    return {
                        items: [],
                        serverTime: new Date().toISOString(),
                        isFullDownload: false,
                        latestVersion: sinceVersion || 0,
                    };
                }
                if (!this.wasDiagnosticReported(error)) {
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: error instanceof TypeError ? 'network error' : null,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, target.token)),
                    });
                }
                throw error;
            }
        }

        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        if (!this.canUseLocalMasterSyncFallback()) {
            const routedTarget = resolveSyncTarget();
            logSkippedNonMasterPull(
                collection,
                'PULL_MASTERS',
                `${routedTarget.kind}:LOCAL_MASTER_SYNC_UNAVAILABLE`,
            );
            return this.buildEmptyDeltaResult(sinceVersion);
        }

        if (!this.authToken) {
            await this.authenticate();
        }

        try {
            const url = new URL(`${this.config.masterUrl}/api/sync/delta/${collection}`);
            if (sinceVersion !== undefined) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken || ''
                }
            }, 2, 500, 'background', 'PULL_MASTERS');

            if (response.status === 401) {
                await this.authenticate();
                return this.pullDelta(collection, sinceVersion);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                const payload = this.parseResponsePayload(responseBody);
                if (this.isPaymentMethodsMissingError({
                    collection,
                    backendCode: this.normalizeBackendCode(payload),
                    statusText: response.statusText,
                    message: payload?.message,
                    status: response.status,
                    supported: payload?.supported,
                    critical: payload?.critical,
                })) {
                    const error = this.attachSyncErrorMetadata(
                        new Error('PAYMENT_METHODS_MISSING: faltan métodos de pago configurados para esta terminal en el ERP.'),
                        collection,
                        this.normalizeBackendCode(payload) || 'PAYMENT_METHODS_MISSING',
                        response.status
                    );
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: response.status,
                        responseBody,
                        error,
                        backendCode: (error as { __syncBackendCode?: string }).__syncBackendCode || undefined,
                        isMasterCollection: true,
                        isOperationCollection: false,
                        isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                        userVisibleSeverity: 'warning',
                    });
                    throw error;
                }

                const error = new Error(`Delta pull failed: ${response.status} ${response.statusText}`);
                reportSyncErrorDiagnostic({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: url.toString(),
                    httpStatus: response.status,
                    responseBody,
                    error,
                });
                throw error;
            }

            return normalizePullDeltaPayload(collection, await response.json());
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling delta for ${collection}:`, error);
            reportSyncErrorDiagnostic({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: `${this.config.masterUrl}/api/sync/delta/${collection}`,
                httpStatus: error instanceof TypeError ? 'network error' : null,
                error,
            });
            throw error;
        }
    }

    /**
     * Pull image manifest for products (lightweight channel).
     */
    async pullProductImageManifest(
        sinceVersion?: number,
        ids?: string[]
    ): Promise<{ items: ProductImageManifestItem[]; version: number; upToDate: boolean; serverTime?: string }> {
        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        await this.ensureAuthenticated();

        if (!this.isOnline) {
            return { items: [], version: sinceVersion || 0, upToDate: false };
        }

        try {
            const url = new URL(`${this.config.masterUrl}/api/sync/products/images/manifest`);
            if (sinceVersion !== undefined) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }
            if (ids && ids.length > 0) {
                url.searchParams.set('ids', ids.join(','));
            }

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken || ''
                }
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.pullProductImageManifest(sinceVersion, ids);
            }

            if (!response.ok) {
                throw new Error(`Pull product image manifest failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                items: Array.isArray(data.items) ? data.items : [],
                version: typeof data.version === 'number' ? data.version : 0,
                upToDate: !!data.upToDate,
                serverTime: data.serverTime
            };
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling product image manifest:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull image payload for specific products.
     */
    async pullProductImages(ids: string[]): Promise<ProductImagePayloadItem[]> {
        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        if (!ids || ids.length === 0) return [];

        await this.ensureAuthenticated();

        if (!this.isOnline) return [];

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/products/images/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.pullProductImages(ids);
            }

            if (!response.ok) {
                throw new Error(`Pull product images failed: ${response.statusText}`);
            }

            const data = await response.json();
            return Array.isArray(data.items) ? data.items : [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling product images:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Get metadata for a collection
     */
    async getMetadata(collection: string): Promise<SyncMetadata | null> {
        const operation: OperationalSyncOperation = collection === 'config' ? 'PULL_CONFIG' : 'PULL_MASTERS';
        const operationalTarget = this.resolveOperationalTarget(operation);
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            if (operation === 'PULL_MASTERS' && !isErpMasterPullCollection(collection)) {
                logSkippedNonMasterPull(collection, operation, `${operationalTarget.baseUrl}/collections/${collection}/metadata`);
                return null;
            }
            const target = await this.authenticateOperationalTarget(false, 'background', operation);
            const endpoint = `${target.baseUrl}/collections/${collection}/metadata`;
            try {
                const headers = this.buildOperationalHeaders(target, target.token);
                const response = await this.fetchWithRetry(endpoint, {
                    method: 'GET',
                    headers
                }, 2, 500, 'background', operation);

                if (response.status === 401) {
                    this.erpAuthToken = null;
                    this.clearCanonicalErpSyncToken();
                    const retryTarget = await this.authenticateOperationalTarget(true, 'background', operation);
                    const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                    const retryResponse = await this.fetchWithRetry(endpoint, {
                        method: 'GET',
                        headers: retryHeaders
                    }, 2, 500, 'background', operation);
                    if (!retryResponse.ok) {
                        const responseBody = await retryResponse.text().catch(() => '');
                        if (retryResponse.status === 401) {
                            const error = this.buildSyncTokenError('SYNC_TOKEN_REJECTED');
                            reportSyncErrorDiagnostic({
                                operation,
                                collection,
                                endpoint,
                                httpStatus: retryResponse.status,
                                responseBody,
                                error,
                                requestAuth: this.buildRequestAuthDiagnostic(retryHeaders),
                                isMasterCollection: operation === 'PULL_CONFIG' || isErpMasterPullCollection(collection),
                                isOperationCollection: isErpOperationPushCollection(collection),
                                isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                                userVisibleSeverity: 'critical',
                            });
                        }
                        return null;
                    }
                    const retryData = await retryResponse.json();
                    const retryMetadata = retryData.metadata || retryData;
                    return {
                        collection,
                        lastSyncedAt: retryMetadata.lastUpdated || retryMetadata.lastSyncedAt || new Date().toISOString(),
                        version: Number(retryMetadata.version || 0),
                        itemCount: Number(retryMetadata.itemCount || retryMetadata.count || 0),
                        fullSyncVersion: retryMetadata.fullSyncVersion
                    };
                }

                if (!response.ok) {
                    if (response.status === 404 && !ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                        markErpMasterCollectionUnsupported(collection, {
                            collection,
                            operation,
                            endpoint,
                            httpStatus: response.status,
                            reason: 'ERP_ENDPOINT_NOT_FOUND',
                            userVisibleSeverity: 'warning',
                        });
                        return null;
                    }
                    const responseBody = await response.text().catch(() => '');
                    const isCriticalMaster = ERP_CRITICAL_MASTER_COLLECTIONS.has(collection);
                    let payload: any = null;
                    try {
                        payload = responseBody ? JSON.parse(responseBody) : null;
                    } catch {
                        payload = null;
                    }
                    if (this.isFiscalConfigMissingResponse(response.status, payload, responseBody)) {
                        this.logOptionalMasterUnavailable({
                            operation,
                            collection,
                            endpoint,
                            status: response.status,
                            reason: 'FISCAL_CONFIG_MISSING'
                        });
                        return null;
                    }
                    this.throwIfKnownMasterPullFailure({
                        operation,
                        collection,
                        endpoint,
                        status: response.status,
                        payload,
                        responseBody,
                        requestHeaders: headers,
                    });
                    this.logOptionalMasterUnavailable({
                        operation,
                        collection,
                        endpoint,
                        status: response.status,
                        reason: `METADATA_FAILED_${response.status}`
                    });
                    return null;
                }

                const data = await response.json();
                const metadata = data.metadata || data;
                return {
                    collection,
                    lastSyncedAt: metadata.lastUpdated || metadata.lastSyncedAt || new Date().toISOString(),
                    version: Number(metadata.version || 0),
                    itemCount: Number(metadata.itemCount || metadata.count || 0),
                    fullSyncVersion: metadata.fullSyncVersion
                };
            } catch (error) {
                if (this.isRecoverableMetadataTimeout(error)) {
                    console.warn('[SYNC_METADATA_TIMEOUT_SUPPRESSED]', {
                        collection,
                        operation,
                        endpoint,
                        reason: error instanceof Error ? error.message : String(error || 'timeout'),
                    });
                    return null;
                }
                console.error(`❌ ApiSyncAdapter: Error getting ERP metadata for ${collection}:`, error);
                if (!this.isBlockingOperationalAuthError(error)) {
                    this.logOptionalMasterUnavailable({
                        operation,
                        collection,
                        endpoint,
                        status: 0,
                        reason: error instanceof Error ? error.message : String(error || 'METADATA_ERROR')
                    });
                    return null;
                }
                if (!this.wasDiagnosticReported(error)) {
                    reportSyncErrorDiagnostic({
                        operation,
                        collection,
                        endpoint,
                        httpStatus: error instanceof TypeError ? 'network error' : null,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, target.token)),
                    });
                }
                return null;
            }
        }

        if (!this.config) {
            return null;
        }

        if (!this.canUseLocalMasterSyncFallback()) {
            return null;
        }

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                return null; // Return null if cannot authenticate to avoid UI noise
            }
        }

        if (!this.isOnline) {
            return null;
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/collections/${collection}/metadata`, {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken
                }
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.getMetadata(collection);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                const error = new Error(`Get metadata failed: ${response.status} ${response.statusText}`);
                reportSyncErrorDiagnostic({
                    operation: collection === 'config' ? 'PULL_CONFIG' : 'PULL_MASTERS',
                    collection,
                    endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/metadata`,
                    httpStatus: response.status,
                    responseBody,
                    error,
                });
                throw error;
            }

            const data = await response.json();
            return {
                collection,
                lastSyncedAt: data.metadata.lastUpdated,
                version: data.metadata.version,
                itemCount: data.metadata.itemCount,
                fullSyncVersion: data.metadata.fullSyncVersion
            };

        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error getting metadata for ${collection}:`, error);
            reportSyncErrorDiagnostic({
                operation: collection === 'config' ? 'PULL_CONFIG' : 'PULL_MASTERS',
                collection,
                endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/metadata`,
                httpStatus: error instanceof TypeError ? 'network error' : null,
                error,
            });
            this.isOnline = false;
            return null;
        }
    }

    /**
     * Check if new data is available
     */
    async hasNewData(collection: string, localVersion: number): Promise<boolean> {
        const metadata = await this.getMetadata(collection);
        if (!metadata) return false;

        return metadata.version > localVersion;
    }

    /**
     * Get list of connected terminals (Master only)
     */
    async getConnectedTerminals(): Promise<any[]> {
        if (!this.config) return [];

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                return [];
            }
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/terminals`, {
                headers: { 'X-Sync-Token': this.authToken }
            });

            if (response.status === 401) {
                console.warn('⚠️ ApiSyncAdapter: Token expired fetching terminals, re-authenticating...');
                await this.authenticate();
                // Retry once
                const retryResponse = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/terminals`, {
                    headers: { 'X-Sync-Token': this.authToken || '' }
                });
                if (!retryResponse.ok) return [];
                const data = await retryResponse.json();
                return data.terminals || [];
            }

            if (!response.ok) return [];

            const data = await response.json();
            return data.terminals || [];
        } catch (error) {
            console.error('Error fetching terminals:', error);
            return [];
        }
    }

    /**
     * Get connection status
     */
    getConnectionStatus(): { isOnline: boolean; isAuthenticated: boolean; masterUrl: string | null } {
        return {
            isOnline: this.isOnline,
            isAuthenticated: !!this.authToken,
            masterUrl: this.config?.masterUrl || null
        };
    }

    /**
     * Push a single transaction to Master
     */
    private resolveClientErpBaseUrlForInbox(): string | undefined {
        if (typeof window === 'undefined') return undefined;
        try {
            const a = localStorage.getItem('CLIC_ERP_BASE_URL')?.trim();
            const b = localStorage.getItem('erp_base_url')?.trim();
            const vite =
                typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ERP_BASE_URL
                    ? String((import.meta as any).env.VITE_ERP_BASE_URL).trim()
                    : '';
            return a || b || vite || undefined;
        } catch {
            return undefined;
        }
    }

    private logCriticalSalesRequest(input: {
        authUrl: string;
        postUrl: string;
        terminalId: string;
        retryCount: number;
        token: string | null;
        txId?: string;
    }) {
        console.log(
            `[SYNC_SALES_HTTP] authUrl=${input.authUrl} postUrl=${input.postUrl} terminalId=${input.terminalId} retryCount=${input.retryCount} tokenPresent=${Boolean(input.token)} tx=${input.txId || 'n/a'}`
        );
    }

    private async postErpSalesTransactionWithSmartAuth(
        normalizedTransaction: any,
        txId: string,
        nativeDocument?: any
    ): Promise<{
        target: { baseUrl: string; terminalId: string; token: string; useLocalTarget: boolean; kind: ResolvedSyncTarget['kind'] };
        response: Response;
        text: string;
    }> {
        let target = await this.authenticateOperationalTarget(false, 'sales', 'PUSH_OPERATIONS');
        const postUrl = `${target.baseUrl}/transactions`;
        const authUrl = `${target.baseUrl}/auth`;

        for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
            const requestBody = this.buildOperationalPostBody(target, { items: [normalizedTransaction] });
            if (nativeDocument && isSyncFeatureEnabled('pending_operations_recovery')) {
                const { prepareCommercialOriginalReference } = await import('../recovery/recoveryService');
                const reference = await prepareCommercialOriginalReference(nativeDocument, (requestBody.items as unknown[])[0]);
                if (reference) requestBody.originalRefs = [{ itemIndex: 0, ...reference }];
            }
            this.logCriticalSalesRequest({
                authUrl,
                postUrl,
                terminalId: target.terminalId,
                retryCount,
                token: target.token,
                txId
            });
            const response = await this.fetchWithRetry(postUrl, {
                method: 'POST',
                headers: this.buildOperationalHeaders(target, target.token, true),
                body: JSON.stringify(requestBody)
            }, 2, 500, 'sales', 'PUSH_OPERATIONS');
            const text = await response.text();

            if (response.status !== 401 || retryCount === 1) {
                return { target, response, text };
            }

            console.warn(`[SYNC_SALES_HTTP] 401 for tx=${txId}; refreshing ERP sync token and replaying request immediately.`);
            this.erpAuthToken = null;
            target = await this.authenticateOperationalTarget(true, 'sales', 'PUSH_OPERATIONS');
        }

        throw new Error('ERP transaction sync failed: request was not attempted');
    }

    private async postLocalSalesTransactionWithSmartAuth(
        normalizedTransaction: any,
        txId: string,
        itemsCount: number | string,
        skipErpForward = false
    ): Promise<Response> {
        await this.ensurePushReady('sales');
        const erpBaseUrl = this.resolveClientErpBaseUrlForInbox();
        const postUrl = `${this.config!.masterUrl}/api/sync/transactions`;
        const authUrl = `${this.config!.masterUrl}/api/sync/auth`;

        for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
            if (!this.authToken || retryCount > 0) {
                this.authToken = null;
                await this.authenticate(true, 'sales');
            }

            this.logCriticalSalesRequest({
                authUrl,
                postUrl,
                terminalId: this.config!.terminalId,
                retryCount,
                token: this.authToken,
                txId
            });
            console.log(
                `[SYNC_TX_PUSH] POST ${postUrl} tx=${txId} source_tx=${normalizedTransaction.source_transaction_id} source_terminal=${normalizedTransaction.source_terminal_id || normalizedTransaction.terminalId} items=${itemsCount} erp_base_url=${erpBaseUrl ? 'sent' : 'MISSING'}`
            );
            const response = await this.fetchWithRetry(postUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({
                    items: [normalizedTransaction],
                    ...(erpBaseUrl ? { erp_base_url: erpBaseUrl } : {}),
                    ...(skipErpForward ? { skip_erp_forward: true } : {})
                })
            }, 2, 500, 'sales');

            if (response.status !== 401 || retryCount === 1) {
                return response;
            }

            console.warn(`[SYNC_SALES_HTTP] 401 for local sales tx=${txId}; refreshing sync token and replaying request immediately.`);
        }

        throw new Error('ERP transaction sync failed: request was not attempted');
    }

    private shouldSkipErpSaleSync(transaction: any): boolean {
        return Boolean(
            transaction?.skipErpSaleSync
            || transaction?.marketplaceSourceChannel === 'UBER_EATS'
        );
    }

    async pushTransaction(transaction: any): Promise<void> {
        if (isRecoveredOperation(transaction)) throw new Error('RECOVERED_OPERATION_NO_REPLAY');
        try {
            const normalizedTransaction = buildErpSalePayload(transaction);
            const operationalTarget = this.resolveOperationalTarget();
            const txId = String(normalizedTransaction.source_transaction_id || normalizedTransaction.id || transaction?.id || 'unknown');
            const itemsCount = Array.isArray((normalizedTransaction as any).items)
                ? (normalizedTransaction as any).items.length
                : typeof (normalizedTransaction as any).items === 'string'
                  ? `string(len=${String((normalizedTransaction as any).items).length})`
                  : 'none';
            const skipErpSaleSync = this.shouldSkipErpSaleSync(normalizedTransaction);

            if (operationalTarget && !operationalTarget.useLocalTarget) {
                if (skipErpSaleSync) {
                    console.log(`[SYNC_TX_PUSH] ERP direct skipped for tx=${txId} marketplace=${normalizedTransaction.marketplaceSourceChannel || 'n/a'}`);
                    return;
                }
                console.log(
                    `[SYNC_TX_PUSH] ERP direct start base=${operationalTarget.baseUrl} terminal=${operationalTarget.terminalId} tx=${txId} items=${itemsCount}`
                );
                const { target, response, text } = await this.postErpSalesTransactionWithSmartAuth(normalizedTransaction, txId, transaction);
                const syncBody = this.safeParseSyncJson(text);
                const responseAudit = syncBody || { raw: text };
                const isCloudStaging = target.kind === 'POS_CLOUD_STAGING';

                if (!response.ok) {
                    if (this.isIdempotentAppliedResponse(syncBody, text, false)) {
                        this.attachTransactionSyncAudit(transaction, responseAudit, 'SKIPPED_ALREADY_APPLIED');
                        console.warn(
                            `[SYNC_TX_PUSH] ERP direct idempotent OK tx=${txId} status=${response.status} body=${text.slice(0, 400)}`
	                    );
	                    return;
	                }
                    if (isCloudStaging && response.status >= 200 && response.status < 300) {
                        this.attachTransactionSyncAudit(transaction, responseAudit, 'STAGED');
                        console.warn(`[SYNC_TX_PUSH] Cloud staging accepted tx=${txId} with non-standard response body=${text.slice(0, 400)}`);
                        return;
                    }
	                    throw new Error(
	                        `ERP transaction sync failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`
	                    );
	                }

                if (isCloudStaging) {
                    this.attachTransactionSyncAudit(transaction, responseAudit, 'STAGED');
                    console.log(
                        `[SYNC_TX_PUSH] Cloud staging OK tx=${txId} host=${target.baseUrl} terminal=${target.terminalId} body=${text.slice(0, 400)}`
                    );
                    return;
                }
	
	                if (syncBody && typeof syncBody.applyFailedCount === 'number' && syncBody.applyFailedCount > 0) {
                    if (this.allApplyIssuesAreIdempotent(syncBody.applyIssues || syncBody.results || syncBody)) {
                        this.attachTransactionSyncAudit(transaction, syncBody, 'SKIPPED_ALREADY_APPLIED');
                        console.warn(
                            `[SYNC_TX_PUSH] ERP direct idempotent apply failure accepted tx=${txId}`,
                            syncBody.applyIssues
                        );
                        return;
                    }
                    console.error(
                        `[SYNC_TX_PUSH] ERP /api/sync/transactions applyFailedCount=${syncBody.applyFailedCount}`,
                        syncBody.applyIssues
                    );
                    throw new Error(`ERP did not persist sale (apply failures): ${JSON.stringify(syncBody.applyIssues || [])}`);
                }
                if (this.hasRealApplyErrorResponse(syncBody, text)) {
                    throw new Error(`ERP did not persist sale (apply error): ${text.slice(0, 400)}`);
                }
                if (!this.hasErpApplyConfirmation(syncBody, text)) {
                    throw new Error(`ERP did not confirm sale persistence: ${text.slice(0, 400) || 'empty response'}`);
                }

                this.attachTransactionSyncAudit(transaction, responseAudit, 'APPLIED');

                console.log(
                    `[SYNC_TX_PUSH] ERP direct OK tx=${txId} host=${target.baseUrl} terminal=${target.terminalId} body=${text.slice(0, 400)}`
                );
                return;
            }

            console.log(
                `[SYNC_TX_PUSH] pre-auth masterUrl=${this.config?.masterUrl || 'n/a'} terminalId=${this.config?.terminalId || 'n/a'} hasToken=${!!this.authToken}`
            );
            const response = await this.postLocalSalesTransactionWithSmartAuth(
                normalizedTransaction,
                txId,
                itemsCount,
                skipErpSaleSync
            );

            if (!response.ok) {
                const errorText = await response.text();
                let errBody: any = null;
                let detail = errorText.slice(0, 400);
                try {
                    errBody = errorText ? JSON.parse(errorText) : null;
                    detail =
                        errBody?.message ||
                        errBody?.error ||
                        errBody?.detail ||
                        (errBody?.erpInbox ? JSON.stringify(errBody.erpInbox) : detail);
                } catch {
                    // plain-text body
                }

                const candidateTexts = [
                    errorText,
                    errBody?.message,
                    errBody?.error,
                    errBody?.detail,
                    errBody?.erpInbox?.message,
                    errBody?.erpInbox?.error
                ]
                    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                    .map((value) => value.toLowerCase());

                const masterAcceptedLocally =
                    response.status === 502 &&
                    ((typeof errBody?.savedLocally === 'boolean' && errBody.savedLocally) ||
                        (typeof errBody?.persistedLocally === 'boolean' && errBody.persistedLocally) ||
                        candidateTexts.some((value) =>
                            value.includes('local master saved the sale') ||
                            value.includes('saved the sale locally') ||
                            value.includes('saved locally') ||
                            value.includes('persisted locally') ||
                            value.includes('forward to erp failed')
                        ));

                if (masterAcceptedLocally) {
                    console.warn(
                        `[SYNC_TX_PUSH] Master persisted tx=${txId} locally but ERP forwarding failed. Accepting slave sync and leaving ERP retry to master. body=${detail}`
                    );
                    this.attachTransactionSyncAudit(transaction, errBody || { raw: errorText }, 'APPLIED');
                    return;
                }

                if (this.isIdempotentAppliedResponse(errBody, errorText, false)) {
                    console.warn(
                        `[SYNC_TX_PUSH] Master/ERP returned duplicate already-applied for tx=${txId}. Marking local sync completed. body=${detail}`
                    );
                    this.attachTransactionSyncAudit(transaction, errBody || { raw: errorText }, 'SKIPPED_ALREADY_APPLIED');
                    return;
                }

                throw new Error(
                    `Push transaction failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
                );
            }

            let syncBody: any = null;
            try {
                syncBody = await response.json();
            } catch {
                // non-JSON response
            }
            const erp = syncBody?.erpInbox;
            const r0 = Array.isArray(erp?.results) ? erp.results[0] : null;
            console.log(
                `[SYNC_TX_PUSH] master_response applyFailedCount=${syncBody?.applyFailedCount ?? 'n/a'} erpInbox_skipped=${erp?.skipped ?? 'n/a'} erpInbox_failed=${erp?.failed ?? 'n/a'} sync_id=${r0?.syncId ?? 'n/a'} erp_document_id=${r0?.erpDocumentId ?? 'n/a'} apply_err=${r0?.error ?? 'n/a'}`
            );
            if (syncBody && typeof syncBody.applyFailedCount === 'number' && syncBody.applyFailedCount > 0) {
                if (this.allApplyIssuesAreIdempotent(syncBody.applyIssues || erp?.results || syncBody)) {
                    console.warn(
                        `[SYNC_TX_PUSH] Master response contained idempotent apply failures for tx=${txId}. Marking completed.`,
                        syncBody.applyIssues
                    );
                    this.attachTransactionSyncAudit(transaction, syncBody, 'SKIPPED_ALREADY_APPLIED');
                    return;
                }
                console.error(
                    `[SYNC_TX_PUSH] ERP /api/sync/transactions applyFailedCount=${syncBody.applyFailedCount}`,
                    syncBody.applyIssues
                );
                throw new Error(`ERP did not persist sale (apply failures): ${JSON.stringify(syncBody.applyIssues || [])}`);
            }
            if (erp?.skipped) {
                throw new Error(`ERP did not persist sale (skipped): ${JSON.stringify(erp).slice(0, 400)}`);
            }
            if (erp?.failed && !this.isIdempotentAppliedResponse(erp, JSON.stringify(erp), true)) {
                throw new Error(`ERP did not persist sale (apply error): ${JSON.stringify(erp).slice(0, 400)}`);
            }
            if (this.hasRealApplyErrorResponse(syncBody, JSON.stringify(syncBody))) {
                throw new Error(`ERP did not persist sale (apply error): ${JSON.stringify(syncBody).slice(0, 400)}`);
            }
            if (!this.hasErpApplyConfirmation(syncBody, JSON.stringify(syncBody))) {
                throw new Error(`ERP did not confirm sale persistence: ${JSON.stringify(syncBody).slice(0, 400)}`);
            }
            this.attachTransactionSyncAudit(transaction, syncBody, 'APPLIED');
            if (erp?.skipped) {
                console.warn(
                    `[SYNC_TX_PUSH] Master OK but ERP inbox skipped (${erp.reason || 'NO_ERP_URL'}). Configure CLIC_ERP_BASE_URL / erp_base_url localStorage or ERP_BASE_URL on Master. tx=${txId}`
                );
            } else if (erp?.failed) {
                console.error(`[SYNC_TX_PUSH] Unexpected erpInbox.failed in 200 response tx=${txId}`);
            } else {
                const types = Array.isArray(erp?.results) ? erp.results.map((r: any) => r.eventType).join(', ') : 'SALE_POSTED';
                const docIds = Array.isArray(erp?.results)
                    ? erp.results.map((r: any) => r.erpDocumentId).filter(Boolean).join(', ')
                    : '';
                console.log(
                    `[SYNC_TX_PUSH] ERP inbox OK [${types}] tx=${txId} host=${erp?.erpBaseUrlUsed || 'n/a'} erp_document_id=${docIds || 'n/a'}`
                );
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing transaction:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single inventory movement to Master
     */
    async pushInventoryMovement(movement: any): Promise<void> {
        try {
            const payload = buildErpInventoryLedgerPayload(movement);
            const acknowledgement = await this.postOperationalPayload('/inventory/movements', { items: [payload] });
            assertOperationalAcknowledgement(
                acknowledgement,
                String(payload.source_inventory_movement_id || payload.id),
                'INVENTORY',
            );
            console.log(`📤 ApiSyncAdapter: Pushed inventory movement ${payload.source_inventory_movement_id || payload.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing inventory movement:', error);
            this.isOnline = false;
            throw error;
        }
    }

    async pushCustomerMutation(mutation: any): Promise<void> {
        try {
            const customerId = String(mutation?.customerId || mutation?.customer?.id || '').trim();
            if (!customerId) throw new Error('CUSTOMER_ID_MISSING');
            const acknowledgement = await this.postOperationalPayload('/customers/upsert', {
                items: [buildCustomerMutationEnvelope({ ...mutation, customerId, operation: mutation.operation || 'UPSERT' })],
            });
            assertOperationalAcknowledgement(acknowledgement, String(mutation.id), 'CUSTOMER');
            assertCustomerNumberAcknowledgement(acknowledgement, mutation.customer);
            console.log(`📤 ApiSyncAdapter: Pushed customer mutation ${mutation.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing customer mutation:', error);
            this.isOnline = false;
            throw error;
        }
    }

    async sendCatalogEdit(edit: import('./CatalogEditQueue').CatalogEdit): Promise<import('./CatalogEditQueue').CatalogResult> {
        const { catalogScopeMatches } = await import('./catalogEdits');
        if (!catalogScopeMatches(edit.scope)) throw new Error('El cambio pertenece a otra vinculación.');
        return this.postOperationalPayload('/catalog-edits/mutations', {
            scope: edit.scope, mutation: edit.mutation,
        }, { reauthenticateOn401: false });
    }

    async pushPosUserMutation(mutation: any): Promise<void> {
        try {
            const mutationId = String(mutation?.id || '').trim();
            const sourceUserId = String(mutation?.sourceUserId || '').trim();
            if (!mutationId) throw new Error('POS_USER_MUTATION_ID_MISSING');
            if (!sourceUserId) throw new Error('POS_USER_SOURCE_ID_MISSING');

            const acknowledgement = await this.postOperationalPayload('/pos-users/mutations', {
                items: [{
                    mutationId,
                    sourceUserId,
                    sourceTerminalId: mutation.terminalId,
                    operation: mutation.operation || 'UPSERT',
                    user: mutation.user,
                    createdAt: mutation.createdAt,
                }],
            });
            if (!acknowledgement) {
                throw new Error('POS_USER_ACK_MISSING: ERP no confirmó la mutación');
            }
            assertOperationalAcknowledgement(acknowledgement, mutationId, 'POS_USER');
            console.log(`📤 ApiSyncAdapter: Pushed POS user mutation ${mutationId}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing POS user mutation:', error);
            throw error;
        }
    }

    async saveCurrencies(currencies: any[], actor: { userId: string; userName: string; terminalId?: string }): Promise<any> {
        const mutationId = `currency-upsert-${Date.now()}`;
        const acknowledgement = await this.postOperationalPayload('/currencies/upsert', {
            mutationId,
            currencies,
            actor,
        });
        assertOperationalAcknowledgement(acknowledgement, mutationId, 'CURRENCY');
        return acknowledgement;
    }

    async saveTaxes(taxes: any[], actor: { userId: string; userName: string; terminalId?: string }): Promise<any> {
        const mutationId = `tax-upsert-${Date.now()}`;
        const acknowledgement = await this.postOperationalPayload('/taxes/upsert', {
            mutationId,
            taxes,
            actor,
        });
        assertOperationalAcknowledgement(acknowledgement, mutationId, 'TAX');
        return acknowledgement;
    }

    async scheduleCurrencyRate(schedule: Record<string, unknown>): Promise<any> {
        const scheduleId = String(schedule.id || `currency-schedule-${Date.now()}`);
        const acknowledgement = await this.postOperationalPayload('/currencies/schedules', {
            items: [{ ...schedule, id: scheduleId }],
        });
        assertOperationalAcknowledgement(acknowledgement, scheduleId, 'CURRENCY_SCHEDULE');
        return acknowledgement;
    }

    async getCurrencyAudit(currencyCode: string): Promise<any[]> {
        const payload = await this.getOperationalPayload<any>(`/currencies/audit/${encodeURIComponent(currencyCode)}`);
        return Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    }

    /**
     * Push a single inventory count session por el canal operativo (ERP o Master
     * local). Antes se enviaba siempre al Master con una ruta que no existía en
     * el servidor Android.
     */
    async pushInventoryCount(countSession: any): Promise<void> {
        try {
            await this.ensurePushReady();
            await this.postOperationalPayload('/inventory/counts', { items: [countSession] });
            console.log(`📤 ApiSyncAdapter: Pushed inventory count ${countSession.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing inventory count:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single cash movement to Master
     */
    async pushCashMovement(movement: any): Promise<void> {
        if (isRecoveredOperation(movement)) throw new Error('RECOVERED_OPERATION_NO_REPLAY');
        try {
            const normalizedMovement = buildErpCashMovementPayload(movement);
            await this.postOperationalPayload('/cash/movements', { items: [normalizedMovement] }, isSyncFeatureEnabled('pending_operations_recovery') ? { reauthenticateOn401: false, expectedRecoveryScope: originalProvenance().key, recoveryOriginal: {document:movement,collection:'cashMovements'} } : {});
            console.log(`📤 ApiSyncAdapter: Pushed cash movement ${normalizedMovement.source_cash_movement_id || normalizedMovement.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing cash movement:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single Z-Report to Master
     */
    async pushZReport(report: any): Promise<void> {
        if (isRecoveredOperation(report)) throw new Error('RECOVERED_OPERATION_NO_REPLAY');
        try {
            const normalizedReport = buildErpZReportPayload(report);
            await this.postOperationalPayload('/z-reports', { items: [normalizedReport] });
            console.log(`📤 ApiSyncAdapter: Pushed Z-Report ${normalizedReport.source_z_report_id || normalizedReport.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing Z-Report:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push wallet / loyalty operational events (normalized, idempotent by source_event_id on Master).
     */
    async pushOperationalEvents(items: Record<string, unknown>[]): Promise<void> {
        if (items.some(isRecoveredOperation)) throw new Error('RECOVERED_OPERATION_NO_REPLAY');
        if (!items.length) return;
        try {
            const normalized = items.map((row) => {
                const channel = String((row as any).operationalChannel || '').toUpperCase();
                if (channel === 'LOYALTY') {
                    return buildErpLoyaltyEventPayload(row);
                }
                return buildErpWalletEventPayload(row);
            });
            await this.postOperationalPayload('/operational/events', { items: normalized });
            console.log(`📤 ApiSyncAdapter: Pushed ${normalized.length} operational event(s)`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing operational events:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * POS-2B durable batch. The ERP responds with one result per stable eventId,
     * allowing the caller to retry only failed events.
     */
    async pushDurableOutboxBatch(events: object[]): Promise<any> {
        if (!events.length) return { results: [] };
        if (events.length > 50) throw new Error('BATCH_EVENT_LIMIT_EXCEEDED');

        // La capacidad del ERP manda, no el host: con `supports_batch_inbox !== true`
        // (Alfa-RMS hoy) el lote responde 404 SYNC_BATCH_INBOX_DISABLED y el outbox durable
        // se quedaría reintentando. Se envía evento por evento por `/inbox`.
        const supportsBatchInbox = await getSupportsBatchInbox();
        if (!supportsBatchInbox) {
            return this.pushDurableOutboxEventsOneByOne(events);
        }

        try {
            return await this.postOperationalPayload('/inbox/batch', { events }, {
                maxRequestBytes: 512 * 1024,
            });
        } catch (error) {
            if (!isBatchInboxDisabledError(error)) throw error;

            markBatchInboxUnavailable();
            console.info(
                `🔁 ApiSyncAdapter: /inbox/batch no disponible en el ERP; reenviando ${events.length} evento(s) por /inbox`,
            );
            return this.pushDurableOutboxEventsOneByOne(events);
        }
    }

    /**
     * Envío evento por evento por `POST /inbox` con el contrato del ERP
     * (`event_id`, `event_type`, `payload`).
     *
     * Devuelve un resultado por evento para que el outbox durable conserve su semántica de
     * ack individual (idempotente por `event_id` del lado del ERP).
     */
    private async pushDurableOutboxEventsOneByOne(events: object[]): Promise<any> {
        const eventResults: Array<{ eventId: string; status: string }> = [];

        for (const event of events) {
            const wire = event as Record<string, unknown>;
            const single = toErpInboxEvent(wire);
            const response = await this.postOperationalPayload('/inbox', single);
            const payload = (response && typeof response === 'object') ? response as Record<string, unknown> : {};
            const status = String(payload.status || '').trim().toLowerCase();
            const duplicate = payload.duplicate === true || status === 'duplicate' || status === 'already_applied';

            eventResults.push({
                eventId: single.event_id,
                status: duplicate ? 'DUPLICATE' : 'RECEIVED',
            });
        }

        return { eventResults };
    }

    /**
     * Pull pending transactions (Master only)
     */
    async pullPendingTransactions(): Promise<any[]> {
        if (!this.config || !this.isOnline) return [];

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/transactions/pending`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull pending transactions failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling pending transactions:', error);
            return [];
        }
    }

    /**
     * Acknowledge pending transactions (Master only)
     */
    async ackPendingTransactions(ids: string[]): Promise<void> {
        if (!this.config || !this.isOnline) return;
        if (!ids || ids.length === 0) return;

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/transactions/pending/ack`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.ackPendingTransactions(ids);
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error acknowledging pending transactions:', error);
        }
    }

    /**
     * Pull pending inventory movements (Master only)
     */
    async pullPendingInventoryMovements(): Promise<any[]> {
        if (!this.config || !this.isOnline) return [];

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/movements/pending`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull pending inventory movements failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling pending inventory movements:', error);
            return [];
        }
    }

    /**
     * Acknowledge pending inventory movements (Master only)
     */
    async ackPendingInventoryMovements(ids: string[]): Promise<void> {
        if (!this.config || !this.isOnline) return;
        if (!ids || ids.length === 0) return;

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/movements/pending/ack`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.ackPendingInventoryMovements(ids);
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error acknowledging pending inventory movements:', error);
        }
    }

    /**
     * Report a sync error to Master
     */
    async reportError(error: string, itemType: string, itemId: string): Promise<void> {
        if (!this.config || !this.isOnline) return;

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/errors`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({
                    error,
                    itemType,
                    itemId,
                    terminalId: this.config.terminalId,
                    timestamp: new Date().toISOString()
                })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.reportError(error, itemType, itemId);
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error reporting sync error:', error);
        }
    }

    /**
     * Pull all historical data for a terminal (new device inheritance)
     */
    async pullHistory(terminalId: string): Promise<any> {
        if (!this.config || !this.isOnline) return null;

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/history/${terminalId}`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull history failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling history:', error);
            return null;
        }
    }

    /**
     * Get operational status (Master only)
     */
    async getOperationalStatus(): Promise<any> {
        if (!this.config) return null;

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                return null;
            }
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/operational-status`, {
                headers: { 'X-Sync-Token': this.authToken }
            });

            if (response.status === 401) {
                console.warn('⚠️ ApiSyncAdapter: Token expired fetching operational status, re-authenticating...');
                await this.authenticate();
                // Retry once
                const retryResponse = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/operational-status`, {
                    headers: { 'X-Sync-Token': this.authToken || '' }
                });
                if (!retryResponse.ok) return null;
                const data = await retryResponse.json();
                return data;
            }

            if (!response.ok) return null;

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching operational status:', error);
            return null;
        }
    }

    async retryErpForwardQueue(ids?: string[]): Promise<any> {
        if (!this.config) return null;

        if (!this.authToken) {
            await this.authenticate();
        }

        const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/erp-forward/retry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': this.authToken || ''
            },
            body: JSON.stringify({ ids: Array.isArray(ids) ? ids : undefined })
        });

        if (response.status === 401) {
            await this.authenticate(true);
            const retryResponse = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/erp-forward/retry`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids: Array.isArray(ids) ? ids : undefined })
            });
            if (!retryResponse.ok) {
                throw new Error(`ERP forward retry failed: ${retryResponse.status} ${retryResponse.statusText}`);
            }
            return retryResponse.json();
        }

        if (!response.ok) {
            throw new Error(`ERP forward retry failed: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Pull global configuration from Master
     */
    async pullConfig(): Promise<any> {
        const operationalTarget = this.resolveOperationalTarget('PULL_CONFIG');
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            const data = await this.getOperationalPayload<{ config?: any }>('/config', 'PULL_CONFIG');
            return data?.config || data || null;
        }

        if (!this.config) return null;
        if (!this.authToken) await this.authenticate();

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/config`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            }, 2, 500, 'background', 'PULL_CONFIG');

            if (response.status === 401) {
                await this.authenticate();
                return this.pullConfig();
            }

            if (!response.ok) throw new Error(`Pull config failed: ${response.statusText}`);

            const data = await response.json();
            return data.config;
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling config:', error);
            throw error;
        }
    }

    /**
     * Pull lightweight stock balances for all products (used by Slaves)
     */
    async pullStockBalances(): Promise<any[]> {
        if (!this.config || !this.isOnline) return [];

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/stock-balances`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull stock balances failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.balances || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling stock balances:', error);
            return [];
        }
    }

    async pullOperationalStockBalances(productId?: string): Promise<any[]> {
        try {
            if (isPosOnlyCloudStagingTarget()) {
                return [];
            }

            if (!this.isErpActiveOperationalTarget()) {
                const query = productId ? `?product_id=${encodeURIComponent(productId)}` : '';
                const data = await this.getOperationalPayload<{ balances?: any[] }>(`/inventory/stock-balances${query}`);
                return Array.isArray(data?.balances) ? data.balances : [];
            }

            const context = this.resolveOperationalInventoryContext();
            if (!context.terminalId || !context.syncApiBase) {
                console.warn('⚠️ ApiSyncAdapter: Missing ERP terminal inventory context for operational balances');
                return [];
            }

            const params = new URLSearchParams();
            if (context.tenantId) params.set('tenant_id', context.tenantId);
            if (context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);

            const endpoint = `${context.syncApiBase}/terminals/${encodeURIComponent(context.terminalId)}/inventory?${params.toString()}`;
            const response = await this.fetchWithoutCircuitBreaker(endpoint, {
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Operational inventory block failed: ${response.status} ${response.statusText}`);
            }

            const payload = (await response.json()) as TerminalInventoryPayload;
            const normalizedPayload = this.normalizeTerminalInventoryPayload(payload);
            return normalizedPayload.balances.filter((balance) => this.matchesInventoryBalanceProduct(balance, productId));
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling operational stock balances:', error);
            return [];
        }
    }

    async pullOperationalStockBalanceMap(productId?: string): Promise<Record<string, number>> {
        const cacheKey = this.buildOperationalStockBalanceCacheKey(productId);
        const previous = this.lastOperationalStockBalanceMaps.get(cacheKey) || {};

        try {
            if (isPosOnlyCloudStagingTarget()) {
                return previous;
            }

            if (!this.isErpActiveOperationalTarget()) {
                const balances = await this.pullOperationalStockBalances(productId);
                const nextMap = this.buildOperationalStockBalanceMap(balances);
                if (Object.keys(nextMap).length > 0) {
                    this.lastOperationalStockBalanceMaps.set(cacheKey, nextMap);
                    return nextMap;
                }
                return previous;
            }

            const context = this.resolveOperationalInventoryContext();
            if (!context.terminalId || !context.syncApiBase) {
                console.error('❌ ApiSyncAdapter: Missing ERP inventory context', context);
                return previous;
            }

            const params = new URLSearchParams();
            if (context.tenantId) params.set('tenant_id', context.tenantId);
            if (context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);

            const endpoint = `${context.syncApiBase}/terminals/${encodeURIComponent(context.terminalId)}/inventory?${params.toString()}`;
            const response = await this.fetchWithoutCircuitBreaker(endpoint, {
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                console.error('❌ ApiSyncAdapter: ERP inventory request failed', {
                    endpoint,
                    status: response.status,
                    statusText: response.statusText,
                    detail,
                });
                return previous;
            }

            const payload = await response.json();
            const normalizedPayload = this.normalizeTerminalInventoryPayload(payload);
            const filteredBalances = normalizedPayload.balances.filter((balance: any) => this.matchesInventoryBalanceProduct(balance, productId));
            const nextMap = this.buildOperationalStockBalanceMap(filteredBalances);

            if (Object.keys(nextMap).length > 0) {
                this.lastOperationalStockBalanceMaps.set(cacheKey, nextMap);
                return nextMap;
            }

            console.error('❌ ApiSyncAdapter: ERP inventory payload parsed without balances', {
                endpoint,
                productId,
                payload,
            });
            return previous;
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling operational stock balance map:', {
                productId,
                error,
                previous,
            });
            return previous;
        }
    }

    /**
     * Pull Kardex for a specific product on-demand
     */
    async pullKardexOnDemand(productId: string): Promise<any[]> {
        try {
            if (isPosOnlyCloudStagingTarget()) {
                return [];
            }

            if (this.isErpActiveOperationalTarget()) {
                const data = await this.getOperationalPayload<{ items?: any[] }>(`/inventory/kardex/${encodeURIComponent(productId)}`);
                return data.items || [];
            }

            if (!this.config || !this.isOnline) return [];

            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/kardex/${productId}`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull Kardex failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling Kardex for ${productId}:`, error);
            return [];
        }
    }

    /**
     * Reset all operational data for a specific terminal on the Master server
     */
    async resetTerminalData(terminalId: string): Promise<void> {
        if (!this.config || !this.isOnline) return;

        if (!this.authToken) {
            await this.authenticate();
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/reset/${terminalId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                }
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.resetTerminalData(terminalId);
            }

            if (!response.ok) {
                throw new Error(`Reset terminal data failed: ${response.statusText}`);
            }

            console.log(`✅ ApiSyncAdapter: Reset terminal data for ${terminalId} on Master`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error resetting terminal data:', error);
            throw error;
        }
    }

    /**
     * Clear authentication (for testing or logout)
     */
    clearAuth(): void {
        this.authToken = null;
    }
    /**
     * Fetch lightweight product image manifest
     */
    async fetchImageManifest(currentVersion: number): Promise<{ version: number; items: ProductImageManifestItem[]; upToDate: boolean }> {
        if (!this.config || !this.isOnline) return { version: currentVersion, items: [], upToDate: true };

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/images/manifest?v=${currentVersion}`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (response.status === 304) {
                return { version: currentVersion, items: [], upToDate: true };
            }

            if (!response.ok) {
                throw new Error(`Fetch image manifest failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                version: data.version,
                items: data.items || [],
                upToDate: false
            };
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error fetching image manifest:', error);
            return { version: currentVersion, items: [], upToDate: true };
        }
    }

    /**
     * Pull batch of product images
     */
    async pullImages(ids: string[]): Promise<ProductImagePayloadItem[]> {
        if (!this.config || !this.isOnline || ids.length === 0) return [];

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/images/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (!response.ok) {
                throw new Error(`Pull images failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling images:', error);
            return [];
        }
    }
}

/**
 * Detecta el rechazo del lote por capacidad (`SYNC_BATCH_INBOX_DISABLED`) tanto si el
 * adaptador lo expone como `httpStatus` como si sólo llega en el mensaje.
 */
const isBatchInboxDisabledError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.toUpperCase().includes('SYNC_BATCH_INBOX_DISABLED')) return true;
    const httpStatus = Number((error as { httpStatus?: unknown } | null)?.httpStatus);
    return httpStatus === 404 && /batch/i.test(message);
};

export const apiSyncAdapter = new ApiSyncAdapter();
