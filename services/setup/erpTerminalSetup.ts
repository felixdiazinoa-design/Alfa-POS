import { BusinessConfig, DeviceProfile, Product, TerminalConfig } from '../../types';
import { getDefaultRoleConfig, resolveDeviceRoleValue } from '../../utils/deviceRoleHelpers';
import {
  extractErpRegisterAuth,
  resolveIncomingSyncProfileFromRegister,
  resolveRegisterErpTerminalId,
} from '../sync/erpRegisterResponse';
import { CanonicalErpTerminalIdError } from '../sync/terminalIdentity';
import type { SyncProfile } from '../sync/SyncProfile';
import { supabase } from '../../utils/supabase';
import { getNetworkEngine, requestJson } from '../network/httpClient';
import { resolveOrderTakerContract } from '../../utils/orderTakerPolicy';
import { resolveDeviceProfile, resolveTerminalDeviceProfile, toDeviceProfileContract } from '../../utils/deviceProfile';
import { db } from '../../utils/db';
import { terminalConfigRequestCoordinator } from '../sync/TerminalConfigRequestCoordinator';
import { persistSyncDeviceToken } from '../sync/deviceToken';
import { saveTerminalCredentialsSync } from '../sync/TerminalCredentialStore';
import { isArchivedTerminalBindingRecord } from '../../utils/terminalBindingHierarchy';
import {
  POS_SYNC_CAPABILITY_VERSIONS,
  VARIANT_PROMOTIONS_CAPABILITY,
} from '../../utils/syncCapabilities';
import { isDeviceExplicitlyAuthorizedByBootstrap } from '../../utils/terminalAuthorizationGuard';

export interface RuntimeTerminalCard {
  id: string;
  erpTerminalId: string;
  tenantId?: string;
  companyId?: string;
  companyName: string;
  storeId?: string;
  storeName: string;
  name: string;
  terminalCode?: string;
  bindingStatus?: string;
  location: string;
  occupied: boolean;
  canReauthorize: boolean;
  currentDeviceId?: string;
  config: TerminalConfig;
  terminalType?: string;
  terminal_type?: string;
  masterTerminalId?: string;
  master_terminal_id?: string;
  capabilities?: string[];
  restrictions?: string[];
  deviceProfile?: DeviceProfile;
  device_profile?: Record<string, unknown>;
}

export interface RuntimeTerminalListResponse {
  tenant_id: string;
  tenant_name?: string | null;
  erp_base_url?: string | null;
  terminals: RuntimeTerminalCard[];
}

export interface RuntimeBindTerminalResponse {
  success: boolean;
  tenant_id: string;
  terminal_id: string;
  erp_terminal_id: string;
  terminal_code?: string | null;
  terminal_name?: string | null;
  company_id?: string | null;
  store_id?: string | null;
  transferred?: boolean;
  previous_device_id?: string | null;
  recovery_state?: RuntimeTerminalRecoveryState | null;
  config: BusinessConfig;
  deviceToken?: string;
  device_token?: string;
  terminalToken?: string;
  terminal_token?: string;
  activationToken?: string;
  activation_token?: string;
  syncToken?: string;
  sync_token?: string;
  syncAuthToken?: string;
  sync_auth_token?: string;
  tokenExpiresAt?: string;
  token_expires_at?: string;
  syncProfile?: Partial<SyncProfile>;
  sync_profile?: Partial<SyncProfile>;
  incomingProfile?: Partial<SyncProfile>;
  incoming_profile?: Partial<SyncProfile>;
  profile?: Partial<SyncProfile>;
}

export interface RuntimeTerminalRecoveryState {
  terminal_id?: string | null;
  last_ncf?: string | null;
  last_display_id?: string | null;
  last_global_sequence?: number | null;
  last_transaction_date?: string | null;
}

export interface RuntimeInitialConfigResponse {
  success: boolean;
  tenant_id?: string;
  terminal_id?: string;
  erp_terminal_id?: string;
  config?: BusinessConfig;
  terminal_config?: Record<string, any>;
  snapshot_meta?: Record<string, any>;
  items?: Product[];
  rooms?: any[];
  tables?: any[];
  deviceToken?: string;
  device_token?: string;
  terminalToken?: string;
  terminal_token?: string;
  activationToken?: string;
  activation_token?: string;
  syncToken?: string;
  sync_token?: string;
  syncAuthToken?: string;
  sync_auth_token?: string;
  tokenExpiresAt?: string;
  token_expires_at?: string;
  config_version?: string | null;
  etag?: string | null;
  unchanged?: boolean;
}

type BindingMode = 'MASTER' | 'SLAVE';

type ErpIdentity = {
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantEmail?: string | null;
  deviceId?: string | null;
  erpBaseUrl: string;
};

class TerminalOccupiedError extends Error {
  currentDeviceId?: string;

  constructor(message: string, currentDeviceId?: string) {
    super(message);
    this.name = 'TerminalOccupiedError';
    this.currentDeviceId = currentDeviceId;
  }
}

const DEVICE_AUTHORIZATION_CODES = new Set([
  'DEVICE_NOT_AUTHORIZED',
  'TAKEOVER_REQUIRED',
  'DEVICE_SUPERSEDED',
]);

export class SetupDeviceAuthorizationError extends Error {
  code: string;
  httpStatus?: number;
  payload?: Record<string, any>;
  currentDeviceId?: string;
  terminalId?: string;
  terminalName?: string;

  constructor(
    code: string,
    message: string,
    options: {
      httpStatus?: number;
      payload?: Record<string, any>;
      currentDeviceId?: string;
      terminalId?: string;
      terminalName?: string;
    } = {}
  ) {
    super(message);
    this.name = 'SetupDeviceAuthorizationError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.payload = options.payload;
    this.currentDeviceId = options.currentDeviceId;
    this.terminalId = options.terminalId;
    this.terminalName = options.terminalName;
  }
}

export class SetupErpRequestError extends Error {
  code: string;
  httpStatus: number;
  payload?: Record<string, any>;

  constructor(code: string, message: string, options: { httpStatus: number; payload?: Record<string, any> }) {
    super(`${code}: ${message}`);
    this.name = 'SetupErpRequestError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.payload = options.payload;
  }
}

export const checkTerminalAuthorizationFromErp = async (input: {
  erpBaseUrl: string;
  tenantId?: string | null;
  erpTerminalId: string;
  posDeviceId: string;
}) => {
  const payload = asObject(await fetchErpJson(input.erpBaseUrl, '/api/sync/bootstrap/check', {
    method: 'POST',
    headers: buildDeviceHeaders(input.posDeviceId),
    body: {
      tenant_id: input.tenantId || null,
      terminal_id: input.erpTerminalId,
      erp_terminal_id: input.erpTerminalId,
      device_id: input.posDeviceId,
    },
  }));

  return {
    authorized: isDeviceExplicitlyAuthorizedByBootstrap(payload, input.posDeviceId),
    payload,
  };
};

const REQUEST_TIMEOUT_MS = 12000;

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const resolveBackendCode = (...sources: unknown[]): string => {
  for (const source of sources) {
    const record = asObject(source);
    const code = asString(record.code || record.errorCode || record.error_code || record.statusCode || record.status_code).toUpperCase();
    if (code) return code;
    const nestedCode = asString(asObject(record.error).code || asObject(record.detail).code).toUpperCase();
    if (nestedCode) return nestedCode;
  }
  return '';
};

const pickAuthString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = asString(value).replace(/[\r\n\t]/g, '').trim();
    if (!normalized) continue;
    if (['undefined', 'null', 'nan', '[object object]'].includes(normalized.toLowerCase())) continue;
    return normalized;
  }
  return undefined;
};

