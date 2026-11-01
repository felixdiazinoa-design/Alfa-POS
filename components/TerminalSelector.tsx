import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PUBLIC_ERP_BASE_URL } from '../utils/erpBaseUrl';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  MapPin,
  Monitor,
  RefreshCw,
  Server,
  WifiOff,
} from 'lucide-react';
import { BusinessConfig, Product, TerminalConfig, User as UserType } from '../types';
import { applyTerminalConfigSnapshot, extractTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { buildMasterUrlCandidates, buildMasterUrlFromHost, normalizeMasterHost } from '../utils/cloudMasterRegistry';
import {
  bindTerminalFromErp,
  checkTerminalAuthorizationFromErp,
  fetchInitialConfigFromErp,
  isSetupDeviceAuthorizationError,
  isTerminalOccupiedError,
  listTerminalsFromErp,
  type RuntimeTerminalRecoveryState,
} from '../services/setup/erpTerminalSetup';
import { markSyncDeviceTokenInvalid, persistSyncDeviceToken } from '../services/sync/deviceToken';
import { persistMasterNumberRangesFromSnapshot } from '../services/sync/MasterNumberRangeService';
import {
  extractErpRegisterAuth,
  resolveNormalizedRegisterDeviceToken,
  resolveRegisterErpTerminalId,
  resolveRegisterTerminalCode,
} from '../services/sync/erpRegisterResponse';
import { clearStoredSyncToken, saveTerminalCredentialsSync } from '../services/sync/TerminalCredentialStore';
import { CanonicalErpTerminalIdError, isCanonicalErpTerminalId } from '../services/sync/terminalIdentity';
import type { SyncPermissions, SyncProfile, SyncProfileSource } from '../services/sync/SyncProfile';
import {
  isTerminalAllowedForBinding,
  ORDER_TAKER_TERMINAL_TYPE,
  resolveOrderTakerContract,
  type PosTerminalType,
} from '../utils/orderTakerPolicy';
import { requestJson, type RequestJsonResult } from '../services/network/httpClient';
import {
  buildTerminalBindIdentityPayload,
  formatTerminalBindingLabel,
  formatTerminalBindingStatus,
  groupTerminalBindingRecords,
  isArchivedTerminalBindingRecord,
  isTerminalBindingSelectable,
  normalizeTerminalBindingRecord,
} from '../utils/terminalBindingHierarchy';

interface TerminalCard {
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
}

interface DeviceAuthorizationIssue {
  code: 'DEVICE_NOT_AUTHORIZED' | 'TAKEOVER_REQUIRED' | 'DEVICE_SUPERSEDED' | string;
  message: string;
  httpStatus?: number | null;
  terminal: TerminalCard;
  currentDeviceId?: string | null;
  generatedDeviceId: string;
  pairingStatus: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION' | 'DEVICE_SUPERSEDED' | 'RETRY_READY';
}

interface TerminalSelectorResponse {
  tenant_id: string;
  tenant_name?: string | null;
  erp_base_url?: string | null;
  source?: string | null;
  terminals: Record<string, any>[];
}

interface BindTerminalResponse {
  success: boolean;
  source?: string | null;
  current_device_id?: string | null;
  tenant_id: string;
  terminal_id: string;
  erp_terminal_id?: string | null;
  terminal_code?: string | null;
  terminal_name?: string | null;
  company_id?: string | null;
  store_id?: string | null;
  transferred?: boolean;
  previous_device_id?: string | null;
  recovery_state?: RuntimeTerminalRecoveryState | null;
  config?: BusinessConfig;
  users?: UserType[];
  sync_profile?: Partial<SyncProfile>;
  syncProfile?: Partial<SyncProfile>;
  incomingProfile?: Partial<SyncProfile>;
  incoming_profile?: Partial<SyncProfile>;
  profile?: Partial<SyncProfile>;
  sync_permissions?: SyncPermissions;
  syncPermissions?: SyncPermissions;
  contracted_product?: string;
  contractedProduct?: string;
  cloud_channel?: string;
  cloudChannel?: string;
  data_master?: string;
  dataMaster?: string;
  customer_erp_access?: boolean;
  customerErpAccess?: boolean;
  erp_ui_enabled?: boolean;
  erpUiEnabled?: boolean;
  erp_ready_for_sales?: boolean;
  erpReadyForSales?: boolean;
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
}

interface InitialConfigResponse {
  success: boolean;
  tenant_id?: string;
  terminal_id?: string;
  erp_terminal_id?: string;
  terminal_code?: string;
  config?: BusinessConfig;
  items?: Product[];
  rooms?: any[];
  tables?: any[];
  terminal_config?: Record<string, any>;
  sync_profile?: Partial<SyncProfile>;
  syncProfile?: Partial<SyncProfile>;
  sync_permissions?: SyncPermissions;
  syncPermissions?: SyncPermissions;
  contracted_product?: string;
  contractedProduct?: string;
  cloud_channel?: string;
  cloudChannel?: string;
  data_master?: string;
  dataMaster?: string;
  customer_erp_access?: boolean;
  customerErpAccess?: boolean;
  erp_ui_enabled?: boolean;
  erpUiEnabled?: boolean;
  erp_ready_for_sales?: boolean;
  erpReadyForSales?: boolean;
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
  snapshot_meta?: {
    used_resolved?: boolean;
    used_fallback_config?: boolean;
    used_cached_snapshot?: boolean;
    resolution_error?: unknown;
    full_pull_on_pairing?: boolean;
  };
}

interface BoundTerminalPayload {
  terminalId: string;
  erpTerminalId?: string;
  terminalCode?: string;
  erpBaseUrl?: string;
  terminalName?: string;
  tenantId: string;
  companyId?: string;
  storeId?: string;
  forceTakeover?: boolean;
  previousDeviceId?: string | null;
  recoveryState?: RuntimeTerminalRecoveryState | null;
  config: BusinessConfig;
  users?: UserType[];
  masterIp?: string;
  snapshotItems?: Product[];
  rooms?: any[];
  tables?: any[];
  snapshotMeta?: {
    fullPullOnPairing?: boolean;
    resolutionError?: unknown;
  };
  syncProfile?: Partial<SyncProfile>;
  syncPermissions?: SyncPermissions;
  contractSource?: SyncProfileSource;
  incomingProfile?: Partial<SyncProfile>;
  profile?: Partial<SyncProfile>;
  deviceToken?: string;
  terminalToken?: string;
  activationToken?: string;
  syncToken?: string;
  tokenExpiresAt?: string;
  initialConfigVersion?: string | null;
  initialConfigEtag?: string | null;
  progress?: (update: TerminalBindingProgressUpdate) => void;
}

const normalizeTerminalDedupeValue = (value: unknown): string => (
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '').replace(/[_]+/g, '-')
    : ''
);

const resolveTerminalDedupeKey = (terminal: TerminalCard): string => (
  normalizeTerminalDedupeValue(terminal.erpTerminalId)
  || normalizeTerminalDedupeValue(terminal.id)
);

const dedupeTerminalCards = (
  terminals: TerminalCard[],
  options: { deviceId: string },
): { terminals: TerminalCard[]; duplicatesRemoved: number } => {
  const preferredIds = new Set(
    [
      localStorage.getItem('clic_last_authorized_erp_terminal_id'),
      localStorage.getItem('clic_erp_sync_terminal_id'),
      localStorage.getItem('active_terminal_id'),
      localStorage.getItem('CLIC_POS_TERMINAL_ID'),
    ]
      .map((value) => (value || '').trim())
      .filter(Boolean)
  );
  const byKey = new Map<string, { terminal: TerminalCard; score: number; index: number }>();

  terminals.forEach((terminal, index) => {
    const key = resolveTerminalDedupeKey(terminal) || `terminal-${index}`;
    let score = 0;
    if (preferredIds.has(terminal.erpTerminalId) || preferredIds.has(terminal.id)) score += 5000;
    if (terminal.currentDeviceId && terminal.currentDeviceId === options.deviceId) score += 2500;
    if (terminal.erpTerminalId) score += 300;
    if (terminal.config?.erpTerminalId) score += 300;
    if (terminal.config?.stationNumber) score += 200;
    if (terminal.currentDeviceId) score += 100;
    if (terminal.location && terminal.location !== 'ERP') score += 50;

    const existing = byKey.get(key);
    if (!existing || score > existing.score || (score === existing.score && index > existing.index)) {
      byKey.set(key, { terminal, score, index });
    }
  });

  return {
    terminals: Array.from(byKey.values())
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.terminal),
    duplicatesRemoved: Math.max(0, terminals.length - byKey.size),
  };
};

interface TerminalSelectorProps {
  currentConfig: BusinessConfig;
  deviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
  expectedTerminalType?: PosTerminalType | null;
  integrationMode: 'LOCAL_ONLY' | 'ERP_DIRECT';
  tenantId?: string;
  erpBaseUrl?: string;
  masterIp?: string;
  isAlreadyBound: boolean;
  onBound: (payload: BoundTerminalPayload) => Promise<void>;
  onBack: () => void;
  onMasterIpChange?: (nextIp: string) => void;
}

interface TerminalBindingProgressUpdate {
  stepId?: TerminalBindingProgressStepId;
  message?: string;
}

type TerminalBindingProgressStepId = 'claim' | 'config' | 'apply' | 'sync' | 'cache' | 'finish';

type TerminalBindingProgressStatus = 'pending' | 'active' | 'done' | 'error';

interface TerminalBindingProgressStep {
  id: TerminalBindingProgressStepId;
  label: string;
  detail: string;
  status: TerminalBindingProgressStatus;
}

