import { getStoredTenantIdentity } from './cloudMasterRegistry';
import { DEFAULT_ERP_SYNC_API_URL, normalizeCloudUrl } from './cloudDefaults';
import { v5 as uuidv5 } from 'uuid';
import { db } from './db';
import { DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS } from '../constants';
import { getDefaultRoleConfig } from './deviceRoleHelpers';
import {
    AuthLevel,
    BusinessConfig,
    Customer,
    DeviceRole,
    DeviceRoleConfig,
    DocumentSeries,
    FiscalRangeDGII,
    PaymentMethodDefinition,
    Product,
    Supplier,
    TerminalConfig,
    Warehouse,
} from '../types';

type TenantIdentity = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
};

type SyncActivationState = {
    tenant_id?: string | null;
    company_ref?: string | null;
    mode?: string | null;
    erp_enabled?: boolean;
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
    app_version_code?: number | null;
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
};

type SyncHeartbeatResponse = {
    status: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
};

type SyncInboxResponse = {
    status: string;
    message?: string;
    duplicate?: boolean;
    sync_id?: string;
};

type SyncOutboxEvent = {
    id: string;
    event_type: string;
    payload?: Record<string, unknown> | null;
    status?: string;
    created_at?: string;
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

type SyncBootstrapSnapshotResponse = {
    status: string;
    snapshot_id?: string;
    validation?: {
        ready_for_documents?: boolean;
    } | null;
    bootstrap_state?: {
        status?: string;
    } | null;
};

type SyncBootstrapValidateResponse = {
    status: string;
    validation?: {
        ready_for_documents?: boolean;
    } | null;
    bootstrap_state?: {
        status?: string;
    } | null;
};

type SyncBootstrapCompleteResponse = {
    status: string;
    message?: string;
    validation?: {
        ready_for_documents?: boolean;
    } | null;
    bootstrap_state?: {
        status?: string;
    } | null;
};

type RuntimeDeviceInfo = {
    versionName?: string | null;
    versionCode?: number | string | null;
    localIp?: string | null;
    localIps?: string[] | null;
};

type EnsureLifecycleParams = {
    deviceId: string;
    terminalId: string;
    terminalName?: string | null;
    isPrimary?: boolean;
    pendingEvents?: number;
    companyId?: string | null;
    storeId?: string | null;
};

type SalePostedInput = {
    id: string;
    displayId?: string | null;
    date?: string | null;
    total?: number | null;
    taxAmount?: number | null;
    netAmount?: number | null;
    discountAmount?: number | null;
    documentType?: string | null;
    ncf?: string | null;
    status?: string | null;
    userId?: string | null;
    userName?: string | null;
    terminalId?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    items?: unknown[];
    payments?: unknown[];
    [key: string]: unknown;
};

type BootstrapEventPayload = {
    tenant_id?: string | null;
    company_id?: string | null;
    store_id?: string | null;
    terminal_id?: string | null;
    device_id?: string | null;
    bootstrap_mode?: string | null;
    required_entities?: string[];
};

type SyncTerminalSnapshot = {
    terminal_id?: string | null;
    terminal_name?: string | null;
    device_id?: string | null;
    role?: string | null;
    config?: Record<string, unknown> | null;
    resolved?: Record<string, unknown> | null;
};

type ProcessErpOutboxParams = {
    deviceId: string;
    terminalId: string;
};

const SYNC_API_URL_STORAGE_KEY = 'CLIC_ERP_SYNC_URL';
const SYNC_BINDING_TENANT_KEY = 'clic_erp_sync_tenant_id';
const SYNC_BINDING_TERMINAL_KEY = 'clic_erp_sync_terminal_id';
const SYNC_BINDING_COMPANY_KEY = 'clic_erp_sync_company_id';
const SYNC_BINDING_STORE_KEY = 'clic_erp_sync_store_id';
const SYNC_BINDING_LAST_SEEN_KEY = 'clic_erp_sync_last_seen';
const SYNC_BINDING_STATUS_KEY = 'clic_erp_sync_status';
const ERP_SALE_EVENT_NAMESPACE = 'b38114f6-930e-4b2d-b5e7-523de8386b6c';
const BOOTSTRAP_ENTITY_KEY_MAP: Record<string, string> = {
    WAREHOUSE: 'warehouses',
    CURRENCY: 'currencies',
    TAX: 'taxes',
    DOCUMENT_TYPE: 'document_types',
    DOCUMENT_SERIES: 'document_series',
    FISCAL_RANGE: 'fiscal_ranges',
    CUSTOMER: 'customers',
    SUPPLIER: 'suppliers',
    ITEM: 'items',
    PAYMENT_METHOD: 'payment_methods',
};
const DEFAULT_BOOTSTRAP_ENTITY_TYPES = Object.keys(BOOTSTRAP_ENTITY_KEY_MAP);

let outboxProcessingPromise: Promise<{ processed: number; applied: number; failed: number } | null> | null = null;

const normalizeOptional = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
const normalizeEntityCode = (value?: string | null) => normalizeOptional(value || null);
const uniqueStrings = (values: unknown) => Array.from(
    new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeOptional(String(value || '')))
            .filter(Boolean)
    )
);
const asObject = <T>(value: unknown): T =>
    (value && typeof value === 'object' && !Array.isArray(value) ? value as T : {} as T);
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
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
    const normalized = normalizeOptional(String(value || '')).toUpperCase();

    switch (normalized) {
        case DeviceRole.SELF_CHECKOUT:
            return DeviceRole.SELF_CHECKOUT;
        case DeviceRole.PRICE_CHECKER:
            return DeviceRole.PRICE_CHECKER;
        case DeviceRole.HANDHELD_INVENTORY:
            return DeviceRole.HANDHELD_INVENTORY;
        case DeviceRole.KITCHEN_DISPLAY:
            return DeviceRole.KITCHEN_DISPLAY;
        case DeviceRole.STANDARD_POS:
        default:
            return DeviceRole.STANDARD_POS;
    }
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
    const touchTargetSize = toFiniteNumber(
        incoming.touchTargetSize
        ?? incomingUi.touchTargetSize
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
    const authLevel = resolveAuthLevel(incoming.authLevel)
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

const buildCompatibleInventoryScope = (
    currentInventoryScope: TerminalConfig['inventoryScope'],
    resolvedInventory: Record<string, unknown>
): TerminalConfig['inventoryScope'] => {
    const warehouses = asArray<Record<string, unknown>>(resolvedInventory.warehouses);
    const visibleWarehouseIds = uniqueStrings(warehouses.map((warehouse) => warehouse?.id));
    const defaultSalesWarehouseId = normalizeOptional(
        String(
            resolvedInventory.default_warehouse_id
            || asObject<Record<string, unknown>>(resolvedInventory.default_warehouse).id
            || currentInventoryScope?.defaultSalesWarehouseId
            || ''
        )
    );

    if (!defaultSalesWarehouseId && visibleWarehouseIds.length === 0) {
        return currentInventoryScope;
    }

    return {
        defaultSalesWarehouseId: defaultSalesWarehouseId || currentInventoryScope?.defaultSalesWarehouseId || '',
        visibleWarehouseIds: visibleWarehouseIds.length > 0
            ? visibleWarehouseIds
            : currentInventoryScope?.visibleWarehouseIds || [],
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
    const incomingConfig = asObject<Record<string, unknown>>(snapshot.config);

    if (!snapshot.terminal_id && Object.keys(incomingConfig).length === 0) {
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

    const resolvedTerminalId = normalizeOptional(snapshot.terminal_id || fallbackTerminalId || null);
    const targetIndex = localConfig.terminals.findIndex((terminal) =>
        (resolvedTerminalId && terminal.id === resolvedTerminalId)
        || terminal.config?.currentDeviceId === deviceId
    );

    if (targetIndex === -1) {
        return false;
    }

    const targetTerminal = localConfig.terminals[targetIndex];
    const currentConfig: TerminalConfig = targetTerminal.config || ({} as TerminalConfig);
    const incomingOperational = asObject<Record<string, unknown>>(incomingConfig.operational);
    const incomingCatalog = asObject<Record<string, unknown>>(incomingConfig.catalog);
    const incomingPricing = asObject<Record<string, unknown>>(incomingConfig.pricing);
    const incomingDocuments = asObject<Record<string, unknown>>(incomingConfig.documents);
    const resolvedSnapshot = asObject<Record<string, unknown>>(snapshot.resolved);
    const resolvedInventory = asObject<Record<string, unknown>>(resolvedSnapshot.inventory);
    const allowedCategories = asStringList(
        incomingCatalog.allowedCategories
        ?? currentConfig.catalog?.allowedCategories
    );
    const allowedTariffIds = asStringList(
        incomingPricing.allowedTariffIds
        ?? currentConfig.pricing?.allowedTariffIds
    );
    const defaultTariffId = normalizeOptional(
        String(incomingPricing.defaultTariffId || currentConfig.pricing?.defaultTariffId || '')
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
        defaultTariffId: defaultTariffId || currentConfig.pricing?.defaultTariffId || '',
    } as TerminalConfig['pricing'];
    const nextDocumentAssignments = {
        ...DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS,
        ...(currentConfig.documentAssignments || {}),
        ...incomingAssignments,
    } as NonNullable<TerminalConfig['documentAssignments']>;
    const nextTerminalConfig: TerminalConfig = {
        ...currentConfig,
        deviceRole: buildCompatibleDeviceRoleConfig(currentConfig.deviceRole, incomingConfig.deviceRole),
        operational: nextOperational,
        catalog: nextCatalog,
        pricing: nextPricing,
        documentAssignments: nextDocumentAssignments,
        inventoryScope: buildCompatibleInventoryScope(currentConfig.inventoryScope, resolvedInventory),
    };

    const nextTerminals = localConfig.terminals.map((terminal, index) => {
        if (index !== targetIndex) {
            return terminal;
        }

        return {
            ...terminal,
            id: resolvedTerminalId || terminal.id,
            config: nextTerminalConfig,
        };
    });

    const nextConfig: BusinessConfig = {
        ...localConfig,
        terminals: nextTerminals,
    };

    await db.save('config', nextConfig);
    window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfig }));

    return true;
};