const extractRuntimeAuthPayload = (...sources: unknown[]) => {
  const records = sources
    .map(asObject)
    .filter((record) => Object.keys(record).length > 0)
    .flatMap((record) => [
      record,
      asObject(record.auth),
      asObject(record.syncAuth),
      asObject(record.terminal_config),
      asObject(asObject(record.terminal_config).auth),
      asObject(asObject(record.terminal_config).metadata),
      asObject(asObject(asObject(record.terminal_config).metadata).syncAuth),
      asObject(record.terminal),
      asObject(asObject(record.terminal).auth),
      asObject(asObject(record.terminal).config),
      asObject(asObject(asObject(record.terminal).config).auth),
      asObject(record.config),
      asObject(asObject(record.config).auth),
      asObject(record.security),
      asObject(record.metadata),
      asObject(asObject(record.metadata).syncAuth),
      asObject(record.runtime),
      asObject(record.session),
    ])
    .filter((record) => Object.keys(record).length > 0);
  const deviceToken = pickAuthString(...records.flatMap((record) => [
    record.deviceToken,
    record.device_token,
    record.terminalToken,
    record.terminal_token,
    record.activationToken,
    record.activation_token,
    asObject(record.auth).deviceToken,
    asObject(record.auth).device_token,
    asObject(record.auth).terminalToken,
    asObject(record.auth).terminal_token,
    asObject(record.auth).activationToken,
    asObject(record.auth).activation_token,
    asObject(record.syncAuth).deviceToken,
    asObject(record.syncAuth).device_token,
    asObject(record.security).deviceToken,
    asObject(record.security).device_token,
    asObject(record.metadata).deviceToken,
    asObject(record.metadata).device_token,
  ]));
  const terminalToken = pickAuthString(...records.flatMap((record) => [
    record.terminalToken,
    record.terminal_token,
    asObject(record.auth).terminalToken,
    asObject(record.auth).terminal_token,
    asObject(record.syncAuth).terminalToken,
    asObject(record.syncAuth).terminal_token,
    asObject(record.security).terminalToken,
    asObject(record.security).terminal_token,
  ]));
  const activationToken = pickAuthString(...records.flatMap((record) => [
    record.activationToken,
    record.activation_token,
    asObject(record.auth).activationToken,
    asObject(record.auth).activation_token,
    asObject(record.syncAuth).activationToken,
    asObject(record.syncAuth).activation_token,
    asObject(record.security).activationToken,
    asObject(record.security).activation_token,
  ]));
  const syncToken = pickAuthString(...records.flatMap((record) => [
    record.syncToken,
    record.sync_token,
    record.syncAuthToken,
    record.sync_auth_token,
    asObject(record.auth).syncToken,
    asObject(record.auth).sync_token,
    asObject(record.auth).syncAuthToken,
    asObject(record.auth).sync_auth_token,
    asObject(record.syncAuth).syncToken,
    asObject(record.syncAuth).sync_token,
    asObject(record.syncAuth).syncAuthToken,
    asObject(record.syncAuth).sync_auth_token,
    asObject(record.security).syncToken,
    asObject(record.security).sync_token,
    asObject(record.runtime).syncAuthToken,
    asObject(record.runtime).sync_auth_token,
  ]));
  const tokenExpiresAt = pickAuthString(...records.flatMap((record) => [
    record.tokenExpiresAt,
    record.token_expires_at,
    record.expiresAt,
    record.expires_at,
    asObject(record.security).tokenExpiresAt,
    asObject(record.security).token_expires_at,
  ]));

  return { deviceToken, terminalToken, activationToken, syncToken, tokenExpiresAt };
};

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const buildDeviceHeaders = (deviceId?: string | null): Record<string, string> => {
  const resolvedDeviceId = asString(deviceId);
  return resolvedDeviceId
    ? {
      'X-Device-Id': resolvedDeviceId,
      'X-POS-Device-Id': resolvedDeviceId,
    }
    : {};
};

const fetchErpJson = async (
  baseUrl: string,
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: Record<string, any>;
    headers?: Record<string, string>;
    preserveBackendError?: boolean;
  }
) => {
  const requestUrl = `${stripTrailingSlashes(baseUrl)}${path}`;
  let response: Awaited<ReturnType<typeof requestJson>>;

  try {
    response = await requestJson({
      url: requestUrl,
      method: options?.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers || {}),
      },
      body: options?.body || undefined,
      timeoutMs: REQUEST_TIMEOUT_MS,
      diagnosticContext: {
        scope: 'ERP_TERMINAL_SETUP',
        path,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`ERP ${requestUrl}: request failed (${reason})`);
  }

  const payload = response.data ?? (() => {
    try {
      return response.text ? JSON.parse(response.text) : null;
    } catch {
      return response.text;
    }
  })();

  if (!response.ok) {
    const backendCode = resolveBackendCode(payload);
    const message =
      asString(asObject(payload).message) ||
      asString(asObject(payload).error) ||
      `${response.status}`.trim();
    if (DEVICE_AUTHORIZATION_CODES.has(backendCode)) {
      throw new SetupDeviceAuthorizationError(
        backendCode,
        `${backendCode}: ${message}`,
        {
          httpStatus: response.status,
          payload: asObject(payload),
          currentDeviceId:
            asString(asObject(payload).authorized_device_id)
            || asString(asObject(payload).authorizedDeviceId)
            || asString(asObject(payload).current_device_id)
            || asString(asObject(payload).currentDeviceId)
            || asString(asObject(payload).bound_device_id)
            || undefined,
          terminalId:
            asString(asObject(payload).terminal_id)
            || asString(asObject(payload).erp_terminal_id)
            || undefined,
          terminalName: asString(asObject(payload).terminal_name) || undefined,
        }
      );
    }
    if (backendCode === 'SETUP_AUTH_REQUIRED') {
      console.error('[POS_ERP_PAIRING]', {
        endpoint: path,
        httpStatus: response.status,
        authResponseCode: backendCode,
        pairingStatus: 'CLIENT_IMPLEMENTATION_ERROR',
      });
      throw new SetupErpRequestError(
        backendCode,
        'La autorización debe completarse desde Cloud Admin. Este dispositivo no puede autorizarse por sí mismo.',
        { httpStatus: response.status, payload: asObject(payload) },
      );
    }
    if (options?.preserveBackendError) {
      throw new SetupErpRequestError(
        backendCode || `HTTP_${response.status}`,
        message,
        { httpStatus: response.status, payload: asObject(payload) },
      );
    }
    throw new Error(`ERP ${requestUrl}: ${message}`);
  }

  return payload;
};