interface TerminalBindingProgressState {
  isOpen: boolean;
  terminal?: TerminalCard;
  terminalName: string;
  activeStepId: TerminalBindingProgressStepId;
  message: string;
  error: string | null;
  steps: TerminalBindingProgressStep[];
}

const TERMINAL_BINDING_PROGRESS_TEMPLATE: Array<Omit<TerminalBindingProgressStep, 'status'>> = [
  { id: 'claim', label: 'Autorizar device', detail: 'Validando terminal ERP y dispositivo actual' },
  { id: 'config', label: 'Descargar configuración', detail: 'Leyendo snapshot del ERP o master' },
  { id: 'apply', label: 'Aplicar configuración', detail: 'Guardando identidad y permisos locales' },
  { id: 'sync', label: 'Sincronizar maestros', detail: 'Productos, tarifas, clientes, usuarios y series' },
  { id: 'cache', label: 'Actualizar datos locales', detail: 'Rehidratando SQLite y caches del POS' },
  { id: 'finish', label: 'Finalizar', detail: 'Preparando entrada al POS' },
];

const createProgressSteps = (
  activeStepId: TerminalBindingProgressStepId,
  errorStepId?: TerminalBindingProgressStepId
): TerminalBindingProgressStep[] => {
  const activeIndex = TERMINAL_BINDING_PROGRESS_TEMPLATE.findIndex((step) => step.id === activeStepId);
  const errorIndex = errorStepId
    ? TERMINAL_BINDING_PROGRESS_TEMPLATE.findIndex((step) => step.id === errorStepId)
    : -1;

  return TERMINAL_BINDING_PROGRESS_TEMPLATE.map((step, index) => ({
    ...step,
    status: errorIndex === index
      ? 'error'
      : index < activeIndex
        ? 'done'
        : index === activeIndex
          ? 'active'
          : 'pending',
  }));
};

const createInitialProgressState = (): TerminalBindingProgressState => ({
  isOpen: false,
  terminalName: '',
  activeStepId: 'claim',
  message: '',
  error: null,
  steps: createProgressSteps('claim'),
});

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = (value || '').trim();
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
};

const persistErpBaseUrls = (value?: string | null) => {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return;

  localStorage.setItem('CLIC_ERP_BASE_URL', normalized);
  localStorage.setItem('erp_base_url', normalized);
  localStorage.setItem('CLIC_ERP_SYNC_URL', `${normalized}/api/sync`);
};

const compactErrorText = (value: string, maxLength = 220): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
};

const resolveTenantId = (): string | null => {
  const candidates = [
    localStorage.getItem('active_tenant_id'),
    localStorage.getItem('clic_tenant_id'),
    localStorage.getItem('clic_erp_tenant_id'),
  ];

  return candidates
    .map((value) => (value || '').trim())
    .find((value) => Boolean(value) && value !== 'default-tenant') || null;
};

const resolveTenantSlug = (): string | null => {
  return (localStorage.getItem('clic_tenant_slug') || '').trim() || null;
};

const resolveTenantEmail = (): string | null => {
  return (localStorage.getItem('clic_tenant_email') || '').trim().toLowerCase() || null;
};

const resolveAppVersion = (): string | null => (
  (localStorage.getItem('clic_pos_app_version') || localStorage.getItem('apk_version_name') || '').trim() || null
);

const resolveTenantDisplayName = (tenantId?: string | null): string => {
  const name = (localStorage.getItem('clic_tenant_name') || '').trim();
  if (name) return name;

  const slug = resolveTenantSlug();
  if (slug) return slug;

  const email = resolveTenantEmail();
  if (email) return email;

  return (tenantId || '').trim() || 'Tenant no identificado';
};

const pickBoolean = (...values: unknown[]): boolean | undefined => {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
  }
  return undefined;
};

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const looksLikeUuid = (value?: string | null): boolean => UUID_PATTERN.test(String(value || '').trim());

const extractPolicyObject = (...sources: unknown[]): Partial<SyncProfile> => {
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const record = source as Record<string, any>;
    const nested =
      record.incomingProfile
      || record.incoming_profile
      || record.sync_profile
      || record.syncProfile
      || record.profile
      || record.policy
      || record.sync_policy
      || record.syncPolicy;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Partial<SyncProfile>;
    }
  }
  return {};
};

const pickAuthString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.replace(/[\r\n\t]/g, '').trim();
    if (!trimmed || ['undefined', 'null', 'nan', '[object object]'].includes(trimmed.toLowerCase())) continue;
    return trimmed;
  }
  return undefined;
};

const extractRegisterAuthPayload = (...sources: unknown[]) => {
  const records = sources
    .filter((source): source is Record<string, any> => Boolean(source && typeof source === 'object' && !Array.isArray(source)))
    .flatMap((record) => [
      record,
      record.auth,
      record.syncAuth,
      record.terminal_config,
      record.terminal_config?.auth,
      record.terminal_config?.metadata,
      record.terminal_config?.metadata?.syncAuth,
      record.terminal,
      record.terminal?.auth,
      record.terminal?.config,
      record.terminal?.config?.auth,
      record.terminal?.config?.metadata,
      record.terminal?.config?.metadata?.syncAuth,
      record.config,
      record.config?.auth,
      record.config?.security,
      record.config?.runtime,
      record.metadata,
      record.metadata?.auth,
      record.metadata?.syncAuth,
      record.session,
    ])
    .filter((source): source is Record<string, any> => Boolean(source && typeof source === 'object' && !Array.isArray(source)));

  const deviceToken = pickAuthString(...records.flatMap((record) => [
    record.deviceToken,
    record.device_token,
    record.terminalToken,
    record.terminal_token,
    record.activationToken,
    record.activation_token,
    record.auth?.deviceToken,
    record.auth?.device_token,
    record.auth?.terminalToken,
    record.auth?.terminal_token,
    record.auth?.activationToken,
    record.auth?.activation_token,
    record.syncAuth?.deviceToken,
    record.syncAuth?.device_token,
  ]));
  const terminalToken = pickAuthString(...records.flatMap((record) => [
    record.terminalToken,
    record.terminal_token,
    record.auth?.terminalToken,
    record.auth?.terminal_token,
    record.syncAuth?.terminalToken,
    record.syncAuth?.terminal_token,
  ]));
  const activationToken = pickAuthString(...records.flatMap((record) => [
    record.activationToken,
    record.activation_token,
    record.auth?.activationToken,
    record.auth?.activation_token,
    record.syncAuth?.activationToken,
    record.syncAuth?.activation_token,
  ]));
  const syncToken = pickAuthString(...records.flatMap((record) => [
    record.syncToken,
    record.sync_token,
    record.syncAuthToken,
    record.sync_auth_token,
    record.auth?.syncToken,
    record.auth?.sync_token,
    record.auth?.syncAuthToken,
    record.auth?.sync_auth_token,
    record.syncAuth?.syncToken,
    record.syncAuth?.sync_token,
    record.syncAuth?.syncAuthToken,
    record.syncAuth?.sync_auth_token,
  ]));
  const tokenExpiresAt = pickAuthString(...records.flatMap((record) => [
    record.tokenExpiresAt,
    record.token_expires_at,
    record.expiresAt,
    record.expires_at,
  ]));

  return { deviceToken, terminalToken, activationToken, syncToken, tokenExpiresAt };
};

const logRegisterResponseAuth = (auth: ReturnType<typeof extractErpRegisterAuth>) => {
  console.log('[REGISTER_RESPONSE_AUTH]', {
    deviceTokenPresent: Boolean(auth.deviceToken),
    terminalTokenPresent: Boolean(auth.terminalToken),
    activationTokenPresent: Boolean(auth.activationToken),
    syncTokenPresent: Boolean(auth.syncToken),
    tokenExpiresAt: auth.tokenExpiresAt || null,
    responseKeys: Object.keys(auth).filter((key) => Boolean((auth as Record<string, unknown>)[key])),
  });
};