const getSyncApiBase = () => {
    const env = (import.meta as any).env || {};
    const explicitBase = normalizeOptional(normalizeCloudUrl(
        String(env.VITE_SYNC_API_URL
            || env.VITE_ERP_SYNC_API_URL
            || localStorage.getItem(SYNC_API_URL_STORAGE_KEY)
            || DEFAULT_ERP_SYNC_API_URL
            || '')
    ));

    if (!explicitBase) return '';

    const trimmed = explicitBase.replace(/\/$/, '');
    return trimmed.endsWith('/api/sync') ? trimmed : `${trimmed}/api/sync`;
};

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
    const deviceLocalIps = deviceInfo && Array.isArray(deviceInfo.localIps) ? deviceInfo.localIps : [];
    const localIps = Array.from(
        new Set(
            [
                normalizeOptional(deviceInfo?.localIp || null),
                ...(deviceLocalIps.map((value) => normalizeOptional(value || null))),
            ].filter(Boolean)
        )
    );

    return {
        appVersion: normalizeOptional(deviceInfo?.versionName || null) || null,
        appVersionCode: Number.isFinite(Number(deviceInfo?.versionCode))
            ? Number(deviceInfo?.versionCode)
            : null,
        ipAddress: localIps[0] || null,
    };
};

const readJson = async <T>(response: Response): Promise<T> => {
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : 'ERP sync lifecycle request failed';
        throw new Error(message);
    }

    return payload as T;
};