const getSupabaseAuthHeaders = async (): Promise<Record<string, string>> => {
  const session = await supabase.auth.getSession().catch(() => null);
  const token = session?.data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const fetchTerminalRecoveryStateFromErp = async (input: {
  erpBaseUrl: string;
  erpTerminalId: string;
  posDeviceId: string;
}): Promise<RuntimeTerminalRecoveryState | null> => {
  const params = new URLSearchParams({
    terminal_id: input.erpTerminalId,
    device_id: input.posDeviceId,
  });
  const payload = await fetchErpJson(
    input.erpBaseUrl,
    `/api/sync/terminals/${encodeURIComponent(input.erpTerminalId)}/recovery-state?${params.toString()}`,
    {
      headers: {
        ...(await getSupabaseAuthHeaders()),
        ...buildDeviceHeaders(input.posDeviceId),
      },
    }
  );

  const source = asObject(payload?.recovery_state || payload?.state || payload);
  if (!Object.keys(source).length) return null;

  return {
    terminal_id: asString(source.terminal_id) || input.erpTerminalId,
    last_ncf: asString(source.last_ncf) || null,
    last_display_id: asString(source.last_display_id) || null,
    last_global_sequence: Number.isFinite(Number(source.last_global_sequence))
      ? Number(source.last_global_sequence)
      : null,
    last_transaction_date: asString(source.last_transaction_date) || null,
  };
};

const fetchErpTerminals = async (
  baseUrl: string,
  filters: {
    tenantId?: string | null;
    companyId?: string | null;
    storeId?: string | null;
  }
) => {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set('tenant_id', filters.tenantId);
  if (filters.companyId) params.set('company_id', filters.companyId);
  if (filters.storeId) params.set('store_id', filters.storeId);

  const payload = await fetchErpJson(
    baseUrl,
    `/api/sync/terminals${params.toString() ? `?${params.toString()}` : ''}`
  );

  return Array.isArray(payload?.terminals) ? payload.terminals : [];
};

const fetchErpTenants = async (baseUrl: string) => {
  const payload = await fetchErpJson(baseUrl, '/api/sync/tenants');
  return Array.isArray(payload?.tenants) ? payload.tenants : [];
};

const fetchTerminalProfile = async (baseUrl: string, tenantId: string, terminalId: string) => {
  return fetchErpJson(
    baseUrl,
    `/api/sync/bootstrap/terminal-profile?tenant_id=${encodeURIComponent(tenantId)}&terminal_id=${encodeURIComponent(terminalId)}`
  );
};

const fetchTerminalProfileSafe = async (baseUrl: string, tenantId: string, terminalId: string) => {
  try {
    return await fetchTerminalProfile(baseUrl, tenantId, terminalId);
  } catch (error) {
    console.warn(`⚠️ Terminal profile fallback for ${terminalId}:`, error);
    return { profile: {} };
  }
};

const bootstrapErpTenantOnce = async (identity: ErpIdentity) => {
  return fetchErpJson(identity.erpBaseUrl, '/api/sync/bootstrap/check', {
    method: 'POST',
    body: {
      tenant_id: identity.tenantId || null,
      company_ref: identity.tenantSlug || null,
      email: identity.tenantEmail || null,
      device_id: identity.deviceId || null,
    },
  });
};

const bootstrapErpTenant = async (identity: ErpIdentity) => {
  const attempts = [
    {
      tenantId: identity.tenantId || null,
      tenantSlug: identity.tenantSlug || null,
      tenantEmail: identity.tenantEmail || null,
      deviceId: identity.deviceId || null,
      erpBaseUrl: identity.erpBaseUrl,
    },
    {
      tenantId: null,
      tenantSlug: identity.tenantSlug || null,
      tenantEmail: identity.tenantEmail || null,
      deviceId: identity.deviceId || null,
      erpBaseUrl: identity.erpBaseUrl,
    },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    if (!attempt.tenantId && !attempt.tenantSlug && !attempt.tenantEmail && !attempt.deviceId) {
      continue;
    }

    try {
      return await bootstrapErpTenantOnce(attempt);
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('No se pudo resolver un tenant operativo del ERP.');
};

const normalizeTenantKey = (value: unknown): string => {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
};

const findMappedErpTenant = (
  tenants: any[],
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
  }
) => {
  const cloudTenantId = asString(identity.tenantId);
  const tenantSlug = normalizeTenantKey(identity.tenantSlug);

  return (
    tenants.find((tenant) => asString(asObject(tenant?.activation).cloud_admin_tenant_id) === cloudTenantId)
    || (tenantSlug
      ? tenants.find((tenant) => normalizeTenantKey(tenant?.company_ref) === tenantSlug)
        || tenants.find((tenant) => normalizeTenantKey(tenant?.name) === tenantSlug)
      : null)
    || null
  );
};

const resolveBootstrapContext = (
  bootstrap: any,
  fallbackTenantId?: string | null
) => {
  return {
    tenantId:
      asString(bootstrap?.tenant?.id)
      || asString(bootstrap?.activation?.tenant_id)
      || asString(fallbackTenantId)
      || null,
    tenantName: asString(bootstrap?.tenant?.name) || null,
    companyId: asString(bootstrap?.company?.id) || null,
    storeId: asString(bootstrap?.store?.id) || null,
  };
};

const resolveTenantDirectoryContext = async (
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    erpBaseUrl: string;
  }
) => {
  const tenants = await fetchErpTenants(identity.erpBaseUrl);
  const matchedTenant = findMappedErpTenant(tenants, identity);

  if (!matchedTenant) return null;

  return {
    tenantId: asString(matchedTenant?.id) || null,
    tenantName: asString(matchedTenant?.name) || null,
    companyId: asString(asObject(matchedTenant?.primary_company).id) || null,
    storeId: asString(asObject(matchedTenant?.primary_store).id) || null,
    source: 'ERP_TENANT_DIRECTORY',
  };
};

type ErpTerminalContextCandidate = {
  tenantId: string | null;
  tenantName: string | null;
  companyId: string | null;
  storeId: string | null;
  source: string;
};

export const prioritizeMappedErpTenantContext = (
  candidates: ErpTerminalContextCandidate[],
  mappedTenant: ErpTerminalContextCandidate | null
): ErpTerminalContextCandidate[] => {
  if (!mappedTenant?.tenantId) return candidates;
  if (candidates.some(candidate => candidate.tenantId === mappedTenant.tenantId)) return candidates;

  // Un tenant resuelto por el ID explícito de Cloud-Admin tiene prioridad sobre
  // un bootstrap heredado del device. Así un device usado anteriormente en otro
  // tenant no desvía la selección hacia la primera lista ERP no vacía.
  return [mappedTenant, ...candidates];
};

const resolveErpTerminalContext = async (identity: ErpIdentity) => {
  const candidates: ErpTerminalContextCandidate[] = [];
  let lastBootstrapError: Error | null = null;

  try {
    const bootstrap = await bootstrapErpTenant(identity);
    const candidate = resolveBootstrapContext(bootstrap, identity.tenantId);
    if (candidate.tenantId) {
      candidates.push({
        ...candidate,
        source: 'ERP_BOOTSTRAP',
      });
    }
  } catch (error: any) {
    lastBootstrapError = error instanceof Error ? error : new Error(String(error));
  }

  let mappedTenant: ErpTerminalContextCandidate | null = null;
  try {
    mappedTenant = await resolveTenantDirectoryContext(identity);
  } catch (error) {
    console.warn('⚠️ ERP tenant directory lookup failed:', error);
  }

  let fallbackContext: any = null;
  const orderedCandidates = prioritizeMappedErpTenantContext(candidates, mappedTenant);

  for (const candidate of orderedCandidates) {
    const terminals = await fetchErpTerminals(identity.erpBaseUrl, {
      tenantId: candidate.tenantId,
    });

    const contextWithTerminals = {
      ...candidate,
      terminals,
    };

    if (terminals.length > 0) {
      return contextWithTerminals;
    }

    fallbackContext = fallbackContext || contextWithTerminals;
  }

  if (fallbackContext) return fallbackContext;

  throw lastBootstrapError || new Error('No se pudo resolver un tenant operativo del ERP.');
};

const resolveOccupiedDeviceId = (terminal: any, terminalProfilePayload: any): string | undefined => {
  const profile = asObject(terminalProfilePayload?.profile);
  const metadata = asObject(profile.metadata);
  const terminalMetadata = asObject(terminal?.metadata);

  return (
    asString(metadata.bound_device_id) ||
    asString(metadata.currentDeviceId) ||
    asString(metadata.device_id) ||
    asString(metadata.terminal_device_id) ||
    asString(terminal?.device_id) ||
    asString(terminalMetadata.bound_device_id) ||
    undefined
  );
};

const resolveOperationalTerminalId = (terminal: any): string => {
  const config = asObject(terminal?.config);
  return (
    asString(terminal?.station_number) ||
    asString(terminal?.code) ||
    asString(terminal?.terminal_code) ||
    asString(terminal?.pos_code) ||
    asString(config.station_number) ||
    asString(terminal?.name) ||
    asString(terminal?.id)
  );
};

const resolveTerminalName = (terminal: any, fallbackId: string): string => {
  return (
    asString(terminal?.terminal_name)
    || asString(terminal?.terminalName)
    || asString(terminal?.nombre)
    || asString(terminal?.name)
    || fallbackId
  );
};

const normalizeCurrencyCode = (value: unknown): string => {
  const normalized = asString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : '';
};

const resolveLocalFallbackCurrencyCode = (config: BusinessConfig): string => {
  const currencies = Array.isArray(config?.currencies) ? config.currencies : [];
  return (
    normalizeCurrencyCode(currencies.find((currency: any) => currency?.isBase)?.code)
    || normalizeCurrencyCode(currencies.find((currency: any) => currency?.isEnabled)?.code)
    || normalizeCurrencyCode(currencies[0]?.code)
  );
};

const resolveCurrencySymbol = (config: BusinessConfig, currencyCode: string): string => {
  const currencies = Array.isArray(config?.currencies) ? config.currencies : [];
  return asString(currencies.find((currency: any) => normalizeCurrencyCode(currency?.code) === currencyCode)?.symbol)
    || asString(config?.currencySymbol)
    || currencyCode;
};

const readCurrencyCodeList = (value: unknown): unknown[] => (
  Array.isArray(value) ? value : []
);

const getFirstCurrencyFromObjectMap = (record: unknown): string => {
  const value = asObject(record);
  const mapEntries = Object.entries(value);
  for (const [, raw] of mapEntries) {
    const code = normalizeCurrencyCode(raw);
    if (code) return code;
    const nested = normalizeCurrencyCode(asObject(raw).code);
    if (nested) return nested;
  }
  return '';
};

const getFirstCurrencyFromRecordObject = (record: unknown): string => {
  const value = asObject(record);
  const direct = (
    normalizeCurrencyCode(value.code)
    || normalizeCurrencyCode(value.currency_code)
    || normalizeCurrencyCode(value.currencyCode)
    || normalizeCurrencyCode(value.isoCode)
    || normalizeCurrencyCode(value.iso_code)
    || normalizeCurrencyCode((value as any).currency?.code)
    || normalizeCurrencyCode((value as any).currency?.currencyCode)
    || normalizeCurrencyCode((value as any).currency?.currency_code)
    || normalizeCurrencyCode((value as any).currency?.isoCode)
    || normalizeCurrencyCode((value as any).currency?.iso_code)
  );
  if (direct) return direct;

  const configBlock = asObject((value as any).config);
  const nestedCurrency = (
    normalizeCurrencyCode(configBlock.currency_code)
    || normalizeCurrencyCode(configBlock.primary_currency_code)
    || normalizeCurrencyCode(configBlock.base_currency_code)
    || normalizeCurrencyCode(configBlock.currencyCode)
    || normalizeCurrencyCode(configBlock.primaryCurrencyCode)
  );
  if (nestedCurrency) return nestedCurrency;

  const nestedCurrencyObj = asObject(asObject(value).currency);
  if (nestedCurrencyObj) {
    const inner = (
      normalizeCurrencyCode(nestedCurrencyObj.code)
      || normalizeCurrencyCode(nestedCurrencyObj.currency_code)
      || normalizeCurrencyCode(nestedCurrencyObj.currencyCode)
      || normalizeCurrencyCode(nestedCurrencyObj.currency?.code)
    );
    if (inner) return inner;
  }

  return (
    normalizeCurrencyCode(asObject(asObject(value).config).currency?.code)
    || normalizeCurrencyCode(asObject(asObject(value).profile).currency?.code)
    || getFirstCurrencyFromObjectMap(asObject(value).currency_map)
    || getFirstCurrencyFromObjectMap(asObject(value).currencyMap)
    || normalizeCurrencyCode(asObject(value).currencies?.default)
    || normalizeCurrencyCode(asObject(value).currencies?.base)
    || readCurrencyCodeFromItems(asObject(value).currencies?.list).find(Boolean)
  );
};

function readCurrencyCodeFromItems(value: unknown): string[] {
  return readCurrencyCodeList(value)
    .flatMap((item: unknown) => {
      const direct = normalizeCurrencyCode(item);
      if (direct) return [direct];
      return [getFirstCurrencyFromRecordObject(item)].filter(Boolean);
    });
}

const resolveCurrencyFromRecord = (record: unknown): string => {
  const value = asObject(record);
  const directCode = (
    normalizeCurrencyCode(value.currency_code)
    || normalizeCurrencyCode(value.primary_currency_code)
    || normalizeCurrencyCode(value.base_currency_code)
    || normalizeCurrencyCode(value.default_currency_code)
    || normalizeCurrencyCode(value.currencyCode)
    || normalizeCurrencyCode(value.currencyCodePrimary)
    || normalizeCurrencyCode(value.primaryCurrencyCode)
    || normalizeCurrencyCode(value.baseCurrencyCode)
    || normalizeCurrencyCode(value.defaultCurrencyCode)
    || normalizeCurrencyCode(value.currency?.code)
    || normalizeCurrencyCode(value.primaryCurrency?.code)
  );
  if (directCode) return directCode;

  return (
    readCurrencyCodeFromItems(value.currency_codes).find(Boolean)
    || readCurrencyCodeFromItems(value.currencyCodes).find(Boolean)
    || normalizeCurrencyCode(value.default_currency)
    || normalizeCurrencyCode(value.base_currency)
    || getFirstCurrencyFromRecordObject(value)
    || readCurrencyCodeFromItems(asObject(value).currencies).find(Boolean)
    || readCurrencyCodeFromItems(asObject(value).currencies?.list).find(Boolean)
    || readCurrencyCodeList(value.currencies).flatMap((item: unknown) => {
      const itemRecord = asObject(item);
      return [
        normalizeCurrencyCode(itemRecord.code),
        normalizeCurrencyCode(itemRecord.currency_code),
        normalizeCurrencyCode(itemRecord.value),
        normalizeCurrencyCode(itemRecord.currencyCode),
      ];
    }).find(Boolean)
  ) as string || '';
};

const applyPrimaryCurrencyToBusinessConfig = (config: BusinessConfig, currencyCode: string): BusinessConfig => {
  if (!currencyCode) return config;
  const currencies = Array.isArray(config?.currencies) ? config.currencies : [];
  const sourceCurrency = currencies.find((currency: any) => normalizeCurrencyCode(currency?.code) === currencyCode);
  const nextCurrencies = [{
    code: currencyCode,
    name: asString(sourceCurrency?.name) || currencyCode,
    symbol: asString(sourceCurrency?.symbol) || currencyCode,
    rate: Number.isFinite(Number(sourceCurrency?.rate)) && Number(sourceCurrency?.rate) > 0 ? Number(sourceCurrency?.rate) : 1,
    buyRate: sourceCurrency?.buyRate,
    sellRate: sourceCurrency?.sellRate,
    useDualRates: sourceCurrency?.useDualRates,
    isEnabled: true,
    isBase: true,
  }].map((currency: any) => ({
    ...currency,
    isBase: normalizeCurrencyCode(currency?.code) === currencyCode,
    isEnabled: normalizeCurrencyCode(currency?.code) === currencyCode ? true : currency?.isEnabled,
  }));

  return {
    ...config,
    currencySymbol: resolveCurrencySymbol({ ...config, currencies: nextCurrencies }, currencyCode),
    currencies: nextCurrencies,
  };
};

const resolveTerminalPrimaryCurrencyCode = (
  input: {
    terminalConfig?: unknown;
    profile?: unknown;
    terminal?: unknown;
    fallbackConfig: BusinessConfig;
  }
): string => {
  const terminalConfig = asObject(input.terminalConfig);
  const terminalConfigConfig = asObject(terminalConfig.config);
  const profile = asObject(input.profile);
  const terminal = asObject(input.terminal);

  return (
    resolveCurrencyFromRecord(terminalConfig)
    || resolveCurrencyFromRecord(terminalConfigConfig)
    || resolveCurrencyFromRecord(profile)
    || resolveCurrencyFromRecord(terminal)
    || resolveLocalFallbackCurrencyCode(input.fallbackConfig)
  );
};

const normalizeTerminalDedupeValue = (value: unknown): string => (
  asString(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_]+/g, '-')
);