const buildTerminalSyncProfile = (params: {
  bindingMode: 'MASTER' | 'SLAVE';
  expectsErpDirect: boolean;
  erpBaseUrl?: string | null;
  terminalId: string;
  erpTerminalId?: string | null;
  tenantId?: string | null;
  storeId?: string | null;
  data?: BindTerminalResponse | null;
  initialConfigData?: InitialConfigResponse | null;
}): Partial<SyncProfile> => {
  const terminalConfig = params.initialConfigData?.terminal_config || {};
  const candidate = extractPolicyObject(params.data, params.initialConfigData, terminalConfig);
  const syncPermissions =
    params.data?.syncPermissions ||
    params.data?.sync_permissions ||
    params.initialConfigData?.syncPermissions ||
    params.initialConfigData?.sync_permissions ||
    (candidate.syncPermissions as SyncPermissions | undefined);

  const isSlave = params.bindingMode === 'SLAVE';
  const isErpDirect = params.expectsErpDirect && !isSlave;
  const erpReadyForSales = pickBoolean(
    params.data?.erpReadyForSales,
    params.data?.erp_ready_for_sales,
    params.initialConfigData?.erpReadyForSales,
    params.initialConfigData?.erp_ready_for_sales,
    terminalConfig.erpReadyForSales,
    terminalConfig.erp_ready_for_sales,
    (candidate as any).erpReadyForSales,
    syncPermissions?.canPushOperations
  );

  return {
    ...candidate,
    syncPermissions,
    contractedProduct: isErpDirect ? 'POS_ERP' : 'POS_ONLY',
    posRuntime: isSlave ? 'SLAVE' : 'MASTER',
    cloudChannel: isSlave ? 'POS_MASTER' : isErpDirect ? 'ERP_ACTIVE' : 'POS_CLOUD_STAGING',
    dataMaster: isSlave ? 'POS_MASTER' : isErpDirect ? 'ERP' : 'POS',
    cloudSyncEnabled: !isSlave,
    customerErpAccess: isErpDirect ? true : pickBoolean(
      params.data?.customerErpAccess,
      params.data?.customer_erp_access,
      params.initialConfigData?.customerErpAccess,
      params.initialConfigData?.customer_erp_access,
      terminalConfig.customerErpAccess,
      terminalConfig.customer_erp_access,
      (candidate as any).customerErpAccess,
      false
    ) || false,
    erpUiEnabled: isErpDirect ? true : pickBoolean(
      params.data?.erpUiEnabled,
      params.data?.erp_ui_enabled,
      params.initialConfigData?.erpUiEnabled,
      params.initialConfigData?.erp_ui_enabled,
      terminalConfig.erpUiEnabled,
      terminalConfig.erp_ui_enabled,
      (candidate as any).erpUiEnabled,
      false
    ) || false,
    cloudBaseUrl: pickString((candidate as any).cloudBaseUrl, params.erpBaseUrl),
    erpBaseUrl: pickString((candidate as any).erpBaseUrl, params.erpBaseUrl),
    cloudTenantId: pickString((candidate as any).cloudTenantId, params.tenantId),
    erpTenantId: pickString((candidate as any).erpTenantId, params.tenantId),
    localTenantId: pickString((candidate as any).localTenantId, params.tenantId),
    localStoreId: pickString((candidate as any).localStoreId, params.storeId),
    localTerminalId: pickString((candidate as any).localTerminalId, params.terminalId),
    erpTerminalId: pickString((candidate as any).erpTerminalId, params.erpTerminalId, params.terminalId),
    cloudStagingReady: !isErpDirect && !isSlave,
    erpReadyForSales: Boolean(erpReadyForSales),
  };
};