const persistBinding = (terminal: SyncTerminalRecord | null | undefined, identity?: TenantIdentity | null) => {
    if (!terminal?.id) return;

    const currentIdentity = identity || getStoredTenantIdentity();
    const tenantId = normalizeOptional(currentIdentity.tenantId || terminal.tenant_id || null);

    if (tenantId) {
        localStorage.setItem(SYNC_BINDING_TENANT_KEY, tenantId);
    }

    localStorage.setItem(SYNC_BINDING_TERMINAL_KEY, terminal.id);

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
};

const clearBindingIfTenantChanged = (identity: TenantIdentity) => {
    const currentTenantId = normalizeOptional(identity.tenantId || null);
    const boundTenantId = normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY));

    if (currentTenantId && boundTenantId && currentTenantId !== boundTenantId) {
        clearStoredErpSyncBinding();
    }
};

const postJson = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const baseUrl = getSyncApiBase();
    if (!baseUrl) {
        throw new Error('ERP sync lifecycle URL is not configured');
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
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

    const response = await fetch(`${baseUrl}${path}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    return readJson<T>(response);
};

const normalizeRequiredEntities = (requiredEntities?: string[] | null): Set<string> => {
    const normalized = uniqueStrings(requiredEntities).map((entityType) => entityType.toUpperCase());
    return new Set(normalized.length > 0 ? normalized : DEFAULT_BOOTSTRAP_ENTITY_TYPES);
};

const shouldIncludeEntity = (requiredEntities: Set<string>, entityType: string) => requiredEntities.has(entityType);

const buildDocumentTypes = (seriesList: DocumentSeries[]) => {
    const seen = new Set<string>();

    return seriesList
        .map((series) => normalizeEntityCode(series.documentType || null).toUpperCase())
        .filter(Boolean)
        .filter((documentType) => {
            if (seen.has(documentType)) return false;
            seen.add(documentType);
            return true;
        })
        .map((documentType) => ({
            code: documentType,
            document_type: documentType,
            name: documentType,
        }));
};

const buildBootstrapMasters = async (requiredEntities?: string[] | null) => {
    const normalizedEntities = normalizeRequiredEntities(requiredEntities);

    const [
        config,
        warehouses,
        customers,
        suppliers,
        products,
        internalSequences,
        fiscalRanges,
        paymentMethodsCollection,
    ] = await Promise.all([
        db.get('config') as Promise<unknown>,
        db.get('warehouses') as Promise<Warehouse[]>,
        db.get('customers') as Promise<Customer[]>,
        db.get('suppliers') as Promise<Supplier[]>,
        db.get('products') as Promise<Product[]>,
        db.get('internalSequences') as Promise<DocumentSeries[]>,
        db.get('fiscalRanges') as Promise<FiscalRangeDGII[]>,
        db.get('paymentMethods') as Promise<PaymentMethodDefinition[]>,
    ]);

    const safeConfig = asObject<BusinessConfig>(config);
    const safeCurrencies = Array.isArray(safeConfig?.currencies) ? safeConfig.currencies : [];
    const safeTaxes = Array.isArray(safeConfig?.taxes) ? safeConfig.taxes : [];
    const safeTerminals = Array.isArray(safeConfig?.terminals) ? safeConfig.terminals : [];
    const safeSequences = asArray<DocumentSeries>(internalSequences);
    const safeFiscalRanges = asArray<FiscalRangeDGII>(fiscalRanges);
    const safeWarehouses = asArray<Warehouse>(warehouses);
    const safeCustomers = asArray<Customer>(customers);
    const safeSuppliers = asArray<Supplier>(suppliers);
    const safeProducts = asArray<Product>(products);
    const safeConfigPaymentMethods = asArray<PaymentMethodDefinition>(safeConfig.paymentMethods);
    const safePaymentMethods = safeConfigPaymentMethods.length > 0
        ? safeConfigPaymentMethods
        : asArray<PaymentMethodDefinition>(paymentMethodsCollection);

    return {
        warehouses: shouldIncludeEntity(normalizedEntities, 'WAREHOUSE')
            ? safeWarehouses.map((warehouse) => ({
                id: warehouse.id,
                code: normalizeEntityCode(warehouse.code || warehouse.id),
                warehouse_code: normalizeEntityCode(warehouse.code || warehouse.id),
                name: warehouse.name,
                type: warehouse.type,
                address: warehouse.address || '',
                allow_pos_sale: Boolean(warehouse.allowPosSale),
                allow_negative_stock: Boolean(warehouse.allowNegativeStock),
                is_main_branch: Boolean(warehouse.isMain),
                source_store_id: normalizeEntityCode(warehouse.storeId || null) || null,
            }))
            : [],
        currencies: shouldIncludeEntity(normalizedEntities, 'CURRENCY')
            ? safeCurrencies.map((currency) => ({
                code: normalizeEntityCode(currency.code),
                currency_code: normalizeEntityCode(currency.code),
                name: currency.name,
                symbol: currency.symbol,
                rate: Number(currency.rate || 0),
                buy_rate: Number(currency.buyRate || currency.rate || 0),
                sell_rate: Number(currency.sellRate || currency.rate || 0),
                is_enabled: Boolean(currency.isEnabled),
                is_base: Boolean(currency.isBase),
            }))
            : [],
        taxes: shouldIncludeEntity(normalizedEntities, 'TAX')
            ? safeTaxes.map((tax) => ({
                code: normalizeEntityCode(tax.id),
                tax_code: normalizeEntityCode(tax.id),
                name: tax.name,
                rate: Number(tax.rate || 0),
                type: tax.type,
            }))
            : [],
        document_types: shouldIncludeEntity(normalizedEntities, 'DOCUMENT_TYPE')
            ? buildDocumentTypes(safeSequences)
            : [],
        document_series: shouldIncludeEntity(normalizedEntities, 'DOCUMENT_SERIES')
            ? safeSequences.map((series) => ({
                code: normalizeEntityCode(series.id),
                series_code: normalizeEntityCode(series.id),
                name: series.name,
                description: series.description || '',
                prefix: normalizeEntityCode(series.prefix),
                document_type: normalizeEntityCode(series.documentType || null).toUpperCase(),
                next_number: Number(series.nextNumber || 1),
                padding: Number(series.padding || 0),
                business_unit: normalizeEntityCode(series.businessUnit || null) || null,
            }))
            : [],
        fiscal_ranges: shouldIncludeEntity(normalizedEntities, 'FISCAL_RANGE')
            ? safeFiscalRanges.map((range) => ({
                code: normalizeEntityCode(range.id || `${range.type}-${range.prefix}`),
                fiscal_range_code: normalizeEntityCode(range.id || `${range.type}-${range.prefix}`),
                ncf_type: normalizeEntityCode(range.type),
                prefix: normalizeEntityCode(range.prefix),
                start_number: Number(range.startNumber || 0),
                end_number: Number(range.endNumber || 0),
                current_global: Number(range.currentGlobal || 0),
                expiry_date: range.expiryDate || null,
                is_active: Boolean(range.isActive),
            }))
            : [],
        customers: shouldIncludeEntity(normalizedEntities, 'CUSTOMER')
            ? safeCustomers.map((customer) => ({
                code: normalizeEntityCode(customer.id),
                customer_code: normalizeEntityCode(customer.id),
                name: customer.name,
                tax_id: normalizeEntityCode(customer.taxId || null) || null,
                email: normalizeEntityCode(customer.email || null) || null,
                phone: normalizeEntityCode(customer.phone || null) || null,
                address: normalizeEntityCode(customer.address || null) || null,
                credit_limit: Number(customer.creditLimit || 0),
                credit_days: Number(customer.creditDays || 0),
                default_ncf_type: normalizeEntityCode(customer.defaultNcfType || null) || null,
                is_tax_exempt: Boolean(customer.isTaxExempt),
            }))
            : [],
        suppliers: shouldIncludeEntity(normalizedEntities, 'SUPPLIER')
            ? safeSuppliers.map((supplier) => ({
                code: normalizeEntityCode(supplier.id),
                supplier_code: normalizeEntityCode(supplier.id),
                name: supplier.name,
                tax_id: normalizeEntityCode(supplier.taxId || null) || null,
                email: normalizeEntityCode(supplier.email || null) || null,
                phone: normalizeEntityCode(supplier.phone || null) || null,
                contact_person: normalizeEntityCode(supplier.contactPerson || null) || null,
                payment_method: normalizeEntityCode(supplier.paymentMethod || null) || null,
                payment_term_days: Number(supplier.paymentTermDays || 0),
                credit_limit: Number(supplier.creditLimit || 0),
                lead_time_days: Number(supplier.leadTimeDays || 0),
                is_active: supplier.isActive !== false,
            }))
            : [],
        items: shouldIncludeEntity(normalizedEntities, 'ITEM')
            ? safeProducts.map((product) => ({
                code: normalizeEntityCode(product.id),
                item_code: normalizeEntityCode(product.id),
                sku: normalizeEntityCode(product.id),
                barcode: normalizeEntityCode(product.barcode || null) || null,
                name: product.name,
                description: normalizeEntityCode(product.description || null) || null,
                category: normalizeEntityCode(product.category || null) || null,
                type: normalizeEntityCode(product.type || null) || 'PRODUCT',
                price: Number(product.price || 0),
                cost: Number(product.cost || 0),
                tax_ids: asArray<string>(product.appliedTaxIds),
                warehouse_ids: asArray<string>(product.activeInWarehouses),
                variants: asArray<Product['variants'][number]>(product.variants).map((variant) => ({
                    sku: normalizeEntityCode(variant.sku),
                    barcode: asArray<string>(variant.barcode),
                    attribute_values: asObject<Record<string, string>>(variant.attributeValues),
                    price: Number(variant.price || 0),
                })),
                is_inventoriable: product.isInventoriable !== false,
            }))
            : [],
        payment_methods: shouldIncludeEntity(normalizedEntities, 'PAYMENT_METHOD')
            ? safePaymentMethods.map((method) => ({
                code: normalizeEntityCode(method.id),
                payment_code: normalizeEntityCode(method.id),
                name: method.name,
                type: normalizeEntityCode(method.type),
                is_enabled: Boolean(method.isEnabled),
                integration: normalizeEntityCode(method.integration),
                opens_drawer: Boolean(method.opensDrawer),
                requires_signature: Boolean(method.requiresSignature),
            }))
            : [],
        _metadata: {
            company_info: safeConfig.companyInfo || null,
            terminal_count: safeTerminals.length,
            tax_rate: Number((safeConfig as any).taxRate || 0),
        },
    };
};

const postBootstrapSnapshotToErp = async ({
    deviceId,
    terminalId,
    requiredEntities,
    payload,
}: {
    deviceId: string;
    terminalId: string;
    requiredEntities?: string[] | null;
    payload?: BootstrapEventPayload | null;
}): Promise<SyncBootstrapSnapshotResponse | null> => {
    if (!isConfigured()) return null;

    const identity = getStoredTenantIdentity();
    const binding = getStoredErpSyncBinding();
    const runtimeTelemetry = await resolveRuntimeTelemetry();
    const masters = await buildBootstrapMasters(requiredEntities);
    const metadata = asObject<BootstrapEventPayload>(payload);

    const resolvedTenantId = normalizeEntityCode(metadata.tenant_id || identity.tenantId || binding.tenantId || null);
    if (!resolvedTenantId) {
        throw new Error('No existe tenant_id para enviar snapshot de bootstrap.');
    }

    return postJson<SyncBootstrapSnapshotResponse>('/bootstrap/snapshot', {
        tenant_id: resolvedTenantId,
        company_id: normalizeEntityCode(metadata.company_id || binding.companyId || null) || null,
        store_id: normalizeEntityCode(metadata.store_id || binding.storeId || null) || null,
        terminal_id: normalizeEntityCode(metadata.terminal_id || binding.terminalId || null) || terminalId,
        device_id: normalizeEntityCode(metadata.device_id || deviceId || null) || null,
        source_system: 'POS',
        bootstrap_mode: normalizeEntityCode(metadata.bootstrap_mode || null) || 'POS_FIRST',
        masters: Object.fromEntries(
            Object.entries(masters).filter(([key]) => !key.startsWith('_'))
        ),
        metadata: {
            requested_entities: uniqueStrings(requiredEntities),
            company_info: (masters as any)._metadata?.company_info || null,
            terminal_context: {
                local_terminal_id: terminalId,
                bound_terminal_id: binding.terminalId,
                bound_company_id: binding.companyId,
                bound_store_id: binding.storeId,
            },
            runtime: {
                app_version: runtimeTelemetry.appVersion,
                app_version_code: runtimeTelemetry.appVersionCode,
                ip_address: runtimeTelemetry.ipAddress,
            },
        },
    });
};

const pullErpOutbox = async (bindingTerminalId: string | null, deviceId: string): Promise<SyncOutboxPullResponse | null> => {
    if (!isConfigured()) return null;

    if (!bindingTerminalId && !deviceId) return null;

    return getJson<SyncOutboxPullResponse>('/outbox/pull', {
        terminal_id: bindingTerminalId || undefined,
        device_id: bindingTerminalId ? undefined : deviceId,
        limit: 20,
    });
};

const ackErpOutboxEvent = async (
    outboxId: string,
    status: 'APPLIED' | 'FAILED',
    errorDetail?: string
): Promise<SyncOutboxAckResponse | null> => {
    if (!outboxId) return null;

    return postJson<SyncOutboxAckResponse>('/outbox/ack', {
        outbox_id: outboxId,
        status,
        error_detail: errorDetail || null,
    });
};

export const clearStoredErpSyncBinding = () => {
    localStorage.removeItem(SYNC_BINDING_TENANT_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_KEY);
    localStorage.removeItem(SYNC_BINDING_COMPANY_KEY);
    localStorage.removeItem(SYNC_BINDING_STORE_KEY);
    localStorage.removeItem(SYNC_BINDING_LAST_SEEN_KEY);
    localStorage.removeItem(SYNC_BINDING_STATUS_KEY);
};

export const getStoredErpSyncBinding = () => ({
    tenantId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY)) || null,
    terminalId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TERMINAL_KEY)) || null,
    companyId: normalizeOptional(localStorage.getItem(SYNC_BINDING_COMPANY_KEY)) || null,
    storeId: normalizeOptional(localStorage.getItem(SYNC_BINDING_STORE_KEY)) || null,
    lastSeen: normalizeOptional(localStorage.getItem(SYNC_BINDING_LAST_SEEN_KEY)) || null,
    status: normalizeOptional(localStorage.getItem(SYNC_BINDING_STATUS_KEY)) || null,
});

export const bootstrapErpSyncLifecycle = async (deviceId: string): Promise<SyncBootstrapResponse | null> => {
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

    const payload = await postJson<SyncRegisterResponse>('/terminals/register', {
        device_id: params.deviceId,
        tenant_id: identity.tenantId || null,
        company_ref: identity.tenantSlug || null,
        company_id: params.companyId || storedBinding.companyId || null,
        store_id: params.storeId || storedBinding.storeId || null,
        name: params.terminalName || params.terminalId,
        app_version: runtimeTelemetry.appVersion || null,
        app_version_code: runtimeTelemetry.appVersionCode,
        ip_address: runtimeTelemetry.ipAddress || null,
        metadata: {
            source: 'CLIC_POS_APK',
            terminal_id: params.terminalId,
            is_primary: params.isPrimary ?? true,
        },
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal, identity);
    }

    return payload;
};

export const heartbeatErpSyncTerminal = async (
    params: EnsureLifecycleParams,
    fallbackDeviceId?: string
): Promise<SyncHeartbeatResponse | null> => {
    if (!isConfigured()) return null;

    const runtimeTelemetry = await resolveRuntimeTelemetry();
    const storedBinding = getStoredErpSyncBinding();
    const resolvedDeviceId = params.deviceId || fallbackDeviceId || '';
    const terminalRef = storedBinding.terminalId || null;

    if (!terminalRef && !resolvedDeviceId) {
        return null;
    }

    const payload = await postJson<SyncHeartbeatResponse>('/terminals/heartbeat', {
        terminal_id: terminalRef || undefined,
        device_id: terminalRef ? undefined : resolvedDeviceId,
        app_version: runtimeTelemetry.appVersion || null,
        app_version_code: runtimeTelemetry.appVersionCode,
        ip_address: runtimeTelemetry.ipAddress || null,
        pending_events: params.pendingEvents || 0,
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal);
    }

    return payload;
};

export const ensureErpSyncLifecycle = async (params: EnsureLifecycleParams): Promise<{
    bootstrap?: SyncBootstrapResponse | null;
    registered?: SyncRegisterResponse | null;
    heartbeat?: SyncHeartbeatResponse | null;
} | null> => {
    if (!isConfigured()) return null;

    const bootstrap = await bootstrapErpSyncLifecycle(params.deviceId);
    const activation = bootstrap?.activation;

    if (activation && activation.erp_enabled === false) {
        return { bootstrap, registered: null, heartbeat: null };
    }

    const storedBinding = getStoredErpSyncBinding();
    let registered: SyncRegisterResponse | null = null;

    if (!storedBinding.terminalId) {
        registered = await registerErpSyncTerminal({
            ...params,
            companyId: params.companyId || storedBinding.companyId,
            storeId: params.storeId || storedBinding.storeId,
        });
    }

    const heartbeat = await heartbeatErpSyncTerminal(params, params.deviceId);

    return { bootstrap, registered, heartbeat };
};

export const processErpSyncOutbox = async (
    params: ProcessErpOutboxParams
): Promise<{ processed: number; applied: number; failed: number } | null> => {
    if (!isConfigured() || !params.deviceId) return null;

    if (outboxProcessingPromise) {
        return outboxProcessingPromise;
    }

    outboxProcessingPromise = (async () => {
        const binding = getStoredErpSyncBinding();
        const outbox = await pullErpOutbox(binding.terminalId, params.deviceId);
        const events = Array.isArray(outbox?.events) ? outbox.events : [];

        if (events.length === 0) {
            return { processed: 0, applied: 0, failed: 0 };
        }

        let applied = 0;
        let failed = 0;

        for (const event of events) {
            const eventType = normalizeEntityCode(event.event_type || null).toUpperCase();
            const payload = asObject<Record<string, unknown>>(event.payload);

            try {
                if (eventType === 'BOOTSTRAP_REQUESTED') {
                    const snapshotResponse = await postBootstrapSnapshotToErp({
                        deviceId: params.deviceId,
                        terminalId: params.terminalId,
                        requiredEntities: asArray<string>(payload.required_entities),
                        payload: payload as BootstrapEventPayload,
                    });

                    const tenantId = normalizeEntityCode(
                        String(payload.tenant_id || getStoredTenantIdentity().tenantId || binding.tenantId || '')
                    );
                    let readyForDocuments = Boolean(snapshotResponse?.validation?.ready_for_documents);

                    if (tenantId) {
                        const validateResponse = await postJson<SyncBootstrapValidateResponse>('/bootstrap/validate', {
                            tenant_id: tenantId,
                        });
                        readyForDocuments = Boolean(validateResponse?.validation?.ready_for_documents);

                        if (readyForDocuments) {
                            await postJson<SyncBootstrapCompleteResponse>('/bootstrap/complete', {
                                tenant_id: tenantId,
                            });
                        }
                    }

                    await ackErpOutboxEvent(event.id, 'APPLIED');
                    applied += 1;
                    continue;
                }

                if (eventType === 'CONFIG_PUSH') {
                    const appliedLocally = await applyErpConfigPushToLocalTerminal({
                        deviceId: params.deviceId,
                        fallbackTerminalId: binding.terminalId || params.terminalId,
                        payload,
                    });

                    console.info(
                        appliedLocally
                            ? '[ERP SYNC] CONFIG_PUSH aplicado sobre la configuracion local de la terminal.'
                            : '[ERP SYNC] CONFIG_PUSH recibido sin cambios aplicables en la configuracion local.'
                    );
                    await ackErpOutboxEvent(event.id, 'APPLIED');
                    applied += 1;
                    continue;
                }

                await ackErpOutboxEvent(event.id, 'FAILED', `Evento no soportado por el POS: ${eventType || 'UNKNOWN'}`);
                failed += 1;
            } catch (error: any) {
                console.warn(`[ERP SYNC] Error procesando ${eventType || 'UNKNOWN'}:`, error);
                await ackErpOutboxEvent(event.id, 'FAILED', error?.message || 'Error procesando evento ERP outbox');
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

export const postSalePostedToErp = async (transaction: SalePostedInput): Promise<SyncInboxResponse | null> => {
    if (!isConfigured() || !transaction?.id) return null;

    const identity = getStoredTenantIdentity();
    const binding = getStoredErpSyncBinding();

    if (!binding.terminalId || (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail)) {
        return null;
    }

    const runtimeTelemetry = await resolveRuntimeTelemetry();
    const deviceId = normalizeOptional(localStorage.getItem('CLIC_POS_DEVICE_TOKEN')) || null;
    const items = Array.isArray(transaction.items) ? transaction.items : [];
    const payments = Array.isArray(transaction.payments) ? transaction.payments : [];
    const total = Number(transaction.total);
    const taxAmount = Number(transaction.taxAmount);
    const netAmount = Number(transaction.netAmount);
    const discountAmount = Number(transaction.discountAmount);

    return postJson<SyncInboxResponse>('/inbox', {
        event_id: uuidv5(`sale:${transaction.id}`, ERP_SALE_EVENT_NAMESPACE),
        terminal_id: binding.terminalId,
        event_type: 'SALE_POSTED',
        payload: {
            source: 'CLIC_POS_APK',
            schema_version: 1,
            tenant_id: identity.tenantId || binding.tenantId || null,
            company_ref: identity.tenantSlug || null,
            tenant_email: identity.tenantEmail || null,
            company_id: binding.companyId || null,
            store_id: binding.storeId || null,
            terminal_binding_id: binding.terminalId,
            source_terminal_id: normalizeOptional(transaction.terminalId || null) || null,
            device_id: deviceId,
            occurred_at: normalizeOptional(transaction.date || null) || new Date().toISOString(),
            summary: {
                transaction_id: transaction.id,
                display_id: normalizeOptional(transaction.displayId || null) || null,
                document_type: normalizeOptional(transaction.documentType || null) || null,
                status: normalizeOptional(transaction.status || null) || 'COMPLETED',
                total: Number.isFinite(total) ? total : 0,
                tax_amount: Number.isFinite(taxAmount) ? taxAmount : 0,
                net_amount: Number.isFinite(netAmount) ? netAmount : 0,
                discount_amount: Number.isFinite(discountAmount) ? discountAmount : 0,
                item_count: items.length,
                payment_count: payments.length,
                customer_id: normalizeOptional(transaction.customerId || null) || null,
                customer_name: normalizeOptional(transaction.customerName || null) || null,
                user_id: normalizeOptional(transaction.userId || null) || null,
                user_name: normalizeOptional(transaction.userName || null) || null,
            },
            runtime: {
                app_version: runtimeTelemetry.appVersion,
                app_version_code: runtimeTelemetry.appVersionCode,
                ip_address: runtimeTelemetry.ipAddress,
            },
            transaction,
        },
    });
};