const resolveTerminalDedupeKey = (terminal: any): string => {
  // El UUID ERP es la única identidad autoritativa. Códigos y nombres pueden
  // repetirse entre empresas, sucursales y tipos de terminal.
  return normalizeTerminalDedupeValue(terminal?.id);
};

const collectPreferredErpTerminalIds = (
  currentConfig?: BusinessConfig | null,
  extraIds: Array<string | null | undefined> = [],
): Set<string> => {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const normalized = asString(value);
    if (normalized) ids.add(normalized);
  };

  extraIds.forEach(add);
  if (Array.isArray(currentConfig?.terminals)) {
    currentConfig.terminals.forEach((terminal: any) => {
      add(terminal?.config?.erpTerminalId);
      add(terminal?.config?.erpBinding?.terminalId);
    });
  }

  if (typeof localStorage !== 'undefined') {
    add(localStorage.getItem('clic_erp_sync_terminal_id'));
    add(localStorage.getItem('clic_last_authorized_erp_terminal_id'));
  }

  return ids;
};

const scoreErpTerminalForDedupe = (
  terminal: any,
  options: {
    preferredIds?: Set<string>;
    selectedTerminalErpId?: string | null;
    posDeviceId?: string | null;
  } = {},
): number => {
  const id = asString(terminal?.id);
  const config = asObject(terminal?.config);
  const metadata = asObject(terminal?.metadata);
  const terminalConfig = asObject(terminal?.terminal_config);
  const deviceId = asString(terminal?.device_id);
  let score = 0;

  if (id && id === asString(options.selectedTerminalErpId)) score += 10000;
  if (id && options.preferredIds?.has(id)) score += 5000;
  if (deviceId && deviceId === asString(options.posDeviceId)) score += 2500;
  if (deviceId) score += 250;
  if (asString(terminal?.station_number) || asString(terminal?.code) || asString(terminal?.terminal_code) || asString(terminal?.pos_code)) score += 200;
  if (asString(terminal?.store_id)) score += 80;
  if (asString(terminal?.company_id)) score += 80;
  if (Object.keys(config).length > 0) score += 40;
  if (Object.keys(metadata).length > 0) score += 30;
  if (Object.keys(terminalConfig).length > 0) score += 30;

  return score;
};

const dedupeErpTerminals = (
  terminals: any[],
  options: {
    preferredIds?: Set<string>;
    selectedTerminalErpId?: string | null;
    posDeviceId?: string | null;
  } = {},
): any[] => {
  const byKey = new Map<string, { terminal: any; score: number; index: number }>();

  terminals.forEach((terminal, index) => {
    const key = resolveTerminalDedupeKey(terminal) || asString(terminal?.id) || `terminal-${index}`;
    const score = scoreErpTerminalForDedupe(terminal, options);
    const existing = byKey.get(key);
    if (!existing || score > existing.score || (score === existing.score && index > existing.index)) {
      byKey.set(key, { terminal, score, index });
    }
  });

  return Array.from(byKey.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.terminal);
};

const resolveErpTerminalDeviceRole = (terminal: any) => {
  const config = asObject(terminal?.config);
  const metadata = asObject(terminal?.metadata);
  const terminalConfig = asObject(terminal?.terminal_config);
  const resolved = asObject(terminalConfig.resolved);
  const identity = asObject(resolved.identity);
  const resolvedTerminal = asObject(resolved.terminal);
  const deviceRole = asObject(config.deviceRole ?? config.device_role);

  return resolveDeviceRoleValue([
    terminal?.deviceRole,
    terminal?.device_role,
    terminal?.deviceRoleCode,
    terminal?.device_role_code,
    terminal?.terminalType,
    terminal?.terminal_type,
    terminal?.deviceType,
    terminal?.device_type,
    terminal?.roleCode,
    terminal?.role_code,
    terminal?.role,
    config.deviceRole,
    config.device_role,
    config.deviceRoleCode,
    config.device_role_code,
    config.terminalType,
    config.terminal_type,
    config.deviceType,
    config.device_type,
    config.roleCode,
    config.role_code,
    config.role,
    deviceRole.role,
    deviceRole.deviceRole,
    deviceRole.device_role,
    deviceRole.role_code,
    deviceRole.device_role_code,
    metadata.deviceRole,
    metadata.device_role,
    metadata.terminalType,
    metadata.terminal_type,
    metadata.deviceType,
    metadata.device_type,
    metadata.role_code,
    metadata.device_role_code,
    identity.deviceRole,
    identity.device_role,
    identity.terminalType,
    identity.terminal_type,
    identity.deviceType,
    identity.device_type,
    identity.role_code,
    identity.device_role_code,
    resolvedTerminal.deviceRole,
    resolvedTerminal.device_role,
    resolvedTerminal.terminalType,
    resolvedTerminal.terminal_type,
    resolvedTerminal.deviceType,
    resolvedTerminal.device_type,
    resolvedTerminal.role_code,
    resolvedTerminal.device_role_code,
    resolved.deviceRole,
    resolved.device_role,
    resolved.terminalType,
    resolved.terminal_type,
    resolved.deviceType,
    resolved.device_type,
    resolved.role_code,
    resolved.device_role_code,
  ]);
};