const resolveErpBaseUrl = (): string | null => {
  const current = new URL(window.location.origin);
  const localErpOrigin = `${current.protocol}//${current.hostname}:4001`;

  const candidates = [
    localStorage.getItem('CLIC_ERP_BASE_URL'),
    localStorage.getItem('erp_base_url'),
    localStorage.getItem('CLIC_ERP_SYNC_URL'),
    localStorage.getItem('CLIC_ERP_API_URL'),
    (import.meta as any)?.env?.VITE_ERP_BASE_URL,
    (import.meta as any)?.env?.VITE_ERP_SYNC_API_URL,
    (import.meta as any)?.env?.VITE_SYNC_API_URL,
    DEFAULT_PUBLIC_ERP_BASE_URL,
    localErpOrigin,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
};

const getSetupApiBase = (masterIp?: string): string => {
  const normalized = normalizeMasterHost(masterIp || '');
  if (!normalized) {
    return `${buildMasterUrlFromHost(window.location.hostname)}/api/setup`;
  }
  return `${buildMasterUrlFromHost(normalized)}/api/setup`;
};

const requestMasterSetup = <T,>(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    stage: 'LIST_TERMINALS' | 'BIND_TERMINAL' | 'INITIAL_CONFIG';
  }
): Promise<RequestJsonResult<T>> => {
  const timeoutMs = 12000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const hardTimeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`La Maestra no respondió durante ${options.stage} (${timeoutMs / 1000}s).`));
    }, timeoutMs);
  });
  const request = requestJson<T>({
    url,
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs,
    diagnosticContext: {
      scope: 'MASTER_TERMINAL_SETUP',
      stage: options.stage,
    },
  });

  return Promise.race([request, hardTimeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

const resolveReachableMasterBinding = async (masterIp?: string) => {
  const normalizedHost = normalizeMasterHost(masterIp || '');
  if (!normalizedHost) return null;

  let lastError: Error | null = null;
  for (const baseUrl of buildMasterUrlCandidates(normalizedHost)) {
    try {
      const response = await fetch(`${baseUrl}/api/sync/ping`);
      if (!response.ok) {
        throw new Error(`Ping respondió ${response.status}`);
      }

      return {
        host: new URL(baseUrl).hostname,
        baseUrl,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    console.warn('⚠️ No se pudo resolver un alias alcanzable del Master. Se usará la IP recibida.', lastError);
  }

  return {
    host: normalizedHost,
    baseUrl: buildMasterUrlFromHost(normalizedHost),
  };
};

const buildAndroidEmbeddedSetupBase = (): string =>
  `${buildMasterUrlFromHost(window.location.hostname)}/api/setup`;

const describeTerminalListFailure = (
  err: unknown,
  ctx: { bindingMode: 'MASTER' | 'SLAVE'; erpDirectAndroid: boolean }
): string => {
  const raw = err instanceof Error ? err.message : String(err);
  if (/DEVICE_NOT_AUTHORIZED|TAKEOVER_REQUIRED|DEVICE_SUPERSEDED/i.test(raw)) {
    return 'Esta caja ya está vinculada a otro equipo. Reautoriza este device desde Cloud-Admin y luego presiona Reintentar autorización. No se creará otra terminal.';
  }
  const lower = raw.toLowerCase();
  const isNetwork =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    (err instanceof Error && err.name === 'TypeError');

  if (ctx.erpDirectAndroid && ctx.bindingMode === 'MASTER') {
    if (raw.includes('ERP') || lower.includes('/api/sync')) {
      return `Error al cargar terminales desde el ERP. ${compactErrorText(raw)}`;
    }
    if (isNetwork) {
      return `No hubo respuesta del proxy local (/api/setup) ni del ERP. Revisa la URL del ERP y la conectividad. Detalle: ${compactErrorText(raw)}`;
    }
    return `No se pudieron cargar las terminales. ${raw}`;
  }

  if (ctx.bindingMode === 'SLAVE') {
    if (isNetwork) {
      return 'No se pudo alcanzar la caja maestra en la IP indicada (red, firewall o puerto).';
    }
    return `No se pudieron listar terminales en la maestra local. ${raw}`;
  }

  if (isNetwork) {
    return `Error de red al consultar terminales. Revisa la conexión. Detalle: ${compactErrorText(raw)}`;
  }

  return raw || 'No pudimos cargar las terminales.';
};

const describeTerminalBindFailure = (
  err: unknown,
  ctx: { bindingMode: 'MASTER' | 'SLAVE'; erpDirectAndroid: boolean; forceTransfer: boolean }
): string => {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const isNetwork =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    (err instanceof Error && err.name === 'TypeError');

  if (ctx.forceTransfer && isNetwork) {
    if (ctx.erpDirectAndroid) {
      return `No se pudo completar la autorización contra el ERP directo. Revisa la URL del ERP y la conectividad. Detalle: ${compactErrorText(raw)}`;
    }
    return `No se pudo completar la autorización por un error de red. Revisa la conexión con el ERP o el servidor local del POS. Detalle: ${compactErrorText(raw)}`;
  }

  if (isNetwork) {
    return `Error de red al vincular la terminal. Revisa la conexión. Detalle: ${compactErrorText(raw)}`;
  }

  return raw || 'No se pudo completar la vinculación.';
};

export const TerminalSelector: React.FC<TerminalSelectorProps> = ({
  currentConfig,
  deviceId,
  bindingMode,
  expectedTerminalType,
  integrationMode,
  tenantId: initialTenantId,
  erpBaseUrl: initialErpBaseUrl,
  masterIp = '',
  isAlreadyBound,
  onBound,
  onBack,
  onMasterIpChange,
}) => {
  const [terminals, setTerminals] = useState<TerminalCard[]>([]);
  const [tenantId, setTenantId] = useState(() => {
    const normalizedInitialTenantId = String(initialTenantId || '').trim();
    return (normalizedInitialTenantId && normalizedInitialTenantId !== 'default-tenant')
      ? normalizedInitialTenantId
      : resolveTenantId() || '';
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBinding, setIsBinding] = useState(false);
  const [confirmTerminalId, setConfirmTerminalId] = useState<string | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalCard | null>(null);
  const [authorizationIssue, setAuthorizationIssue] = useState<DeviceAuthorizationIssue | null>(null);
  const [isRetryingAuthorization, setIsRetryingAuthorization] = useState(false);
  const [authorizationPollAttempt, setAuthorizationPollAttempt] = useState(0);
  const [bindingProgress, setBindingProgress] = useState<TerminalBindingProgressState>(() => createInitialProgressState());
  const [masterIpInput, setMasterIpInput] = useState(() => normalizeMasterHost(masterIp));
  const [erpBaseUrl, setErpBaseUrl] = useState<string | null>(() => normalizeBaseUrl(initialErpBaseUrl) || resolveErpBaseUrl());
  const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const expectsErpDirect = bindingMode === 'MASTER' && integrationMode === 'ERP_DIRECT';
  const useErpDirectMasterAndroid = Boolean(isNativeAndroid && erpBaseUrl && bindingMode === 'MASTER' && expectsErpDirect);
  const usesErpDirect = expectsErpDirect && Boolean(erpBaseUrl) && !isNativeAndroid;
  const isSetupPending = localStorage.getItem('clic_pos_terminal_setup_pending') === '1';
  const shouldBlockAlreadyBound = isAlreadyBound && !isSetupPending;

  useEffect(() => {
    const resolvedTenantId = (initialTenantId || '').trim();
    if (resolvedTenantId) {
      setTenantId(resolvedTenantId);
    }
  }, [initialTenantId]);

  useEffect(() => {
    const resolvedBaseUrl = normalizeBaseUrl(initialErpBaseUrl);
    if (resolvedBaseUrl) {
      setErpBaseUrl(resolvedBaseUrl);
    }
  }, [initialErpBaseUrl]);

  useEffect(() => {
    setMasterIpInput(normalizeMasterHost(masterIp));
  }, [masterIp]);

  const apiBase = useMemo(() => {
    const normalizedMasterHost = normalizeMasterHost(masterIpInput);

    if (bindingMode === 'SLAVE' && normalizedMasterHost) {
      return getSetupApiBase(normalizedMasterHost);
    }

    if (isNativeAndroid) {
      return buildAndroidEmbeddedSetupBase();
    }
    return getSetupApiBase(masterIpInput);
  }, [bindingMode, isNativeAndroid, masterIpInput]);

  const startBindingProgress = useCallback((terminal: TerminalCard, message: string) => {
    setBindingProgress({
      isOpen: true,
      terminal,
      terminalName: terminal.name,
      activeStepId: 'claim',
      message,
      error: null,
      steps: createProgressSteps('claim'),
    });
  }, []);

  const updateBindingProgress = useCallback((update: TerminalBindingProgressUpdate) => {
    setBindingProgress((current) => {
      if (!current.isOpen) return current;
      const nextStepId = update.stepId || current.activeStepId;
      return {
        ...current,
        activeStepId: nextStepId,
        message: update.message || current.message,
        error: null,
        steps: createProgressSteps(nextStepId),
      };
    });
  }, []);

  const failBindingProgress = useCallback((message: string) => {
    setBindingProgress((current) => {
      if (!current.isOpen) return current;
      return {
        ...current,
        message: 'No se pudo completar la vinculación.',
        error: message,
        steps: createProgressSteps(current.activeStepId, current.activeStepId),
      };
    });
  }, []);

  const closeBindingProgress = useCallback(() => {
    setBindingProgress(createInitialProgressState());
  }, []);

  const fetchTerminals = useCallback(async () => {
    if (shouldBlockAlreadyBound) {
      setError('Este equipo ya está vinculado a una terminal. No es necesario volver a configurarlo.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const persistListMeta = (data: TerminalSelectorResponse) => {
      const expectedErpTenantId = (localStorage.getItem('clic_erp_tenant_id') || '').trim();
      const receivedTenantId = String(data.tenant_id || '').trim();
      if (expectedErpTenantId && receivedTenantId && expectedErpTenantId !== receivedTenantId) {
        throw new Error('El ERP devolvió un tenant distinto al de la sesión autenticada. Se rechazó la lista de terminales.');
      }

      const rawTerminals = (Array.isArray(data.terminals) ? data.terminals : [])
        .map((terminal) => normalizeTerminalBindingRecord(terminal, {
          deviceId,
          tenantId: data.tenant_id,
        }) as TerminalCard)
        .filter((terminal) => Boolean(terminal.id));
      const masterTerminalIds = new Set(
        (Array.isArray(currentConfig.terminals) ? currentConfig.terminals : [])
          .filter((entry) => entry?.config?.isPrimaryNode)
          .flatMap((entry) => [
            String(entry?.id || '').trim(),
            String(entry?.config?.erpTerminalId || '').trim(),
            String(entry?.config?.erpBinding?.terminalId || '').trim(),
          ])
          .filter(Boolean)
      );
      const visibleRawTerminals = rawTerminals.filter((terminal: any) => {
        const terminalId = String(terminal?.id || terminal?.terminal_id || terminal?.erp_terminal_id || '').trim();
        const terminalName = String(terminal?.name || terminal?.terminalName || terminal?.terminal_name || terminal?.nombre || '').trim();
        const archived = isArchivedTerminalBindingRecord(terminal);

        if (archived) {
          console.info('ghost_terminal_ignored', {
            terminalId,
            terminalName,
            status: terminal?.status || terminal?.binding_status || null,
          });
        }

        return !archived;
      });
      const compatibleTerminals = visibleRawTerminals.filter((terminal) =>
        isTerminalAllowedForBinding(terminal, expectedTerminalType, masterTerminalIds)
      );
      const deduped = dedupeTerminalCards(compatibleTerminals, { deviceId });
      setTerminals(deduped.terminals);
      if (expectedTerminalType === ORDER_TAKER_TERMINAL_TYPE && deduped.terminals.length === 0) {
        setError('La Maestra no devolvió terminales de Toma de pedidos disponibles. Créala primero en el ERP y sincroniza la Maestra.');
      }
      if (deduped.duplicatesRemoved > 0) {
        setError(`El ERP/Cloud-Admin devolvió ${deduped.duplicatesRemoved} terminal duplicada(s). El POS ocultó las fantasma y usará una sola caja operativa.`);
      }
      setTenantId(data.tenant_id || 'default-tenant');
      if (data.tenant_name) {
        localStorage.setItem('clic_tenant_name', data.tenant_name);
      }
      const resolvedBase = normalizeBaseUrl(data.erp_base_url || erpBaseUrl) || erpBaseUrl;
      setErpBaseUrl(resolvedBase);

      if (data.tenant_id) {
        localStorage.setItem('active_tenant_id', data.tenant_id);
      }

      if (resolvedBase) {
        persistErpBaseUrls(resolvedBase);
      }
    };

    try {
      const normalizedInitialTenantId = (initialTenantId || '').trim();
      const resolvedTenantId = normalizedInitialTenantId && normalizedInitialTenantId !== 'default-tenant'
        ? normalizedInitialTenantId
        : resolveTenantId();
      const resolvedTenantSlug = resolveTenantSlug();
      const resolvedTenantEmail = resolveTenantEmail();

      if (expectsErpDirect && !erpBaseUrl) {
        throw new Error('No encontramos la URL base del ERP para esta instalación.');
      }

      const params = new URLSearchParams({
        pos_device_id: deviceId,
      });

      if (resolvedTenantId) params.set('tenant_id', resolvedTenantId);
      if (resolvedTenantSlug) params.set('tenant_slug', resolvedTenantSlug);
      if (resolvedTenantEmail) params.set('tenant_email', resolvedTenantEmail);
      if (erpBaseUrl) params.set('erp_base_url', erpBaseUrl);

      if (useErpDirectMasterAndroid || usesErpDirect) {
        const erpData = await listTerminalsFromErp({
          currentConfig,
          posDeviceId: deviceId,
          tenantId: resolvedTenantId,
          tenantSlug: resolvedTenantSlug,
          tenantEmail: resolvedTenantEmail,
          erpBaseUrl: erpBaseUrl!,
        });

        persistListMeta({
          tenant_id: erpData.tenant_id,
          erp_base_url: erpData.erp_base_url || erpBaseUrl!,
          terminals: erpData.terminals as TerminalCard[],
          source: 'ERP',
        });
      } else {
        const response = await requestMasterSetup<TerminalSelectorResponse>(
          `${apiBase}/terminals?${params.toString()}`,
          { stage: 'LIST_TERMINALS' }
        );
        if (!response.ok) {
          throw new Error(`No se pudieron cargar las terminales (${response.status}).`);
        }

        const data = response.data;
        if (!data) {
          throw new Error('La Maestra devolvió una respuesta vacía al listar terminales.');
        }
        persistListMeta(data);
      }
    } catch (err) {
      console.error('Failed to fetch terminals for setup:', err);
      setError(
        describeTerminalListFailure(err, {
          bindingMode,
          erpDirectAndroid: useErpDirectMasterAndroid,
        })
      );
      setTerminals([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, bindingMode, currentConfig, deviceId, erpBaseUrl, expectedTerminalType, expectsErpDirect, initialTenantId, shouldBlockAlreadyBound, useErpDirectMasterAndroid, usesErpDirect]);

  useEffect(() => {
    void fetchTerminals();
  }, [fetchTerminals]);

  const bindTerminal = useCallback(
    async (terminal: TerminalCard, forceTransfer: boolean) => {
      let completed = false;
      const showProgress = true;
      setIsBinding(true);
      setError(null);
      setShowTransferModal(false);
      setPendingTerminal(null);
      startBindingProgress(
        terminal,
        forceTransfer
          ? `Reasignando ${terminal.name} a este equipo...`
          : `Vinculando ${terminal.name} a este equipo...`
      );

    let keepAuthorizationModalOpen = false;

    try {
      let data: BindTerminalResponse | null = null;

      if (expectsErpDirect && !erpBaseUrl) {
        throw new Error('No encontramos la URL base del ERP para completar la vinculación.');
      }

      if (showProgress) {
        updateBindingProgress({
          stepId: 'claim',
          message: 'Validando la terminal ERP y esperando autorización del device...',
        });
      }

      const deviceName = (
        localStorage.getItem('clic_pos_device_name')
        || localStorage.getItem('device_name')
        || ''
      ).trim() || undefined;
      const bindTerminalRequestBody = {
        ...buildTerminalBindIdentityPayload(terminal, deviceId, deviceName),
        tenant_id: tenantId,
        tenantId,
        cloudAdminTenantId: tenantId || null,
        cloud_admin_tenant_id: tenantId || null,
        tenant_slug: resolveTenantSlug(),
        tenant_email: resolveTenantEmail(),
        erp_base_url: erpBaseUrl,
        erp_terminal_id: terminal.id,
        pos_device_id: deviceId,
        device_id: deviceId,
        app_version: resolveAppVersion(),
        binding_mode: bindingMode,
        terminal_type: resolveOrderTakerContract(terminal).terminalType,
        master_terminal_id: resolveOrderTakerContract(terminal).masterTerminalId,
        capabilities: resolveOrderTakerContract(terminal).capabilities,
        restrictions: resolveOrderTakerContract(terminal).restrictions,
        force_transfer: forceTransfer,
      };
      const pairingDiagnosticBase = {
        selectedTerminalUuid: terminal.id,
        terminalName: terminal.name,
        generatedDeviceId: deviceId,
        tenantId,
        erpBaseUrl,
      };
      console.info('[POS_ERP_PAIRING_UI]', {
        ...pairingDiagnosticBase,
        authResponseCode: 'REQUESTING_BIND',
        pairingStatus: 'BIND_REQUEST_SENT',
        manualCodeEnabled: false,
      });
      localStorage.setItem('clic_last_pairing_diagnostic', JSON.stringify({
        ...pairingDiagnosticBase,
        authResponseCode: 'REQUESTING_BIND',
        pairingStatus: 'BIND_REQUEST_SENT',
        manualCodeEnabled: false,
        at: new Date().toISOString(),
      }));

      if (useErpDirectMasterAndroid) {
        data = await bindTerminalFromErp({
          currentConfig,
          posDeviceId: deviceId,
          terminalId: terminal.id,
          erpTerminalId: terminal.id,
          deviceName,
          bindingMode,
          forceTransfer: false,
          tenantId,
          tenantSlug: resolveTenantSlug(),
          tenantEmail: resolveTenantEmail(),
          erpBaseUrl: erpBaseUrl!,
        });
      } else if (usesErpDirect) {
        data = await bindTerminalFromErp({
          currentConfig,
          posDeviceId: deviceId,
          terminalId: terminal.id,
          erpTerminalId: terminal.id,
          deviceName,
          bindingMode,
          forceTransfer: false,
          tenantId,
          tenantSlug: resolveTenantSlug(),
          tenantEmail: resolveTenantEmail(),
          erpBaseUrl: erpBaseUrl!,
        });
      } else {
        if (forceTransfer) {
          updateBindingProgress({
            stepId: 'claim',
            message: 'Autorizando este equipo y liberando el cliente anterior en la Maestra local...',
          });
        }

        const response = await requestMasterSetup<BindTerminalResponse>(
          `${apiBase}/bind-terminal`,
          {
            method: 'POST',
            body: bindTerminalRequestBody,
            stage: 'BIND_TERMINAL',
          }
        );

        if (response.status === 409) {
          keepAuthorizationModalOpen = true;
          closeBindingProgress();
          const currentDeviceId = response.data?.current_device_id || terminal.currentDeviceId || null;
          const occupiedTerminal = {
            ...terminal,
            currentDeviceId,
            occupied: true,
          };
          setPendingTerminal(occupiedTerminal);
          setAuthorizationIssue({
            code: 'TAKEOVER_REQUIRED',
            message: 'La terminal está ocupada por otro equipo.',
            httpStatus: 409,
            terminal: occupiedTerminal,
            currentDeviceId,
            generatedDeviceId: deviceId,
            pairingStatus: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
          });
          setShowTransferModal(true);
          return;
        }

        if (!response.ok) {
          const detail = response.text;
          if (response.status === 404) {
            throw new Error(
              'La Caja Maestra no incluye el protocolo de autorización cliente actualizado. '
              + 'Instala este mismo APK en la Maestra y en la terminal cliente.'
            );
          }
          throw new Error(detail || `No se pudo vincular la terminal (${response.status}).`);
        }

        data = response.data;
      }

        if (!data) {
          throw new Error('No se pudo vincular la terminal.');
        }

        const pairingRequestErpTerminalId = resolveRegisterErpTerminalId(data);
        if (expectsErpDirect && !pairingRequestErpTerminalId) {
          throw new CanonicalErpTerminalIdError();
        }
        const initialConfigTerminalRef = pairingRequestErpTerminalId || terminal.erpTerminalId || terminal.id;

        if (showProgress) {
          updateBindingProgress({
            stepId: 'config',
            message: 'Device autorizado. Descargando configuración inicial y maestros...',
          });
        }

        const initialConfigParams = new URLSearchParams({
          tenant_id: data.tenant_id || tenantId,
          pos_device_id: deviceId,
          binding_mode: bindingMode,
          local_terminal_id: data.terminal_id || terminal.id,
        });

        if (erpBaseUrl) {
          initialConfigParams.set('erp_base_url', erpBaseUrl);
        }

        let initialConfigData: InitialConfigResponse = {
          success: true,
          tenant_id: data.tenant_id || tenantId,
          terminal_id: data.terminal_id || terminal.id,
          erp_terminal_id: pairingRequestErpTerminalId || undefined,
          config: data.config,
        };

        if (useErpDirectMasterAndroid) {
          const erpTerminalIdForConfig = initialConfigTerminalRef;
          const erpInitialConfigData = await fetchInitialConfigFromErp({
            erpBaseUrl: erpBaseUrl!,
            tenantId: data.tenant_id || tenantId,
            erpTerminalId: erpTerminalIdForConfig,
            posDeviceId: deviceId,
          });

          const snapshot = extractTerminalConfigSnapshot(erpInitialConfigData);
          if (!snapshot) {
            throw new Error('El ERP no devolvió terminal_config en la configuración inicial.');
          }

          if (showProgress) {
            updateBindingProgress({
              stepId: 'apply',
              message: 'Aplicando configuración resuelta para esta terminal...',
            });
          }

          const applied = applyTerminalConfigSnapshot(
            erpInitialConfigData.config || data.config || currentConfig,
            {
              terminalId: data.terminal_id || terminal.id,
              posDeviceId: deviceId,
              bindingMode,
              incomingSnapshot: snapshot,
            }
          );

          initialConfigData = {
            ...erpInitialConfigData,
            tenant_id: erpInitialConfigData.tenant_id || data.tenant_id || tenantId,
            terminal_id: data.terminal_id || terminal.id,
            erp_terminal_id: pairingRequestErpTerminalId || erpInitialConfigData.erp_terminal_id,
            config: applied.config,
            rooms: erpInitialConfigData.rooms || (applied.config as any).rooms || (applied.config as any).initialRooms,
            tables: erpInitialConfigData.tables || (applied.config as any).tables || (applied.config as any).initialTables,
            snapshot_meta: {
              ...(erpInitialConfigData.snapshot_meta || {}),
              used_resolved: applied.usedResolved,
              used_fallback_config: applied.usedFallbackConfig,
              used_cached_snapshot: applied.usedCachedSnapshot,
              resolution_error: snapshot.resolution_error ?? null,
              full_pull_on_pairing: applied.fullPullOnPairing ?? false,
            },
          };
        } else if (usesErpDirect) {
          const erpInitialConfigData = await fetchInitialConfigFromErp({
            erpBaseUrl: erpBaseUrl!,
            tenantId: data.tenant_id || tenantId,
            erpTerminalId: initialConfigTerminalRef,
            posDeviceId: deviceId,
          });

          const snapshot = extractTerminalConfigSnapshot(erpInitialConfigData);
          if (!snapshot) {
            throw new Error('El ERP no devolvió terminal_config en la configuración inicial.');
          }

          if (showProgress) {
            updateBindingProgress({
              stepId: 'apply',
              message: 'Aplicando configuración resuelta para esta terminal...',
            });
          }

          const applied = applyTerminalConfigSnapshot(
            erpInitialConfigData.config || data.config || currentConfig,
            {
              terminalId: data.terminal_id || terminal.id,
              posDeviceId: deviceId,
              bindingMode,
              incomingSnapshot: snapshot,
            }
          );

          initialConfigData = {
            ...erpInitialConfigData,
            tenant_id: erpInitialConfigData.tenant_id || data.tenant_id || tenantId,
            terminal_id: data.terminal_id || terminal.id,
            erp_terminal_id: pairingRequestErpTerminalId || erpInitialConfigData.erp_terminal_id,
            config: applied.config,
            rooms: erpInitialConfigData.rooms || (applied.config as any).rooms || (applied.config as any).initialRooms,
            tables: erpInitialConfigData.tables || (applied.config as any).tables || (applied.config as any).initialTables,
            snapshot_meta: {
              ...(erpInitialConfigData.snapshot_meta || {}),
              used_resolved: applied.usedResolved,
              used_fallback_config: applied.usedFallbackConfig,
              used_cached_snapshot: applied.usedCachedSnapshot,
              resolution_error: snapshot.resolution_error ?? null,
              full_pull_on_pairing: applied.fullPullOnPairing ?? false,
            },
          };
        } else {
          const initialConfigResponse = await requestMasterSetup<InitialConfigResponse>(
            `${apiBase}/initial-config/${encodeURIComponent(initialConfigTerminalRef)}?${initialConfigParams.toString()}`,
            {
              headers: {
                'X-Device-Id': deviceId,
              },
              stage: 'INITIAL_CONFIG',
            }
          );

          if (!initialConfigResponse.ok) {
            const detail = initialConfigResponse.text;
            throw new Error(detail || `No se pudo cargar la configuración inicial (${initialConfigResponse.status}).`);
          }

          if (!initialConfigResponse.data) {
            throw new Error('La Maestra devolvió una configuración inicial vacía.');
          }
          initialConfigData = initialConfigResponse.data;
        }

        if (data.tenant_id) {
          localStorage.setItem('active_tenant_id', data.tenant_id);
        }
        if (erpBaseUrl) {
          persistErpBaseUrls(erpBaseUrl);
        }
        const resolvedMasterHost =
          bindingMode === 'SLAVE'
            ? normalizeMasterHost(masterIpInput) || masterIpInput.trim() || undefined
            : undefined;
        const resolvedErpTerminalId =
          resolveRegisterErpTerminalId(
            data,
            initialConfigData,
            initialConfigData.terminal_config,
            (data as BindTerminalResponse & { auth?: Record<string, unknown> | null }).auth,
          );
        if (expectsErpDirect && !resolvedErpTerminalId) {
          throw new CanonicalErpTerminalIdError();
        }
        const resolvedTerminalCode =
          resolveRegisterTerminalCode(
            data,
            initialConfigData,
            initialConfigData.terminal_config,
            terminal,
            terminal.config,
          )
          || terminal.name
          || data.terminal_name
          || resolvedErpTerminalId
          || terminal.id;
        // A client operates with the local terminal id issued by the Master.
        // The ERP UUID remains an alias for sync/auth, but persisting it as the
        // active local id makes the terminal look unpaired after a restart.
        const resolvedTerminalId = bindingMode === 'SLAVE'
          ? data.terminal_id
            || initialConfigData.terminal_id
            || terminal.id
            || resolvedErpTerminalId
          : resolvedErpTerminalId
            || data.terminal_id
            || initialConfigData.terminal_id
            || terminal.id;
        const syncProfile = {
          ...buildTerminalSyncProfile({
            bindingMode,
            expectsErpDirect,
            erpBaseUrl,
            terminalId: resolvedTerminalCode,
            erpTerminalId: resolvedErpTerminalId,
            tenantId: initialConfigData.tenant_id || data.tenant_id || tenantId,
            storeId: data.store_id || undefined,
            data,
            initialConfigData,
          }),
          ...(data.syncProfile || data.sync_profile || data.incomingProfile || data.incoming_profile || data.profile || {}),
          localTerminalId: resolvedTerminalCode,
          erpTerminalId: resolvedErpTerminalId,
        };
        const syncPermissions =
          data.syncPermissions ||
          data.sync_permissions ||
          initialConfigData.syncPermissions ||
          initialConfigData.sync_permissions ||
          syncProfile.syncPermissions;
        const registerAuth = extractErpRegisterAuth(data, initialConfigData, initialConfigData.terminal_config);
        logRegisterResponseAuth(registerAuth);
        const normalizedDeviceToken = resolveNormalizedRegisterDeviceToken(
          data,
          initialConfigData,
          registerAuth,
        );
        if (normalizedDeviceToken) {
          persistSyncDeviceToken(normalizedDeviceToken, 'ERP_REGISTER', registerAuth.tokenExpiresAt);
        }
        if (registerAuth.syncToken) {
          localStorage.setItem('clic_erp_sync_token', registerAuth.syncToken);
          localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
          if (registerAuth.tokenExpiresAt) {
            localStorage.setItem('clic_erp_sync_token_expires_at', registerAuth.tokenExpiresAt);
          }
        }
        console.info('[POS_ERP_PAIRING_UI]', {
          ...pairingDiagnosticBase,
          authResponseCode: 'OK',
          pairingStatus: 'BOUND',
        });
        localStorage.setItem('clic_last_pairing_diagnostic', JSON.stringify({
          ...pairingDiagnosticBase,
          authResponseCode: 'OK',
          pairingStatus: 'BOUND',
          at: new Date().toISOString(),
        }));
        const canonicalTerminalId = resolvedErpTerminalId || null;
        const selectedContract = resolveOrderTakerContract(terminal);
        localStorage.setItem('clic_pos_terminal_type', selectedContract.terminalType);
        if (selectedContract.masterTerminalId) {
          localStorage.setItem('clic_pos_master_terminal_id', selectedContract.masterTerminalId);
        } else {
          localStorage.removeItem('clic_pos_master_terminal_id');
        }
        console.info('canonical_terminal_selected', {
          terminalId: canonicalTerminalId,
          erpTerminalId: resolvedErpTerminalId || null,
          localTerminalId: resolvedTerminalId || null,
        });
        if (resolvedErpTerminalId && resolvedTerminalId && resolvedErpTerminalId !== resolvedTerminalId) {
          console.info('local_terminal_id_replaced_with_canonical', {
            previousTerminalId: resolvedTerminalId,
            canonicalTerminalId: resolvedErpTerminalId,
          });
        }
        saveTerminalCredentialsSync({
          terminalId: canonicalTerminalId,
          erpTerminalId: canonicalTerminalId,
          terminalCode: resolvedTerminalCode,
          stationNumber: terminal.config?.stationNumber || resolvedTerminalCode,
          terminalName: data.terminal_name || terminal.name || resolvedTerminalCode,
          deviceId,
          tenantId: tenantId || initialTenantId || null,
          erpTenantId: tenantId || initialTenantId || null,
          cloudAdminTenantId: currentConfig?.metadata?.cloudAdminTenantId || currentConfig?.metadata?.tenantId || initialTenantId || null,
          ...(normalizedDeviceToken ? {
            deviceToken: normalizedDeviceToken,
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

        if (showProgress) {
          updateBindingProgress({
            stepId: 'sync',
            message: 'Sincronizando maestros y preparando datos locales del POS...',
          });
        }

        await onBound({
          terminalId: resolvedTerminalId,
          erpTerminalId: resolvedErpTerminalId,
          terminalCode: resolvedTerminalCode,
          // A Cliente/Toma de pedidos authenticates and syncs through its
          // Maestra. Sending a remembered ERP URL incorrectly promotes this
          // local bind to ERP-direct and requires credentials the Master does
          // not issue.
          erpBaseUrl: bindingMode === 'SLAVE' ? undefined : erpBaseUrl || undefined,
          terminalName: data.terminal_name || terminal.name || data.terminal_id || terminal.id,
          tenantId: initialConfigData.tenant_id || data.tenant_id || tenantId,
          companyId: data.company_id || undefined,
          storeId: data.store_id || undefined,
          forceTakeover: forceTransfer || Boolean(data.transferred),
          previousDeviceId: data.previous_device_id || null,
          recoveryState: data.recovery_state || null,
          config: initialConfigData.config || data.config,
          users: data.users,
          masterIp: resolvedMasterHost,
          snapshotItems: Array.isArray(initialConfigData.items)
            ? initialConfigData.items
            : (Array.isArray(initialConfigData.terminal_config?.masters?.items) ? initialConfigData.terminal_config?.masters?.items : undefined),
          rooms: Array.isArray(initialConfigData.rooms) ? initialConfigData.rooms : undefined,
          tables: Array.isArray(initialConfigData.tables) ? initialConfigData.tables : undefined,
          snapshotMeta: {
            fullPullOnPairing: initialConfigData.snapshot_meta?.full_pull_on_pairing,
            resolutionError: initialConfigData.snapshot_meta?.resolution_error,
          },
          syncProfile,
          syncPermissions,
          contractSource: expectsErpDirect ? 'ERP_REGISTER' : 'CLOUD_ADMIN',
          incomingProfile: data.incomingProfile || data.incoming_profile || data.profile || data.syncProfile,
          profile: data.profile || data.syncProfile,
          deviceToken: normalizedDeviceToken,
          terminalToken: registerAuth.terminalToken,
          activationToken: registerAuth.activationToken,
          syncToken: registerAuth.syncToken,
          tokenExpiresAt: registerAuth.tokenExpiresAt,
          initialConfigVersion: initialConfigData.config_version || null,
          initialConfigEtag: initialConfigData.etag || null,
          progress: showProgress ? updateBindingProgress : undefined,
        });
        await persistMasterNumberRangesFromSnapshot(initialConfigData, resolvedErpTerminalId);
        completed = true;
        if (showProgress) {
          updateBindingProgress({
            stepId: 'finish',
            message: 'Terminal transferida correctamente. Abriendo el POS...',
          });
        }
      } catch (err) {
        if (isTerminalOccupiedError(err)) {
          keepAuthorizationModalOpen = true;
          closeBindingProgress();
          const terminalWithDevice = {
            ...terminal,
            currentDeviceId: err.currentDeviceId,
            occupied: true,
          };
          setPendingTerminal(terminalWithDevice);
          setAuthorizationIssue({
            code: 'TAKEOVER_REQUIRED',
            message: 'Pendiente de autorización en Cloud-Admin.',
            httpStatus: 409,
            terminal: terminalWithDevice,
            currentDeviceId: err.currentDeviceId || null,
            generatedDeviceId: deviceId,
            pairingStatus: 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
          });
          setShowTransferModal(true);
          setIsRetryingAuthorization(false);
          return;
        }
        if (isSetupDeviceAuthorizationError(err)) {
          markSyncDeviceTokenInvalid(err.code || 'DEVICE_NOT_AUTHORIZED');
          clearStoredSyncToken();
          saveTerminalCredentialsSync({
            authStatus: 'NEEDS_REAUTH',
            lastAuthError: err.code || 'DEVICE_NOT_AUTHORIZED',
          });
          keepAuthorizationModalOpen = true;
          closeBindingProgress();
          const terminalWithDevice = {
            ...terminal,
            currentDeviceId: err.currentDeviceId || terminal.currentDeviceId,
            occupied: true,
          };
          setPendingTerminal(terminalWithDevice);
          setAuthorizationIssue({
            code: err.code,
            message: err.message,
            httpStatus: err.httpStatus || null,
            terminal: terminalWithDevice,
            currentDeviceId: err.currentDeviceId || terminal.currentDeviceId || null,
            generatedDeviceId: deviceId,
            pairingStatus: err.code === 'DEVICE_SUPERSEDED' ? 'DEVICE_SUPERSEDED' : 'WAITING_CLOUD_ADMIN_REAUTHORIZATION',
          });
          setShowTransferModal(true);
          setIsRetryingAuthorization(false);
          return;
        }
        console.error('Failed to bind terminal during setup:', err);
        const message = describeTerminalBindFailure(err, {
          bindingMode,
          erpDirectAndroid: useErpDirectMasterAndroid,
          forceTransfer,
        });
        setError(message);
        setIsRetryingAuthorization(false);
        if (showProgress) {
          setPendingTerminal(terminal);
          failBindingProgress(message);
        }
      } finally {
        setIsBinding(false);
        if (!keepAuthorizationModalOpen && (!showProgress || completed)) {
          setShowTransferModal(false);
          setPendingTerminal(null);
        }
      }
    },
    [apiBase, bindingMode, closeBindingProgress, currentConfig, deviceId, erpBaseUrl, expectsErpDirect, failBindingProgress, masterIpInput, onBound, startBindingProgress, tenantId, updateBindingProgress, useErpDirectMasterAndroid, usesErpDirect]
  );

  const handleCardClick = useCallback(
    async (terminal: TerminalCard) => {
      if (isBinding || shouldBlockAlreadyBound || !isTerminalBindingSelectable(terminal)) return;

      setConfirmTerminalId(terminal.id);
    },
    [isBinding, shouldBlockAlreadyBound]
  );

  useEffect(() => {
    if (!showTransferModal || !pendingTerminal || !authorizationIssue) return;
    if (!expectsErpDirect || !erpBaseUrl || isBinding || isRetryingAuthorization) return;

    const delayMs = Math.min(5000 * (2 ** authorizationPollAttempt), 60000);
    const timer = window.setTimeout(() => {
      setIsRetryingAuthorization(true);
      void checkTerminalAuthorizationFromErp({
        erpBaseUrl,
        tenantId,
        erpTerminalId: pendingTerminal.erpTerminalId || pendingTerminal.id,
        posDeviceId: deviceId,
      })
        .then(async ({ authorized }) => {
          if (authorized) {
            await bindTerminal(pendingTerminal, false);
            return;
          }
          setAuthorizationPollAttempt((attempt) => attempt + 1);
        })
        .catch((pollError) => {
          if (!isSetupDeviceAuthorizationError(pollError)) {
            console.warn('[POS_ERP_PAIRING] authorization poll failed', {
              endpoint: '/api/sync/bootstrap/check',
              status: (pollError as any)?.httpStatus || null,
              code: (pollError as any)?.code || null,
            });
          }
          setAuthorizationPollAttempt((attempt) => attempt + 1);
        })
        .finally(() => setIsRetryingAuthorization(false));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [authorizationIssue, authorizationPollAttempt, bindTerminal, deviceId, erpBaseUrl, expectsErpDirect, isBinding, isRetryingAuthorization, pendingTerminal, showTransferModal, tenantId]);

  useEffect(() => {
    if (!showTransferModal) setAuthorizationPollAttempt(0);
  }, [showTransferModal]);

  const handleRetry = async () => {
    if (bindingMode === 'SLAVE') {
      onMasterIpChange?.(masterIpInput.trim());
    }
    await fetchTerminals();
  };

  const tenantDisplayName = useMemo(() => resolveTenantDisplayName(tenantId), [tenantId]);
  const terminalGroups = useMemo(() => groupTerminalBindingRecords(terminals), [terminals]);
  const confirmTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === confirmTerminalId) || null,
    [confirmTerminalId, terminals],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="rounded-[1.75rem] border border-white/60 bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">Activar Terminal</p>
            <h3 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Selecciona la caja para este equipo</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
              El equipo quedará vinculado a una terminal operativa del ERP. Si la caja está en otro equipo, Cloud-Admin debe reautorizar este device.
            </p>
          </div>
          <div className="w-full rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-left shadow-inner sm:w-auto sm:max-w-[18rem] sm:text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400">Tenant</p>
            <p className="text-sm font-bold text-blue-700 break-all sm:break-words">{tenantDisplayName}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50/90 p-5 shadow-[0_12px_32px_rgba(245,158,11,0.12)]">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white p-2 text-amber-500 shadow-sm">
              <WifiOff size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-500">Conexión</p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-900">{error}</p>
              {expectsErpDirect && (
                <p className="mt-2 break-all text-xs font-medium text-amber-800">
                  URL ERP usada: <span className="font-mono">{erpBaseUrl || '(sin URL detectada)'}</span>
                </p>
              )}
              {expectsErpDirect && !erpBaseUrl && (
                <p className="mt-1 break-all text-xs font-medium text-amber-700">
                  Base local para proxy (/api/setup): <span className="font-mono">{buildAndroidEmbeddedSetupBase()}</span>
                </p>
              )}
              {bindingMode === 'SLAVE' && (
                <p className="mt-1 break-all text-xs font-medium text-amber-700">
                  URL master (/api/setup): <span className="font-mono">{apiBase}</span>
                </p>
              )}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                {bindingMode === 'SLAVE' && (
                  <div className="flex-1">
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.25em] text-amber-600">
                      IP del Master local
                    </label>
                    <input
                      type="text"
                      value={masterIpInput}
                      onChange={(e) => setMasterIpInput(e.target.value)}
                      placeholder="192.168.1.50"
                      className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                    />
                  </div>
                )}
                <button
                  onClick={handleRetry}
                  disabled={isLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <Server size={16} />}
                  Reintentar Conexión
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {shouldBlockAlreadyBound ? (
        <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50/80 p-8 text-center shadow-[0_16px_48px_rgba(16,185,129,0.12)]">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-white text-emerald-600 shadow-md">
            <CheckCircle2 size={30} />
          </div>
          <h4 className="text-xl font-black text-slate-900">Este equipo ya está vinculado</h4>
          <p className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
            La selección de terminal solo debe mostrarse en equipos nuevos o desvinculados.
          </p>
          <button
            onClick={onBack}
            className="mt-6 rounded-2xl border border-emerald-200 bg-white px-6 py-3 text-sm font-black text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            Volver
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {isLoading && terminals.length === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`terminal-skeleton-${index}`}
                  className="rounded-[2rem] border border-slate-200/70 bg-white/60 p-6 shadow-[0_18px_46px_rgba(15,23,42,0.08)] backdrop-blur-xl"
                >
                  <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200" />
                  <div className="mt-5 h-4 w-40 animate-pulse rounded-full bg-slate-100" />
                  <div className="mt-3 h-3 w-32 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          ) : terminals.length > 0 ? (
            terminalGroups.map((company) => (
              <section key={company.key} className="rounded-[2rem] border border-slate-200/70 bg-white/55 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:p-5">
                <div className="flex items-center gap-3 border-b border-slate-200/80 px-1 pb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/20">
                    <Server size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Empresa</p>
                    <h4 className="truncate text-lg font-black text-slate-900">{company.name}</h4>
                  </div>
                </div>

                <div className="mt-4 space-y-5">
                  {company.stores.map((store) => (
                    <div key={store.key}>
                      <div className="mb-3 flex items-center gap-2 px-1 text-sm font-black text-slate-600">
                        <MapPin size={15} className="text-slate-400" />
                        <span>{store.name}</span>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {store.terminals.map((terminal) => {
                          const selectable = isTerminalBindingSelectable(terminal);
                          const occupied = terminal.occupied;
                          return (
                            <button
                              key={terminal.id}
                              onClick={() => void handleCardClick(terminal)}
                              disabled={isBinding || !selectable}
                              className={`group relative min-h-40 overflow-hidden rounded-[1.75rem] border p-5 text-left shadow-[0_16px_40px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 ${
                                occupied ? 'border-amber-200 bg-white/80' : 'border-white bg-white hover:border-blue-200'
                              }`}
                            >
                              <div className="relative flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${occupied ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-600'}`}>
                                    <Monitor size={22} />
                                  </div>
                                  <div className="min-w-0">
                                    <h5 className="text-lg font-black text-slate-900">{formatTerminalBindingLabel(terminal)}</h5>
                                    <p className="mt-1 break-all font-mono text-[10px] font-bold text-slate-400">{terminal.id}</p>
                                  </div>
                                </div>
                                <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${occupied ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {formatTerminalBindingStatus(terminal)}
                                </span>
                              </div>
                              <div className="relative mt-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                                <span className="text-xs font-bold text-slate-600">{terminal.config?.isPrimaryNode ? 'Servidor principal' : 'Punto de venta'}</span>
                                {occupied ? (
                                  <span className="flex items-center gap-1.5 text-xs font-black text-amber-700">
                                    <Lock size={13} />
                                    {terminal.canReauthorize ? 'Reautorizar' : 'No disponible'}
                                  </span>
                                ) : (
                                  <span className="text-xs font-black text-blue-700">Vincular</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="col-span-full rounded-[2rem] border border-slate-200/70 bg-white/70 p-10 text-center shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-slate-100 text-slate-400">
                <Server size={28} />
              </div>
              <h4 className="text-xl font-black text-slate-900">No hay terminales disponibles</h4>
              <p className="mt-2 text-sm font-medium text-slate-500">
                {expectsErpDirect
                  ? 'No encontramos terminales operativas en el ERP para este tenant.'
                  : bindingMode === 'SLAVE'
                    ? 'La caja maestra no devolvió terminales disponibles para vincular.'
                    : 'No encontramos terminales locales disponibles para esta instalación.'}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          Volver
        </button>
      </div>

      {confirmTerminal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-3 pt-[7dvh] sm:p-4 sm:pt-[8dvh] backdrop-blur-sm">
          <div className="flex w-full max-w-[36rem] flex-col overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-[0_32px_96px_rgba(15,23,42,0.24)] sm:rounded-[2rem]">
            <div className="px-4 py-4 sm:px-6 sm:py-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] bg-blue-50 text-blue-600 shadow-inner sm:h-12 sm:w-12 sm:rounded-[1.25rem]">
                  <Monitor size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-blue-500 sm:text-[11px] sm:tracking-[0.3em]">
                    Confirmar terminal
                  </p>
                  <h4 className="mt-2 text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl md:text-2xl">
                    Vincular {confirmTerminal.name}
                  </h4>
                  <p className="mt-2.5 text-sm font-medium leading-relaxed text-slate-500 sm:text-[15px]">
                    El POS usará la terminal ERP existente y solicitará autorización para este device.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">terminal</span>
                  <span className="text-right text-slate-800">{confirmTerminal.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">ERP UUID</span>
                  <span className="break-all text-right font-mono text-slate-800">{confirmTerminal.erpTerminalId || confirmTerminal.id}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">device_id</span>
                  <span className="break-all text-right font-mono text-slate-800">{deviceId}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setConfirmTerminalId(null)}
                  disabled={isBinding}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const terminal = confirmTerminal;
                    setConfirmTerminalId(null);
                    void bindTerminal(terminal, false);
                  }}
                  disabled={isBinding}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isBinding ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {isBinding ? 'Vinculando...' : 'Vincular terminal'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTransferModal && pendingTerminal && authorizationIssue && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-3 pt-[7dvh] sm:p-4 sm:pt-[8dvh] backdrop-blur-sm">
          <div className="flex w-full max-w-[38rem] flex-col overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-[0_32px_96px_rgba(15,23,42,0.24)] max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] sm:rounded-[2rem]">
            <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] bg-amber-50 text-amber-500 shadow-inner sm:h-12 sm:w-12 sm:rounded-[1.25rem]">
                  <AlertTriangle size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-amber-500 sm:text-[11px] sm:tracking-[0.3em]">
                    Terminal local ocupada
                  </p>
                  <h4 className="mt-2 text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl md:text-2xl">
                    Esta terminal está vinculada a otro equipo
                  </h4>
                  <p className="mt-2.5 text-sm font-medium leading-relaxed text-slate-500 sm:text-[15px]">
                    La Maestra local tiene <span className="font-black text-slate-800">{pendingTerminal.name}</span>{' '}
                    asociada a otro dispositivo cliente.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3.5 text-sm font-medium leading-relaxed text-amber-900 sm:mt-5 sm:px-5">
                <p>No se creará otra terminal ni se cambiará el ERP. Puedes reintentar o reasignar esta terminal local al equipo actual.</p>
                {authorizationIssue.message && (
                  <p className="mt-2 break-words font-mono text-xs">{authorizationIssue.message}</p>
                )}
              </div>

              <div className="mt-4 grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Nombre</span>
                  <span className="text-right text-slate-800">{pendingTerminal.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Código</span>
                  <span className="text-right font-mono text-slate-800">
                    {resolveRegisterTerminalCode(pendingTerminal, pendingTerminal.config) || pendingTerminal.id}
                  </span>
                </div>
                {isCanonicalErpTerminalId(pendingTerminal.erpTerminalId || pendingTerminal.id) && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">UUID ERP</span>
                    <span className="break-all text-right font-mono text-slate-800">
                      {pendingTerminal.erpTerminalId || pendingTerminal.id}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Dispositivo actual</span>
                  <span className="break-all text-right font-mono text-slate-800">{authorizationIssue.generatedDeviceId}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">auth response code</span>
                  <span className="text-right font-mono text-amber-700">{authorizationIssue.code}</span>
                </div>
                <div className="flex justify-between gap-3">
                    <span className="text-slate-400">authorization status</span>
                  <span className="text-right font-mono text-amber-700">{authorizationIssue.pairingStatus}</span>
                </div>
                {authorizationIssue.currentDeviceId && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Dispositivo autorizado anterior</span>
                    <span className="break-all text-right font-mono text-slate-800">{authorizationIssue.currentDeviceId}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-500">
                  Asociación administrada por la Maestra
                </p>
                <p className="mt-2 text-xs font-semibold leading-relaxed text-blue-700">
                  {isRetryingAuthorization
                    ? 'Consultando nuevamente la autorización del dispositivo...'
                    : expectsErpDirect
                      ? 'La autorización debe completarse desde Cloud Admin. El POS solo comprobará el estado y no puede autorizarse por sí mismo.'
                      : 'La reasignación solo cambia qué equipo cliente utiliza esta terminal dentro de la red local.'}
                </p>
              </div>
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-xs font-semibold leading-relaxed text-amber-900">
                {expectsErpDirect
                  ? `Identifique en Cloud Admin el dispositivo solicitante: ${authorizationIssue.generatedDeviceId}. Reintentar solo consulta si la autorización externa ya fue completada.`
                  : 'Autorizar este equipo liberará el cliente anterior. La acción ya está protegida por el PIN administrador de la Maestra.'}
              </div>
            </div>

            <div className="border-t border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => {
                    setShowTransferModal(false);
                    setPendingTerminal(null);
                    setAuthorizationIssue(null);
                    setIsRetryingAuthorization(false);
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setIsRetryingAuthorization(true);
                    void bindTerminal(pendingTerminal, false);
                  }}
                  disabled={isBinding || isRetryingAuthorization}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {(isBinding || isRetryingAuthorization) ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  {(isBinding || isRetryingAuthorization) ? 'Reintentando...' : 'Reintentar conexión'}
                </button>
                {!expectsErpDirect && (
                  <button
                    onClick={() => {
                      setIsRetryingAuthorization(true);
                      void bindTerminal(pendingTerminal, true);
                    }}
                    disabled={isBinding || isRetryingAuthorization}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    <Lock size={16} />
                    {(isBinding || isRetryingAuthorization)
                      ? 'Autorizando...'
                      : 'Autorizar este equipo y liberar el anterior'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {bindingProgress.isOpen && (
        <div className="fixed inset-0 z-[60] flex min-h-[100dvh] items-center justify-center overflow-hidden bg-slate-950/55 p-3 sm:p-4 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-[34rem] overflow-y-auto rounded-[1.5rem] border border-white/70 bg-white shadow-[0_32px_96px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
            <div className="px-5 py-5 sm:px-7 sm:py-7">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] shadow-inner ${
                  bindingProgress.error ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                }`}>
                  {bindingProgress.error ? (
                    <AlertTriangle size={24} />
                  ) : (
                    <RefreshCw size={24} className="animate-spin" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-black uppercase tracking-[0.3em] ${
                    bindingProgress.error ? 'text-red-500' : 'text-blue-500'
                  }`}>
                    {bindingProgress.error ? 'Traspaso detenido' : 'Transferencia en progreso'}
                  </p>
                  <h4 className="mt-2 text-xl font-black tracking-tight text-slate-900">
                    {bindingProgress.terminalName || 'Terminal'}
                  </h4>
                  <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">
                    {bindingProgress.message || 'Preparando el equipo...'}
                  </p>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    bindingProgress.error ? 'bg-red-500' : 'bg-blue-600'
                  }`}
                  style={{
                    width: `${Math.max(
                      12,
                      ((TERMINAL_BINDING_PROGRESS_TEMPLATE.findIndex((step) => step.id === bindingProgress.activeStepId) + 1)
                        / TERMINAL_BINDING_PROGRESS_TEMPLATE.length) * 100
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-6 space-y-3">
                {bindingProgress.steps.map((step) => (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
                      step.status === 'error'
                        ? 'border-red-100 bg-red-50'
                        : step.status === 'active'
                          ? 'border-blue-100 bg-blue-50'
                          : step.status === 'done'
                            ? 'border-emerald-100 bg-emerald-50'
                            : 'border-slate-100 bg-slate-50'
                    }`}
                  >
                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      step.status === 'error'
                        ? 'bg-red-100 text-red-600'
                        : step.status === 'active'
                          ? 'bg-blue-100 text-blue-600'
                          : step.status === 'done'
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-white text-slate-300'
                    }`}>
                      {step.status === 'done' ? (
                        <CheckCircle2 size={15} />
                      ) : step.status === 'active' ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : step.status === 'error' ? (
                        <AlertTriangle size={14} />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-current" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-black ${
                        step.status === 'error'
                          ? 'text-red-700'
                          : step.status === 'active'
                            ? 'text-blue-800'
                            : step.status === 'done'
                              ? 'text-emerald-800'
                              : 'text-slate-500'
                      }`}>
                        {step.label}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold leading-relaxed text-slate-500">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              {bindingProgress.error && (
                <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold leading-relaxed text-red-700">
                  {bindingProgress.error}
                </div>
              )}
            </div>

            {bindingProgress.error && (
              <div className="border-t border-slate-100 px-5 py-4 sm:px-7">
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeBindingProgress}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
                  >
                    Cerrar
                  </button>
                  {bindingProgress.terminal && (
                    <button
                      type="button"
                      onClick={() => void bindTerminal(bindingProgress.terminal!, false)}
                      disabled={isBinding}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {isBinding ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Reintentar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalSelector;