const applyErpTerminalDeviceRole = (terminalConfig: TerminalConfig, erpTerminal: any): TerminalConfig => {
  const role = resolveErpTerminalDeviceRole(erpTerminal);
  const orderTakerContract = resolveOrderTakerContract(erpTerminal);
  const effectiveRole = role || terminalConfig.deviceRole?.role;
  const erpConfig = asObject(erpTerminal?.config);
  const erpMetadata = asObject(erpTerminal?.metadata ?? erpConfig.metadata);
  const erpTerminalConfig = asObject(erpTerminal?.terminal_config ?? erpTerminal?.terminalConfig);
  const erpResolved = asObject(erpTerminalConfig.resolved);
  const erpIdentity = asObject(erpResolved.identity);
  const erpResolvedTerminal = asObject(erpResolved.terminal);
  const deviceProfile = resolveDeviceProfile([
    erpTerminal?.deviceProfile,
    erpTerminal?.device_profile,
    erpConfig.deviceProfile,
    erpConfig.device_profile,
    erpMetadata.deviceProfile,
    erpMetadata.device_profile,
    erpIdentity.deviceProfile,
    erpIdentity.device_profile,
    erpResolvedTerminal.deviceProfile,
    erpResolvedTerminal.device_profile,
    erpResolved.deviceProfile,
    erpResolved.device_profile,
    terminalConfig.deviceProfile,
    terminalConfig.device_profile,
  ], effectiveRole);
  const deviceProfileContract = toDeviceProfileContract(deviceProfile);
  if (!role) return {
    ...terminalConfig,
    ...deviceProfileContract,
    terminalType: orderTakerContract.terminalType,
    terminal_type: orderTakerContract.terminalType,
    masterTerminalId: orderTakerContract.masterTerminalId,
    master_terminal_id: orderTakerContract.masterTerminalId,
    capabilities: orderTakerContract.capabilities,
    restrictions: orderTakerContract.restrictions,
  };

  const defaults = getDefaultRoleConfig(role);
  const currentDeviceRole = terminalConfig.deviceRole || defaults;

  return {
    ...terminalConfig,
    ...deviceProfileContract,
    terminalType: role,
    terminal_type: role,
    masterTerminalId: orderTakerContract.masterTerminalId,
    master_terminal_id: orderTakerContract.masterTerminalId,
    capabilities: orderTakerContract.capabilities,
    restrictions: orderTakerContract.restrictions,
    deviceRole: {
      ...defaults,
      ...currentDeviceRole,
      role,
      authLevel: role === currentDeviceRole.role
        ? currentDeviceRole.authLevel || defaults.authLevel
        : defaults.authLevel,
      allowedModules: role === currentDeviceRole.role
        ? currentDeviceRole.allowedModules || defaults.allowedModules
        : defaults.allowedModules,
      defaultRoute: role === currentDeviceRole.role
        ? currentDeviceRole.defaultRoute || defaults.defaultRoute
        : defaults.defaultRoute,
      uiSettings: {
        ...defaults.uiSettings,
        ...(role === currentDeviceRole.role ? currentDeviceRole.uiSettings || {} : {}),
      },
      hardwareConfig: {
        ...defaults.hardwareConfig,
        ...(role === currentDeviceRole.role ? currentDeviceRole.hardwareConfig || {} : {}),
      },
    },
    erpBinding: {
      ...(terminalConfig.erpBinding || {}),
      role,
    },
  };
};

const createTerminalTemplate = (currentConfig: BusinessConfig, terminalId: string, erpTerminalId?: string) => {
  const terminals = Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : [];
  const existing = terminals.find((terminal: any) =>
    asString(terminal?.id) === terminalId
    || (erpTerminalId && asString(terminal?.config?.erpTerminalId) === erpTerminalId)
  );
  const template = existing?.config || terminals[0]?.config;
  if (!template) {
    throw new Error('No hay configuración base de terminal disponible en POS para materializar la terminal del ERP.');
  }

  const nextTemplate = cloneDeep(template);
  const deviceBindingToken = asString(nextTemplate.deviceBindingToken) || `token-${terminalId}`;

  nextTemplate.deviceBindingToken = deviceBindingToken;
  nextTemplate.security = {
    requirePinForVoid: Boolean(nextTemplate.security?.requirePinForVoid),
    requirePinForDiscount: Boolean(nextTemplate.security?.requirePinForDiscount),
    requireManagerForRefunds: Boolean(nextTemplate.security?.requireManagerForRefunds),
    autoLogoutMinutes: Number(nextTemplate.security?.autoLogoutMinutes) || 15,
    ...asObject(nextTemplate.security),
    deviceBindingToken,
  };
  nextTemplate.syncConfig = {
    autoSyncIntervalMs: Number(nextTemplate.syncConfig?.autoSyncIntervalMs) || 30000,
    isEnabled: nextTemplate.syncConfig?.isEnabled ?? true,
    mode: nextTemplate.syncConfig?.mode || 'MASTER',
    ...asObject(nextTemplate.syncConfig),
  };

  return nextTemplate;
};

const buildBoundConfig = (input: {
  currentConfig: BusinessConfig;
  terminals: any[];
  profilesByTerminalId: Map<string, any>;
  selectedTerminalErpId: string;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: BindingMode;
}) => {
  const { currentConfig, terminals, profilesByTerminalId, selectedTerminalErpId, selectedTerminalId, posDeviceId, bindingMode } = input;
  const now = new Date().toISOString();
  const dedupedTerminals = dedupeErpTerminals(terminals, {
    preferredIds: collectPreferredErpTerminalIds(currentConfig, [selectedTerminalErpId]),
    selectedTerminalErpId,
    posDeviceId,
  });
  let selectedTerminalCurrencyCode = '';
  const nextTerminals = dedupedTerminals.map((terminal: any) => {
    const erpTerminalId = asString(terminal.id);
    const terminalCode = resolveOperationalTerminalId(terminal) || erpTerminalId;
    const terminalId = erpTerminalId;
    const terminalName = resolveTerminalName(terminal, terminalCode);
    const profilePayload = profilesByTerminalId.get(erpTerminalId);
    const profile = asObject(profilePayload?.profile || profilePayload);
    const terminalConfigPayload = terminal?.terminal_config || terminal?.terminalConfig || profilePayload?.terminal_config || profilePayload?.terminalConfig;
    const existingTerminal = Array.isArray(currentConfig?.terminals)
      ? currentConfig.terminals.find((item: any) => asString(item?.id) === terminalId)
        || currentConfig.terminals.find((item: any) => asString(item?.config?.erpTerminalId) === erpTerminalId)
        || currentConfig.terminals.find((item: any) => asString(item?.id) === terminalCode)
      : null;

    const baseConfig = applyErpTerminalDeviceRole(
      createTerminalTemplate(currentConfig, terminalId, erpTerminalId),
      terminal
    );
    const occupiedDeviceId = resolveOccupiedDeviceId(terminal, profilesByTerminalId.get(erpTerminalId));
    const primaryCurrencyCode = resolveTerminalPrimaryCurrencyCode({
      terminalConfig: terminalConfigPayload,
      profile,
      terminal,
      fallbackConfig: currentConfig,
    });
    if (erpTerminalId === selectedTerminalErpId) {
      selectedTerminalCurrencyCode = primaryCurrencyCode;
    }
    const nextCurrentDeviceId =
      erpTerminalId === selectedTerminalErpId
        ? posDeviceId
        : occupiedDeviceId === posDeviceId
          ? undefined
          : occupiedDeviceId;

    const nextConfig = {
      ...baseConfig,
      erpTerminalId,
      terminalName,
      stationNumber: terminalCode,
      currencyCode: primaryCurrencyCode,
      primaryCurrencyCode,
      currency: primaryCurrencyCode,
      currentDeviceId: nextCurrentDeviceId || undefined,
      lastPairingDate: erpTerminalId === selectedTerminalErpId ? now : existingTerminal?.config?.lastPairingDate,
      isPrimaryNode: erpTerminalId === selectedTerminalErpId ? bindingMode === 'MASTER' : Boolean(baseConfig.isPrimaryNode),
      governedByMaster: erpTerminalId === selectedTerminalErpId ? bindingMode === 'SLAVE' : Boolean(baseConfig.governedByMaster),
      syncConfig: {
        ...asObject(baseConfig.syncConfig),
        mode: erpTerminalId === selectedTerminalErpId ? bindingMode : baseConfig?.syncConfig?.mode || 'MASTER',
        autoSyncIntervalMs: Number(baseConfig?.syncConfig?.autoSyncIntervalMs) || 30000,
        isEnabled: true,
      },
      erpBinding: {
        ...asObject(baseConfig.erpBinding),
        terminalId: erpTerminalId,
        terminalName,
        deviceId: erpTerminalId === selectedTerminalErpId ? posDeviceId : nextCurrentDeviceId || undefined,
        currencyCode: primaryCurrencyCode,
        primaryCurrencyCode,
      },
    };

    return {
      id: terminalId,
      config: nextConfig,
    };
  });

  return {
    ...applyPrimaryCurrencyToBusinessConfig(cloneDeep(currentConfig), selectedTerminalCurrencyCode),
    terminals: nextTerminals,
  };
};

export const materializeErpTerminalCards = (input: {
  terminals: any[];
  currentConfig: BusinessConfig;
  posDeviceId: string;
}): RuntimeTerminalCard[] => {
  const activeTerminals = (Array.isArray(input.terminals) ? input.terminals : []).filter((terminal: any) => {
    return !isArchivedTerminalBindingRecord(terminal);
  });
  const rawTerminals = dedupeErpTerminals(
    activeTerminals,
    {
      preferredIds: collectPreferredErpTerminalIds(input.currentConfig),
      posDeviceId: input.posDeviceId,
    },
  );
  const terminals = rawTerminals.map((terminal: any) => {
    const erpTerminalId = asString(terminal.id);
    const terminalCode = resolveOperationalTerminalId(terminal) || erpTerminalId;
    const terminalId = erpTerminalId;
    const terminalConfigPayload = terminal?.terminal_config || terminal?.terminalConfig || terminal?.config;
    const primaryCurrencyCode = resolveTerminalPrimaryCurrencyCode({
      terminalConfig: terminalConfigPayload,
      profile: terminal?.profile,
      terminal,
      fallbackConfig: input.currentConfig,
    });
    const location =
      asString(terminal.store_name) ||
      asString(terminal.company_name) ||
      'ERP';
    const currentDeviceId = asString(terminal.device_id) || undefined;
    const occupied = Boolean(currentDeviceId && currentDeviceId !== input.posDeviceId);
    const orderTakerContract = resolveOrderTakerContract(terminal);
    const templateConfig =
      Array.isArray(input.currentConfig?.terminals) && input.currentConfig.terminals.length > 0
        ? applyErpTerminalDeviceRole(createTerminalTemplate(input.currentConfig, terminalId, erpTerminalId), terminal)
        : ({} as TerminalConfig);
    const terminalConfig: TerminalConfig = {
      ...templateConfig,
      erpTerminalId,
      terminalName: resolveTerminalName(terminal, terminalCode),
      stationNumber: terminalCode,
      currentDeviceId,
      erpBinding: {
        ...(templateConfig.erpBinding || {}),
        terminalId: erpTerminalId,
        terminalName: resolveTerminalName(terminal, terminalCode),
        stationNumber: terminalCode,
        deviceId: currentDeviceId,
      },
      currencyCode: primaryCurrencyCode,
      primaryCurrencyCode,
      currency: primaryCurrencyCode,
    };

    return {
      id: terminalId,
      erpTerminalId,
      tenantId: asString(terminal.tenant_id) || undefined,
      companyId: asString(terminal.company_id) || undefined,
      companyName: asString(terminal.company_name) || 'Empresa sin identificar',
      storeId: asString(terminal.store_id) || undefined,
      storeName: asString(terminal.store_name) || 'Sucursal sin identificar',
      name: resolveTerminalName(terminal, terminalCode),
      terminalCode: asString(terminal.terminal_code) || terminalCode || undefined,
      bindingStatus: (asString(terminal.binding_status) || (occupied ? 'OCCUPIED' : 'AVAILABLE')).toUpperCase(),
      location,
      occupied,
      canReauthorize: typeof terminal.can_reauthorize === 'boolean'
        ? terminal.can_reauthorize
        : occupied,
      currentDeviceId: currentDeviceId || undefined,
      terminalType: orderTakerContract.terminalType,
      terminal_type: orderTakerContract.terminalType,
      masterTerminalId: orderTakerContract.masterTerminalId,
      master_terminal_id: orderTakerContract.masterTerminalId,
      capabilities: orderTakerContract.capabilities,
      restrictions: orderTakerContract.restrictions,
      ...toDeviceProfileContract(resolveTerminalDeviceProfile({
        ...terminal,
        config: terminalConfig,
      }, terminalConfig.deviceRole?.role)),
      config: terminalConfig,
    };
  });

  return terminals;
};

export const listTerminalsFromErp = async (input: {
  currentConfig: BusinessConfig;
  posDeviceId: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantEmail?: string | null;
  erpBaseUrl: string;
}): Promise<RuntimeTerminalListResponse> => {
  const resolvedContext = await resolveErpTerminalContext({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantEmail: input.tenantEmail,
    deviceId: input.posDeviceId,
    erpBaseUrl: input.erpBaseUrl,
  });
  const terminals = materializeErpTerminalCards({
    terminals: resolvedContext.terminals,
    currentConfig: input.currentConfig,
    posDeviceId: input.posDeviceId,
  });

  return {
    tenant_id: resolvedContext.tenantId,
    erp_base_url: input.erpBaseUrl,
    terminals,
  };
};

export const bindTerminalFromErp = async (input: {
  currentConfig: BusinessConfig;
  posDeviceId: string;
  deviceName?: string;
  terminalId: string;
  erpTerminalId?: string | null;
  bindingMode: BindingMode;
  forceTransfer?: boolean;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantEmail?: string | null;
  erpBaseUrl: string;
}): Promise<RuntimeBindTerminalResponse> => {
  const resolvedContext = await resolveErpTerminalContext({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantEmail: input.tenantEmail,
    deviceId: input.posDeviceId,
    erpBaseUrl: input.erpBaseUrl,
  });

  const erpTerminals = Array.isArray(resolvedContext.terminals) ? resolvedContext.terminals : [];
  const targetTerminal = erpTerminals.find((terminal: any) => {
    const erpTerminalId = asString(terminal.id);
    const operationalId = resolveOperationalTerminalId(terminal) || erpTerminalId;
    return erpTerminalId === asString(input.erpTerminalId) || operationalId === input.terminalId;
  });

  if (!targetTerminal) {
    throw new Error('La terminal no existe en el ERP para este tenant.');
  }
  if (isArchivedTerminalBindingRecord(targetTerminal)) {
    throw new Error('La terminal seleccionada fue archivada en el ERP. Actualiza la lista y selecciona su identidad activa.');
  }

  const targetErpTerminalId = resolveRegisterErpTerminalId(targetTerminal);
  if (!targetErpTerminalId) {
    throw new CanonicalErpTerminalIdError();
  }
  const targetTerminalCode = resolveOperationalTerminalId(targetTerminal) || targetErpTerminalId;
  const targetTerminalId = targetErpTerminalId;
  const targetTerminalName = resolveTerminalName(targetTerminal, targetTerminalCode);
  const pairingLogBase = {
    selectedTerminalUuid: targetErpTerminalId,
    terminalName: targetTerminalName,
    terminalCode: targetTerminalCode,
    generatedDeviceId: input.posDeviceId,
    cloudAdminTenantId: input.tenantId || null,
    erpTenantId: resolvedContext.tenantId || null,
  };
  console.info('[POS_ERP_PAIRING]', {
    ...pairingLogBase,
    status: 'START_BIND',
  });

  const currentProfilePayload = await fetchTerminalProfileSafe(
    input.erpBaseUrl,
    resolvedContext.tenantId,
    targetErpTerminalId
  );
  const currentProfile = asObject(currentProfilePayload?.profile);
  const currentMetadata = asObject(currentProfile.metadata);
  const currentTerminalConfigPayload =
    targetTerminal?.terminal_config
    || targetTerminal?.terminalConfig
    || currentProfilePayload?.terminal_config
    || currentProfilePayload?.terminalConfig
    || currentProfile?.config;
  const currentProfileCurrencyCode = resolveTerminalPrimaryCurrencyCode({
    terminalConfig: currentTerminalConfigPayload,
    profile: currentProfilePayload?.profile || currentProfilePayload,
    terminal: targetTerminal,
    fallbackConfig: input.currentConfig,
  });
  const currentProfileCurrencyCodes =
    Array.isArray(currentProfile.currency_codes) && currentProfile.currency_codes.length > 0
      ? currentProfile.currency_codes
      : (currentProfileCurrencyCode ? [currentProfileCurrencyCode] : []);
  const occupiedDeviceId =
    asString(targetTerminal.device_id) || resolveOccupiedDeviceId(targetTerminal, currentProfilePayload);

  let registerPayload: Record<string, any> | null = null;

  let authorizationCheck: Awaited<ReturnType<typeof checkTerminalAuthorizationFromErp>>;
  try {
    authorizationCheck = await checkTerminalAuthorizationFromErp({
      erpBaseUrl: input.erpBaseUrl,
      tenantId: resolvedContext.tenantId,
      erpTerminalId: targetErpTerminalId,
      posDeviceId: input.posDeviceId,
    });
  } catch (authorizationError) {
    // Reasignación explícita del usuario: el chequeo puede devolver
    // DEVICE_SUPERSEDED porque el equipo anterior sigue autorizado en el ERP.
    // Continuamos al takeover en lugar de bloquear la operación.
    if (!input.forceTransfer) throw authorizationError;
    const authError = authorizationError as SetupDeviceAuthorizationError;
    console.warn('[POS_ERP_PAIRING]', {
      ...pairingLogBase,
      status: 'FORCE_TRANSFER_AUTH_CHECK_FAILED',
      authResponseCode: authError?.code || null,
    });
    authorizationCheck = {
      authorized: false,
      payload: (authError?.payload || {}) as Record<string, unknown>,
    } as Awaited<ReturnType<typeof checkTerminalAuthorizationFromErp>>;
  }
  const authorizationPayload = authorizationCheck.payload;
  const occupiedByAnotherDevice = Boolean(
    occupiedDeviceId
    && occupiedDeviceId.toUpperCase() !== input.posDeviceId.toUpperCase()
  );
  if (occupiedByAnotherDevice && input.forceTransfer) {
    await fetchErpJson(input.erpBaseUrl, `/api/settings/terminals/${encodeURIComponent(targetErpTerminalId)}/takeover`, {
      method: 'POST',
      headers: {
        ...(await getSupabaseAuthHeaders()),
        ...buildDeviceHeaders(input.posDeviceId),
      },
      body: {
        terminal_id: targetErpTerminalId,
        device_id: input.posDeviceId,
        ...(input.deviceName ? { device_name: input.deviceName } : {}),
        source: 'ALFA_POS_SELF_SERVICE',
      },
    });
  } else if (occupiedByAnotherDevice && !authorizationCheck.authorized) {
    console.warn('[POS_ERP_PAIRING]', {
      ...pairingLogBase,
      previousDeviceId: occupiedDeviceId,
      authResponseCode: resolveBackendCode(authorizationPayload) || 'DEVICE_NOT_AUTHORIZED',
      pairingStatus: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
    });
    throw new SetupDeviceAuthorizationError(
      resolveBackendCode(authorizationPayload) || 'DEVICE_NOT_AUTHORIZED',
      'La autorización debe completarse desde Cloud Admin. Este dispositivo no puede autorizarse por sí mismo.',
      {
        httpStatus: 403,
        payload: authorizationPayload,
        currentDeviceId: occupiedDeviceId,
        terminalId: targetErpTerminalId,
        terminalName: targetTerminalName,
      },
    );
  }

  try {
    registerPayload = asObject(await fetchErpJson(input.erpBaseUrl, '/api/sync/terminals/register', {
      method: 'POST',
      headers: buildDeviceHeaders(input.posDeviceId),
      body: {
        device_id: input.posDeviceId,
        tenant_id: input.tenantId || resolvedContext.tenantId,
        tenantId: input.tenantId || resolvedContext.tenantId,
        cloudAdminTenantId: input.tenantId || null,
        cloud_admin_tenant_id: input.tenantId || null,
        erpTenantId: resolvedContext.tenantId,
        erp_tenant_id: resolvedContext.tenantId,
        company_ref: input.tenantSlug || null,
        company_id: asString(targetTerminal.company_id) || resolvedContext.companyId,
        store_id: asString(targetTerminal.store_id) || resolvedContext.storeId,
        name: targetTerminalName,
        terminal_id: targetErpTerminalId,
        erp_terminal_id: targetErpTerminalId,
        terminal_name: targetTerminalName,
        terminal_code: targetTerminalCode,
        app_version: asString(localStorage.getItem('clic_pos_app_version')) || asString(localStorage.getItem('apk_version_name')) || null,
        sync_capabilities: [VARIANT_PROMOTIONS_CAPABILITY],
        capabilities: [VARIANT_PROMOTIONS_CAPABILITY],
        capability_versions: POS_SYNC_CAPABILITY_VERSIONS,
        metadata: {
          source: 'CLIC_POS_SETUP',
          terminal_id: targetErpTerminalId,
          erp_terminal_id: targetErpTerminalId,
          terminal_name: targetTerminalName,
          terminal_code: targetTerminalCode,
          device_id: input.posDeviceId,
          cloud_admin_tenant_id: input.tenantId || null,
          erp_tenant_id: resolvedContext.tenantId,
          binding_mode: input.bindingMode,
        },
      },
    }));
    console.info('[POS_ERP_PAIRING]', {
      ...pairingLogBase,
      authResponseCode: resolveBackendCode(registerPayload) || asString(registerPayload?.status) || 'OK',
      pairingStatus: 'REGISTER_ACCEPTED',
    });
  } catch (registerError) {
    if (registerError instanceof SetupDeviceAuthorizationError) {
      console.warn('[POS_ERP_PAIRING]', {
        ...pairingLogBase,
        authResponseCode: registerError.code,
        pairingStatus: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
        httpStatus: registerError.httpStatus,
      });
      throw registerError;
    }
    console.warn('⚠️ ERP /terminals/register failed; pairing remains pending:', registerError);
    throw registerError;
  }

  const canonicalErpTerminalId = resolveRegisterErpTerminalId(registerPayload);
  if (!canonicalErpTerminalId) {
    console.warn('[POS_ERP_PAIRING]', {
      ...pairingLogBase,
      authResponseCode: 'CANONICAL_ERP_TERMINAL_ID_MISSING',
      pairingStatus: 'PENDING',
    });
    throw new CanonicalErpTerminalIdError();
  }
  const canonicalErpTerminals = erpTerminals.map((terminal: any) => (
    terminal === targetTerminal
      ? {
          ...terminal,
          id: canonicalErpTerminalId,
          erp_terminal_id: canonicalErpTerminalId,
          erpTerminalId: canonicalErpTerminalId,
        }
      : terminal
  ));

  const mergedMetadata = {
    ...currentMetadata,
    bound_device_id: input.posDeviceId,
    bound_at: new Date().toISOString(),
    binding_mode: input.bindingMode,
    transferred_from_device_id:
      occupiedDeviceId && occupiedDeviceId !== input.posDeviceId ? occupiedDeviceId : currentMetadata.transferred_from_device_id || null,
    binding_source: 'CLIC_POS_SETUP',
  };

  const persistedProfilePayload = await fetchErpJson(input.erpBaseUrl, '/api/sync/bootstrap/terminal-profile', {
    method: 'POST',
    headers: buildDeviceHeaders(input.posDeviceId),
    body: {
      tenant_id: resolvedContext.tenantId,
      company_id: asString(targetTerminal.company_id) || resolvedContext.companyId,
      store_id: asString(targetTerminal.store_id) || resolvedContext.storeId,
        terminal_id: canonicalErpTerminalId,
        device_id: input.posDeviceId,
      profile_status: currentProfile.profile_status || 'ACTIVE',
      document_types: Array.isArray(currentProfile.document_types) ? currentProfile.document_types : [],
      series_codes: Array.isArray(currentProfile.series_codes) ? currentProfile.series_codes : [],
      warehouse_codes: Array.isArray(currentProfile.warehouse_codes) ? currentProfile.warehouse_codes : [],
      currency_code: currentProfileCurrencyCode || null,
      primary_currency_code: currentProfileCurrencyCode || null,
      base_currency_code: currentProfileCurrencyCode || null,
      default_currency_code: currentProfileCurrencyCode || null,
      currencyCode: currentProfileCurrencyCode || null,
      primaryCurrencyCode: currentProfileCurrencyCode || null,
      baseCurrencyCode: currentProfileCurrencyCode || null,
      defaultCurrencyCode: currentProfileCurrencyCode || null,
      currency: currentProfileCurrencyCode ? {
        code: currentProfileCurrencyCode,
        currency_code: currentProfileCurrencyCode,
        currencyCode: currentProfileCurrencyCode,
      } : undefined,
      currencies: currentProfileCurrencyCode ? {
        default: currentProfileCurrencyCode,
        base: currentProfileCurrencyCode,
        primary: currentProfileCurrencyCode,
        list: [{ code: currentProfileCurrencyCode, currency_code: currentProfileCurrencyCode, currencyCode: currentProfileCurrencyCode }],
      } : undefined,
      currency_codes: currentProfileCurrencyCodes,
      currencyCodes: currentProfileCurrencyCodes,
      tax_codes: Array.isArray(currentProfile.tax_codes) ? currentProfile.tax_codes : [],
      customer_codes: Array.isArray(currentProfile.customer_codes) ? currentProfile.customer_codes : [],
      supplier_codes: Array.isArray(currentProfile.supplier_codes) ? currentProfile.supplier_codes : [],
      item_codes: Array.isArray(currentProfile.item_codes) ? currentProfile.item_codes : [],
      payment_method_codes: Array.isArray(currentProfile.payment_method_codes) ? currentProfile.payment_method_codes : [],
      metadata: mergedMetadata,
    },
  });

  const persistedProfile = asObject(persistedProfilePayload?.profile || persistedProfilePayload);
  const selectedCurrencyCode = currentProfileCurrencyCode || resolveTerminalPrimaryCurrencyCode({
    terminalConfig: persistedProfilePayload?.terminal_config || persistedProfilePayload?.terminalConfig || persistedProfile?.config,
    profile: persistedProfile,
    terminal: targetTerminal,
    fallbackConfig: input.currentConfig,
  });
  const selectedProfilePayload = {
    ...currentProfilePayload,
    ...asObject(persistedProfilePayload),
    currency_code: selectedCurrencyCode || asString(currentProfilePayload?.currency_code) || undefined,
    profile: {
      ...currentProfile,
      ...persistedProfile,
      currency_code: selectedCurrencyCode || asString(currentProfile.currency_code) || asString(persistedProfile.currency_code) || undefined,
      primary_currency_code: selectedCurrencyCode || asString(currentProfile.primary_currency_code) || asString(persistedProfile.primary_currency_code) || undefined,
      base_currency_code: selectedCurrencyCode || asString(currentProfile.base_currency_code) || asString(persistedProfile.base_currency_code) || undefined,
      default_currency_code: selectedCurrencyCode || asString(currentProfile.default_currency_code) || asString(persistedProfile.default_currency_code) || undefined,
      currencyCode: selectedCurrencyCode || asString(currentProfile.currencyCode) || asString(persistedProfile.currencyCode) || undefined,
      config: {
        ...asObject(currentProfile.config),
        ...asObject(persistedProfile.config),
        currency_code: selectedCurrencyCode || asString(asObject(currentProfile.config).currency_code) || asString(asObject(persistedProfile.config).currency_code) || undefined,
      },
    },
  };

  const profiles = await Promise.all(
    canonicalErpTerminals.map(async (terminal: any) => {
      const id = asString(terminal.id);
      if (id === canonicalErpTerminalId) {
        return [id, selectedProfilePayload] as const;
      }
      const profile = await fetchTerminalProfileSafe(input.erpBaseUrl, resolvedContext.tenantId, id);
      return [id, profile] as const;
    })
  );

  const profilesByTerminalId = new Map<string, any>(profiles);
  let recoveryState: RuntimeTerminalRecoveryState | null = null;

  const boundConfig = buildBoundConfig({
    currentConfig: input.currentConfig,
    terminals: canonicalErpTerminals,
    profilesByTerminalId,
    selectedTerminalErpId: canonicalErpTerminalId,
    selectedTerminalId: canonicalErpTerminalId,
    posDeviceId: input.posDeviceId,
    bindingMode: input.bindingMode,
  });
  const runtimeAuth = extractErpRegisterAuth(
    registerPayload,
    registerPayload?.auth,
    registerPayload?.syncHeaders,
    registerPayload?.sync_headers,
    persistedProfilePayload,
    persistedProfilePayload?.profile,
    selectedProfilePayload,
    selectedProfilePayload?.profile,
    currentProfilePayload,
    currentProfilePayload?.profile,
    targetTerminal
  );
  if (runtimeAuth.deviceToken) {
    persistSyncDeviceToken(runtimeAuth.deviceToken, 'ERP_REGISTER', runtimeAuth.tokenExpiresAt);
  }
  if (runtimeAuth.deviceToken || runtimeAuth.syncToken) {
    saveTerminalCredentialsSync({
      terminalId: canonicalErpTerminalId,
      erpTerminalId: canonicalErpTerminalId,
      terminalCode: targetTerminalCode,
      stationNumber: targetTerminalCode,
      terminalName: targetTerminalName,
      deviceId: input.posDeviceId,
      tenantId: resolvedContext.tenantId,
      erpTenantId: resolvedContext.tenantId,
      cloudAdminTenantId: input.tenantId || null,
      ...(runtimeAuth.deviceToken ? {
        deviceToken: runtimeAuth.deviceToken,
        deviceTokenSource: 'ERP_REGISTER',
        deviceTokenUpdatedAt: new Date().toISOString(),
        deviceTokenExpiresAt: runtimeAuth.tokenExpiresAt || null,
      } : {}),
      ...(runtimeAuth.syncToken ? {
        syncToken: runtimeAuth.syncToken,
        syncTokenUpdatedAt: new Date().toISOString(),
        syncTokenExpiresAt: runtimeAuth.tokenExpiresAt || null,
      } : {}),
    });
  }
  const syncProfile = resolveIncomingSyncProfileFromRegister(
    registerPayload,
    {
      erpTerminalId: canonicalErpTerminalId,
      localTerminalId: targetTerminalCode,
      localTenantId: resolvedContext.tenantId || undefined,
      localStoreId: asString(targetTerminal.store_id) || resolvedContext.storeId || undefined,
      erpBaseUrl: input.erpBaseUrl,
      cloudBaseUrl: input.erpBaseUrl,
    },
    'ERP_REGISTER',
  );

  return {
    ...(registerPayload || {}),
    success: true,
    tenant_id: resolvedContext.tenantId,
    terminal_id: canonicalErpTerminalId,
    erp_terminal_id: canonicalErpTerminalId,
    terminal_code: targetTerminalCode,
    terminal_name: targetTerminalName,
    company_id: asString(targetTerminal.company_id) || resolvedContext.companyId || null,
    store_id: asString(targetTerminal.store_id) || resolvedContext.storeId || null,
    transferred: false,
    previous_device_id: asString(registerPayload?.previous_device_id) || null,
    recovery_state: recoveryState,
    config: boundConfig,
    syncProfile,
    sync_profile: syncProfile,
    incomingProfile: registerPayload?.incomingProfile || registerPayload?.incoming_profile || syncProfile,
    incoming_profile: registerPayload?.incomingProfile || registerPayload?.incoming_profile || syncProfile,
    profile: registerPayload?.profile || syncProfile,
    deviceToken: runtimeAuth.deviceToken,
    device_token: runtimeAuth.deviceToken,
    terminalToken: runtimeAuth.terminalToken,
    terminal_token: runtimeAuth.terminalToken,
    activationToken: runtimeAuth.activationToken,
    activation_token: runtimeAuth.activationToken,
    syncToken: runtimeAuth.syncToken,
    sync_token: runtimeAuth.syncToken,
        syncAuthToken: runtimeAuth.syncToken,
        sync_auth_token: runtimeAuth.syncToken,
        tokenExpiresAt: runtimeAuth.tokenExpiresAt,
        token_expires_at: runtimeAuth.tokenExpiresAt,
      };
};

export const fetchInitialConfigFromErp = async (input: {
  erpBaseUrl: string;
  tenantId: string;
  erpTerminalId: string;
  posDeviceId: string;
}): Promise<RuntimeInitialConfigResponse> => {
  let payload: Record<string, any>;
  let configVersion: string | null = null;
  let etag: string | null = null;

  if (getNetworkEngine() === 'capacitor-http') {
    const query = new URLSearchParams({
      tenant_id: input.tenantId,
      device_id: input.posDeviceId,
    });
    payload = asObject(await fetchErpJson(
      input.erpBaseUrl,
      `/api/setup/initial-config/${encodeURIComponent(input.erpTerminalId)}?${query.toString()}`,
      {
        headers: buildDeviceHeaders(input.posDeviceId),
      }
    ));
    configVersion = asString(payload.config_version || payload.configVersion) || null;
  } else {
    let result;
    try {
      result = await withTimeout(
        terminalConfigRequestCoordinator.request<Record<string, any>>({
          baseUrl: input.erpBaseUrl,
          terminalId: input.erpTerminalId,
          tenantId: input.tenantId,
          deviceId: input.posDeviceId,
          reason: 'pairing',
          deferPersistence: true,
        }),
        'INITIAL_CONFIG'
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('INITIAL_CONFIG timed out')) {
        // Pairing is an interactive flow. Do not leave the operator blocked behind
        // the coordinator's long background retry schedule.
        terminalConfigRequestCoordinator.cancel(input.erpTerminalId);
        throw new Error(
          `La descarga de configuración inicial no respondió en ${REQUEST_TIMEOUT_MS / 1000} segundos. `
          + 'Verifica la conexión con la Caja Maestra o el ERP y pulsa Reintentar.'
        );
      }
      throw error;
    }

    if (result.status === 'unchanged') {
      const localConfig = await db.get('config') as unknown as BusinessConfig | null;
      const matchingTerminal = localConfig && !Array.isArray(localConfig)
        ? (localConfig.terminals || []).find((terminal) => (
          terminal.id === input.erpTerminalId
          || terminal.config?.erpTerminalId === input.erpTerminalId
          || terminal.config?.erpBinding?.terminalId === input.erpTerminalId
        ))
        : null;
      const cachedSnapshot =
        matchingTerminal?.config?.erpSnapshot
        || localConfig?.terminalSnapshots?.[matchingTerminal?.id || input.erpTerminalId]
        || null;
      if (!localConfig || Array.isArray(localConfig) || !cachedSnapshot) {
        terminalConfigRequestCoordinator.clear(input.erpTerminalId);
        return fetchInitialConfigFromErp(input);
      }
      return {
        success: true,
        tenant_id: input.tenantId,
        terminal_id: matchingTerminal?.id || input.erpTerminalId,
        erp_terminal_id: input.erpTerminalId,
        config: localConfig,
        terminal_config: cachedSnapshot as Record<string, any>,
        config_version: result.configVersion,
        etag: result.etag,
        unchanged: true,
      };
    }

    payload = result.payload || {};
    configVersion = result.configVersion;
    etag = result.etag;
  }

  const payloadBusinessConfig = asObject(payload?.business_config || payload?.businessConfig);
  const payloadOperational = asObject(payload?.operational);
  const terminalConfig: Record<string, any> = {
    ...asObject(payload?.terminal_config),
    ...(Object.keys(payloadBusinessConfig).length > 0 ? { business_config: payloadBusinessConfig } : {}),
    ...(Object.keys(payloadOperational).length > 0 ? { operational: payloadOperational } : {}),
    ...(payload?.vertical_negocio !== undefined ? { vertical_negocio: payload.vertical_negocio } : {}),
    ...(payload?.verticalNegocio !== undefined ? { verticalNegocio: payload.verticalNegocio } : {}),
    ...(payload?.usa_mesas !== undefined ? { usa_mesas: payload.usa_mesas } : {}),
    ...(payload?.usaMesas !== undefined ? { usaMesas: payload.usaMesas } : {}),
    ...(payload?.useTables !== undefined ? { useTables: payload.useTables } : {}),
    ...(payload?.usesTables !== undefined ? { usesTables: payload.usesTables } : {}),
    ...(payload?.fiscalMode !== undefined ? { fiscalMode: payload.fiscalMode } : {}),
    ...(payload?.fiscal_mode !== undefined ? { fiscal_mode: payload.fiscal_mode } : {}),
  };
  const businessRooms = Array.isArray(payloadBusinessConfig.rooms) ? payloadBusinessConfig.rooms : [];
  const businessTables = Array.isArray(payloadBusinessConfig.tables) ? payloadBusinessConfig.tables : [];
  const runtimeAuth = extractRuntimeAuthPayload(payload, terminalConfig);

  return {
    success:
      payload?.success !== false
      && (!asString(payload?.status) || asString(payload?.status).toLowerCase() === 'success'),
    tenant_id: asString(terminalConfig.tenant_id) || input.tenantId,
    terminal_id: asString(terminalConfig.terminal_id) || input.erpTerminalId,
    erp_terminal_id: input.erpTerminalId,
    terminal_config: terminalConfig,
    rooms: Array.isArray(payload?.rooms) ? payload.rooms : businessRooms,
    tables: Array.isArray(payload?.tables) ? payload.tables : businessTables,
    items: Array.isArray(payload?.items)
      ? payload.items
      : (Array.isArray(terminalConfig?.masters?.items) ? terminalConfig.masters.items : []),
    deviceToken: runtimeAuth.deviceToken,
    terminalToken: runtimeAuth.terminalToken,
    activationToken: runtimeAuth.activationToken,
    syncToken: runtimeAuth.syncToken,
    tokenExpiresAt: runtimeAuth.tokenExpiresAt,
    config_version: configVersion,
    etag,
    unchanged: false,
  };
};

export const isTerminalOccupiedError = (error: unknown): error is TerminalOccupiedError => {
  return error instanceof TerminalOccupiedError;
};

export const isSetupDeviceAuthorizationError = (error: unknown): error is SetupDeviceAuthorizationError => {
  return error instanceof SetupDeviceAuthorizationError;
};
