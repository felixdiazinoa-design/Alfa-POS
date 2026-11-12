import express from 'express';
import { getCollection, getSetting, saveSetting } from '../db';
import { applyTerminalConfigSnapshot, extractTerminalConfigSnapshot } from '../../utils/terminalConfigSnapshot';
import { TerminalConfigSnapshot } from '../../types';
import { persistOperationalDocumentState } from '../services/terminalOperationalState';
import { isArchivedTerminalBindingRecord } from '../../utils/terminalBindingHierarchy';

const router = express.Router();

const REQUEST_TIMEOUT_MS = 12000;

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
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

const stripApiSuffix = (value: string): string => {
  return value
    .replace(/\/api\/sync\/?$/i, '')
    .replace(/\/api\/?$/i, '');
};

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = asString(value);
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return stripTrailingSlashes(stripApiSuffix(url.toString()));
  } catch {
    return null;
  }
};

const resolveStoredErpContext = (): Record<string, any> => {
  return asObject(getSetting('erp_setup_context'));
};

const getSnapshotCache = (): Record<string, TerminalConfigSnapshot> => {
  return asObject(getSetting('terminal_snapshot_cache')) as Record<string, TerminalConfigSnapshot>;
};

const getCachedTerminalSnapshot = (terminalId: string): TerminalConfigSnapshot | null => {
  const cache = getSnapshotCache();
  const snapshot = asObject(cache[terminalId]);
  return Object.keys(snapshot).length > 0 ? (snapshot as TerminalConfigSnapshot) : null;
};

const saveCachedTerminalSnapshot = (terminalId: string, snapshot: TerminalConfigSnapshot | null | undefined) => {
  if (!snapshot) return;
  const resolved = asObject(snapshot.resolved);
  if (Object.keys(resolved).length === 0) return;

  const cache = getSnapshotCache();
  cache[terminalId] = snapshot;
  saveSetting('terminal_snapshot_cache', cache);
};

const resolveTenantId = (req: express.Request): string | null => {
  const body = asObject(req.body);
  const queryTenantId = asString(req.query.tenant_id);
  const bodyTenantId = asString(body.tenant_id);
  const headerTenantId = asString(req.headers['x-tenant-id']);
  const storedTenantId =
    asString(resolveStoredErpContext().tenantId) ||
    asString(getSetting('active_tenant_id')) ||
    asString(getSetting('tenant_id'));

  return queryTenantId || bodyTenantId || headerTenantId || storedTenantId || null;
};

const resolveTenantSlug = (req: express.Request): string | null => {
  const body = asObject(req.body);
  const querySlug = asString(req.query.tenant_slug);
  const bodySlug = asString(body.tenant_slug);
  const headerSlug = asString(req.headers['x-tenant-slug']);
  const storedSlug = asString(resolveStoredErpContext().tenantSlug);

  return querySlug || bodySlug || headerSlug || storedSlug || null;
};

const resolveTenantEmail = (req: express.Request): string | null => {
  const body = asObject(req.body);
  const queryEmail = asString(req.query.tenant_email).toLowerCase();
  const bodyEmail = asString(body.tenant_email).toLowerCase();
  const headerEmail = asString(req.headers['x-tenant-email']).toLowerCase();
  const storedEmail = asString(resolveStoredErpContext().tenantEmail).toLowerCase();

  return queryEmail || bodyEmail || headerEmail || storedEmail || null;
};

const resolveErpBaseUrl = (req: express.Request): string | null => {
  const body = asObject(req.body);
  const queryBase = normalizeBaseUrl(asString(req.query.erp_base_url));
  const bodyBase = normalizeBaseUrl(asString(body.erp_base_url));
  const storedContextBase = normalizeBaseUrl(asString(resolveStoredErpContext().erpBaseUrl));
  const syncMetadata = asObject(getSetting('syncMetadata'));
  const storedMetadataBase =
    normalizeBaseUrl(asString(syncMetadata.erpBaseUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.syncApiUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.masterSyncUrl));

  return queryBase || bodyBase || storedContextBase || storedMetadataBase || null;
};

const buildErpHeaders = (req: express.Request, tenantId: string | null, includeJson = false): HeadersInit => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (includeJson) headers['Content-Type'] = 'application/json';

  const authorization = asString(req.headers.authorization);
  const cookie = asString(req.headers.cookie);
  const deviceId =
    asString(req.headers['x-device-id']) ||
    asString(req.query.pos_device_id) ||
    asString(asObject(req.body).pos_device_id) ||
    asString(asObject(req.body).device_id);

  const serviceToken =
    asString(process.env.ERP_TAKEOVER_SERVICE_TOKEN) ||
    asString(process.env.ERP_SERVICE_TOKEN) ||
    asString(process.env.CLOUD_ADMIN_ERP_SERVICE_TOKEN) ||
    asString(process.env.INTEGRATION_SECRET_KEY);

  if (authorization) headers.Authorization = authorization;
  else if (serviceToken) headers.Authorization = `Bearer ${serviceToken}`;
  if (cookie) headers.Cookie = cookie;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  if (deviceId) headers['X-Device-Id'] = deviceId;

  return headers;
};

const fetchErpJson = async (
  req: express.Request,
  baseUrl: string,
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    tenantId?: string | null;
    body?: Record<string, any>;
  }
) => {
  const url = `${stripTrailingSlashes(baseUrl)}${path}`;
  const response = await withTimeout(
    fetch(url, {
      method: options?.method || 'GET',
      headers: buildErpHeaders(req, options?.tenantId || null, Boolean(options?.body)),
      body: options?.body ? JSON.stringify(options.body) : undefined,
    }),
    `ERP request ${path}`
  );

  const text = await response.text();
  let payload: any = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      asString(asObject(payload).message) ||
      asString(asObject(payload).error) ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(`ERP ${path}: ${message}`);
  }

  return payload;
};

const isDeviceAlreadyLocallyBound = (config: any, deviceId: string): boolean => {
  if (!deviceId) return false;
  return Array.isArray(config?.terminals)
    && config.terminals.some((terminal: any) => asString(terminal?.config?.currentDeviceId) === deviceId);
};

const hasLocalTerminalCatalog = (config: any): boolean =>
  Array.isArray(config?.terminals) && config.terminals.length > 0;

const buildLocalFallback = (config: any, deviceId: string, tenantId: string | null, erpBaseUrl: string | null) => {
  const terminals = Array.isArray(config?.terminals) ? config.terminals : [];
  return {
    tenant_id: tenantId || 'default-tenant',
    erp_base_url: erpBaseUrl,
    source: 'LOCAL_BOUND_FALLBACK',
    terminals: terminals.map((terminal: any) => {
      const terminalConfig = asObject(terminal?.config);
      const currentDeviceId = asString(terminalConfig.currentDeviceId) || undefined;
      return {
        id: asString(terminal?.id),
        name: asString(terminal?.id).toUpperCase(),
        location: 'Configuración local',
        occupied: Boolean(currentDeviceId && currentDeviceId !== deviceId),
        currentDeviceId,
        config: terminalConfig,
      };
    }),
  };
};

const buildLocalBoundConfig = (input: {
  currentConfig: any;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
}) => {
  const { currentConfig, selectedTerminalId, posDeviceId, bindingMode } = input;
  const now = new Date().toISOString();

  return {
    ...cloneDeep(currentConfig),
    terminals: (Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : []).map((terminal: any) => {
      const terminalId = asString(terminal?.id);
      const nextConfig = cloneDeep(asObject(terminal?.config));
      const deviceBindingToken = asString(nextConfig.deviceBindingToken) || `token-${terminalId}`;
      const currentDeviceId = asString(nextConfig.currentDeviceId);

      nextConfig.deviceBindingToken = deviceBindingToken;
      nextConfig.security = {
        ...asObject(nextConfig.security),
        deviceBindingToken,
      };
      nextConfig.currentDeviceId =
        terminalId === selectedTerminalId
          ? posDeviceId
          : currentDeviceId === posDeviceId
            ? undefined
            : currentDeviceId || undefined;
      nextConfig.lastPairingDate = terminalId === selectedTerminalId ? now : nextConfig.lastPairingDate;
      nextConfig.isPrimaryNode = terminalId === selectedTerminalId ? bindingMode === 'MASTER' : Boolean(nextConfig.isPrimaryNode);
      nextConfig.governedByMaster = terminalId === selectedTerminalId ? bindingMode === 'SLAVE' : Boolean(nextConfig.governedByMaster);
      nextConfig.syncConfig = {
        ...asObject(nextConfig.syncConfig),
        mode: terminalId === selectedTerminalId ? bindingMode : asString(nextConfig?.syncConfig?.mode) || 'MASTER',
        isEnabled: true,
      };

      return {
        ...cloneDeep(terminal),
        config: nextConfig,
      };
    }),
  };
};

const resolveLocalBinding = (input: {
  currentConfig: any;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
  forceTransfer: boolean;
  tenantId: string | null;
  users: any[];
}) => {
  const {
    currentConfig,
    selectedTerminalId,
    posDeviceId,
    bindingMode,
    forceTransfer,
    tenantId,
    users,
  } = input;

  const terminals = Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : [];
  const targetTerminal = terminals.find((terminal: any) => asString(terminal?.id) === selectedTerminalId);

  if (!targetTerminal) {
    return {
      ok: false as const,
      statusCode: 404,
      payload: {
        status: 'error',
        message: 'La terminal no existe en la configuración local de POS.',
      },
    };
  }

  const occupiedDeviceId = asString(targetTerminal?.config?.currentDeviceId);
  if (occupiedDeviceId && occupiedDeviceId !== posDeviceId && !forceTransfer) {
    return {
      ok: false as const,
      statusCode: 409,
      payload: {
        status: 'error',
        code: 'TERMINAL_OCCUPIED',
        message: 'La terminal ya está ocupada por otro equipo.',
        current_device_id: occupiedDeviceId,
      },
    };
  }

  const nextConfig = buildLocalBoundConfig({
    currentConfig,
    selectedTerminalId,
    posDeviceId,
    bindingMode,
  });

  saveSetting('config', nextConfig);

  return {
    ok: true as const,
    statusCode: 200,
    payload: {
      success: true,
      tenant_id: tenantId || 'default-tenant',
      terminal_id: selectedTerminalId,
      source: 'LOCAL',
      transferred: Boolean(occupiedDeviceId && occupiedDeviceId !== posDeviceId),
      current_device_id: posDeviceId,
      previous_device_id: occupiedDeviceId && occupiedDeviceId !== posDeviceId ? occupiedDeviceId : null,
      config: nextConfig,
      users,
    },
  };
};

const fetchErpOverview = async (req: express.Request, baseUrl: string, tenantId: string) => {
  const overview = await fetchErpJson(
    req,
    baseUrl,
    `/api/settings/overview?tenant_id=${encodeURIComponent(tenantId)}`,
    { tenantId }
  );

  const branches = Array.isArray(overview?.branches) ? overview.branches : [];
  const terminals = Array.isArray(overview?.terminals) ? overview.terminals : [];

  return {
    tenantId: asString(overview?.tenant?.id) || tenantId,
    tenantName: asString(overview?.tenant?.name),
    branches,
    terminals,
  };
};

const fetchErpTerminals = async (
  req: express.Request,
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
    req,
    baseUrl,
    `/api/sync/terminals${params.toString() ? `?${params.toString()}` : ''}`,
    { tenantId: filters.tenantId || null }
  );

  return Array.isArray(payload?.terminals) ? payload.terminals : [];
};

const fetchErpTenants = async (req: express.Request, baseUrl: string) => {
  const payload = await fetchErpJson(req, baseUrl, '/api/sync/tenants');
  return Array.isArray(payload?.tenants) ? payload.tenants : [];
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
  req: express.Request,
  baseUrl: string,
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
  }
) => {
  const tenants = await fetchErpTenants(req, baseUrl);
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

const resolveErpTerminalContext = async (
  req: express.Request,
  baseUrl: string,
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
    deviceId?: string | null;
  }
) => {
  const candidates: Array<{
    tenantId: string | null;
    tenantName: string | null;
    companyId: string | null;
    storeId: string | null;
    source: string;
  }> = [];
  let lastBootstrapError: Error | null = null;

  try {
    const bootstrap = await bootstrapErpTenant(req, baseUrl, identity);
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

  try {
    const mappedTenant = await resolveTenantDirectoryContext(req, baseUrl, identity);
    if (mappedTenant && !candidates.some((candidate) => candidate.tenantId === mappedTenant.tenantId)) {
      candidates.push(mappedTenant);
    }
  } catch (error) {
    console.warn('⚠️ ERP tenant directory lookup failed:', error);
  }

  let fallbackContext: any = null;

  for (const candidate of candidates) {
    const terminals = await fetchErpTerminals(req, baseUrl, {
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

const fetchTerminalProfile = async (req: express.Request, baseUrl: string, tenantId: string, terminalId: string) => {
  return fetchErpJson(
    req,
    baseUrl,
    `/api/sync/bootstrap/terminal-profile?tenant_id=${encodeURIComponent(tenantId)}&terminal_id=${encodeURIComponent(terminalId)}`,
    { tenantId }
  );
};

const fetchInitialConfigSnapshot = async (req: express.Request, baseUrl: string, tenantId: string, terminalId: string) => {
  return fetchErpJson(
    req,
    baseUrl,
    `/api/sync/terminals/${encodeURIComponent(terminalId)}/config`,
    { tenantId }
  );
};

const bootstrapErpTenantOnce = async (
  req: express.Request,
  baseUrl: string,
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
    deviceId?: string | null;
  }
) => {
  return fetchErpJson(req, baseUrl, '/api/sync/bootstrap/check', {
    method: 'POST',
    tenantId: identity.tenantId || null,
    body: {
      tenant_id: identity.tenantId || null,
      company_ref: identity.tenantSlug || null,
      email: identity.tenantEmail || null,
      device_id: identity.deviceId || null,
    },
  });
};

const bootstrapErpTenant = async (
  req: express.Request,
  baseUrl: string,
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
    deviceId?: string | null;
  }
) => {
  const attempts = [
    {
      tenantId: identity.tenantId || null,
      tenantSlug: identity.tenantSlug || null,
      tenantEmail: identity.tenantEmail || null,
      deviceId: identity.deviceId || null,
    },
    {
      tenantId: null,
      tenantSlug: identity.tenantSlug || null,
      tenantEmail: identity.tenantEmail || null,
      deviceId: identity.deviceId || null,
    },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    if (!attempt.tenantId && !attempt.tenantSlug && !attempt.tenantEmail && !attempt.deviceId) {
      continue;
    }

    try {
      return await bootstrapErpTenantOnce(req, baseUrl, attempt);
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('No se pudo resolver un tenant operativo del ERP.');
};

const fetchTerminalProfileSafe = async (
  req: express.Request,
  baseUrl: string,
  tenantId: string,
  terminalId: string
) => {
  try {
    return await fetchTerminalProfile(req, baseUrl, tenantId, terminalId);
  } catch (error) {
    console.warn(`⚠️ Terminal profile fallback for ${terminalId}:`, error);
    return { profile: {} };
  }
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

const resolveTargetErpTerminal = (
  erpTerminals: any[],
  terminalId: string,
  erpTerminalId?: string | null
) => {
  const normalizedTerminalId = asString(terminalId);
  const normalizedErpTerminalId = asString(erpTerminalId);

  return erpTerminals.find((terminal: any) => {
    const id = asString(terminal.id);
    const operationalId = resolveOperationalTerminalId(terminal) || id;
    return (
      (normalizedErpTerminalId && id === normalizedErpTerminalId)
      || id === normalizedTerminalId
      || operationalId === normalizedTerminalId
    );
  });
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

const createTerminalTemplate = (currentConfig: any, terminalId: string) => {
  const terminals = Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : [];
  const existing = terminals.find((terminal: any) => asString(terminal?.id) === terminalId);
  const template = existing?.config || terminals[0]?.config;
  if (!template) {
    throw new Error('No hay configuración base de terminal disponible en POS para materializar la terminal del ERP.');
  }

  const nextTemplate = cloneDeep(template);
  const deviceBindingToken = asString(nextTemplate.deviceBindingToken) || `token-${terminalId}`;

  nextTemplate.deviceBindingToken = deviceBindingToken;
  nextTemplate.security = {
    ...asObject(nextTemplate.security),
    deviceBindingToken,
  };

  return nextTemplate;
};

const buildBoundConfig = (input: {
  currentConfig: any;
  overview: { branches: any[]; terminals: any[] };
  profilesByTerminalId: Map<string, any>;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
}) => {
  const { currentConfig, overview, profilesByTerminalId, selectedTerminalId, posDeviceId, bindingMode } = input;
  const now = new Date().toISOString();
  const nextTerminals = overview.terminals.map((terminal: any) => {
    const terminalId = asString(terminal.id);
    const existingTerminal = Array.isArray(currentConfig?.terminals)
      ? currentConfig.terminals.find((item: any) => asString(item?.id) === terminalId)
      : null;

    const baseConfig = createTerminalTemplate(currentConfig, terminalId);
    const occupiedDeviceId = resolveOccupiedDeviceId(terminal, profilesByTerminalId.get(terminalId));
    const nextCurrentDeviceId =
      terminalId === selectedTerminalId
        ? posDeviceId
        : occupiedDeviceId === posDeviceId
          ? undefined
          : occupiedDeviceId;

    const nextConfig = {
      ...baseConfig,
      currentDeviceId: nextCurrentDeviceId || undefined,
      lastPairingDate: terminalId === selectedTerminalId ? now : existingTerminal?.config?.lastPairingDate,
      isPrimaryNode: terminalId === selectedTerminalId ? bindingMode === 'MASTER' : Boolean(baseConfig.isPrimaryNode),
      governedByMaster: terminalId === selectedTerminalId ? bindingMode === 'SLAVE' : Boolean(baseConfig.governedByMaster),
      syncConfig: {
        ...asObject(baseConfig.syncConfig),
        mode: terminalId === selectedTerminalId ? bindingMode : asString(baseConfig?.syncConfig?.mode) || 'MASTER',
        isEnabled: true,
      },
    };

    return {
      id: terminalId,
      config: nextConfig,
    };
  });

  return {
    ...cloneDeep(currentConfig),
    terminals: nextTerminals,
  };
};

const materializeTerminalConfigFromSnapshot = (input: {
  currentConfig: any;
  terminalId: string;
  posDeviceId?: string;
  bindingMode?: 'MASTER' | 'SLAVE';
  snapshot: TerminalConfigSnapshot | null;
}) => {
  const cachedSnapshot = getCachedTerminalSnapshot(input.terminalId);
  const applied = applyTerminalConfigSnapshot(input.currentConfig, {
    terminalId: input.terminalId,
    posDeviceId: input.posDeviceId,
    bindingMode: input.bindingMode,
    incomingSnapshot: input.snapshot,
    cachedSnapshot,
  });

  if (applied.snapshot && !applied.hasResolutionError && Object.keys(asObject(applied.snapshot.resolved)).length > 0) {
    saveCachedTerminalSnapshot(applied.terminalId, applied.snapshot);
  }

  return applied;
};

router.get('/terminals', async (req, res) => {
  const config = getSetting('config');
  const tenantId = resolveTenantId(req);
  const tenantSlug = resolveTenantSlug(req);
  const tenantEmail = resolveTenantEmail(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const posDeviceId = asString(req.query.pos_device_id);

  try {
    if (erpBaseUrl && (tenantId || tenantSlug || tenantEmail)) {
      const resolvedContext = await resolveErpTerminalContext(req, erpBaseUrl, {
        tenantId,
        tenantSlug,
        tenantEmail,
        deviceId: posDeviceId,
      });
      const resolvedErpTenantId = resolvedContext.tenantId;
      const resolvedCompanyId = resolvedContext.companyId;
      const resolvedStoreId = resolvedContext.storeId;

      if (!resolvedErpTenantId) {
        throw new Error('No se pudo resolver un tenant operativo del ERP para esta activación.');
      }

      const erpTerminals = Array.isArray(resolvedContext.terminals) ? resolvedContext.terminals : [];

      const terminals = erpTerminals
        .filter((terminal: any) => !isArchivedTerminalBindingRecord(terminal))
        .map((terminal: any) => {
        const erpTerminalId = asString(terminal.id);
        const terminalCode = resolveOperationalTerminalId(terminal) || erpTerminalId;
        const terminalName = asString(terminal.terminal_name) || asString(terminal.nombre) || asString(terminal.name) || `Caja ${terminalCode}`;
        const location =
          asString(terminal.store_name) ||
          asString(terminal.sucursal) ||
          asString(terminal.company_name) ||
          'ERP';
        const currentDeviceId = asString(terminal.device_id) || undefined;
        const occupied = Boolean(currentDeviceId && currentDeviceId !== posDeviceId);

        return {
          id: erpTerminalId,
          tenant_id: asString(terminal.tenant_id) || resolvedErpTenantId,
          company_id: asString(terminal.company_id) || null,
          company_name: asString(terminal.company_name) || 'Empresa sin identificar',
          store_id: asString(terminal.store_id) || null,
          store_name: asString(terminal.store_name) || asString(terminal.sucursal) || 'Sucursal sin identificar',
          terminal_name: terminalName,
          terminal_code: asString(terminal.terminal_code) || terminalCode || null,
          binding_status: (asString(terminal.binding_status) || (occupied ? 'OCCUPIED' : 'AVAILABLE')).toUpperCase(),
          is_occupied: occupied,
          can_reauthorize: typeof terminal.can_reauthorize === 'boolean'
            ? terminal.can_reauthorize
            : occupied,
          erpTerminalId,
          name: terminalName,
          location,
          occupied,
          currentDeviceId: currentDeviceId || undefined,
          config:
            Array.isArray(config?.terminals) && config.terminals.length > 0
              ? createTerminalTemplate(config, terminalCode)
              : {},
        };
      });

      saveSetting('erp_setup_context', {
        tenantId: resolvedErpTenantId,
        tenantName: resolvedContext.tenantName,
        tenantSlug,
        tenantEmail,
        erpBaseUrl,
        companyId: resolvedCompanyId,
        storeId: resolvedStoreId,
        lastResolvedAt: new Date().toISOString(),
      });

      return res.json({
        tenant_id: resolvedErpTenantId,
        tenant_name: resolvedContext.tenantName,
        erp_base_url: erpBaseUrl,
        source: 'ERP',
        terminals,
      });
    }

    if (config && (hasLocalTerminalCatalog(config) || isDeviceAlreadyLocallyBound(config, posDeviceId))) {
      return res.json(buildLocalFallback(config, posDeviceId, tenantId, erpBaseUrl));
    }

    return res.status(503).json({
      status: 'error',
      message: 'No se pudo resolver el catálogo de terminales desde ERP. Verifica tenant y base del ERP antes de continuar.',
    });
  } catch (error: any) {
    console.error('❌ Setup terminals error:', error?.message || error);

    if (config && (hasLocalTerminalCatalog(config) || isDeviceAlreadyLocallyBound(config, posDeviceId))) {
      return res.json(buildLocalFallback(config, posDeviceId, tenantId, erpBaseUrl));
    }

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudieron cargar las terminales del ERP.',
    });
  }
});

router.post('/bind-terminal', async (req, res) => {
  const config = getSetting('config');
  const users = getCollection('users');
  const body = asObject(req.body);
  const tenantId = resolveTenantId(req);
  const tenantSlug = resolveTenantSlug(req);
  const tenantEmail = resolveTenantEmail(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const terminalId = asString(body.terminal_id);
  const erpTerminalIdFromBody = asString(body.erp_terminal_id);
  const posDeviceId = asString(body.new_device_id) || asString(body.pos_device_id) || asString(body.device_id);
  const deviceName = asString(body.device_name);
  const bindingMode = asString(body.binding_mode).toUpperCase() === 'SLAVE' ? 'SLAVE' : 'MASTER';
  const forceTransfer = Boolean(body.force_transfer);

  if ((!tenantId || !erpBaseUrl) && hasLocalTerminalCatalog(config)) {
    const localBinding = resolveLocalBinding({
      currentConfig: config,
      selectedTerminalId: terminalId,
      posDeviceId,
      bindingMode,
      forceTransfer,
      tenantId,
      users,
    });

    return res.status(localBinding.statusCode).json(localBinding.payload);
  }

  if (!tenantId || !erpBaseUrl) {
    return res.status(400).json({
      status: 'error',
      message: 'tenant_id o identidad tenant (slug/email) y erp_base_url son obligatorios para vincular terminales desde ERP.',
    });
  }

  if (!terminalId || !posDeviceId) {
    return res.status(400).json({
      status: 'error',
      message: 'terminal_id y new_device_id son obligatorios.',
    });
  }

  try {
    const resolvedContext = await resolveErpTerminalContext(req, erpBaseUrl, {
      tenantId,
      tenantSlug,
      tenantEmail,
      deviceId: posDeviceId,
    });
    const resolvedErpTenantId = resolvedContext.tenantId;
    const resolvedCompanyId = resolvedContext.companyId;
    const resolvedStoreId = resolvedContext.storeId;

    if (!resolvedErpTenantId) {
      return res.status(404).json({
        status: 'error',
        message: 'No se encontró un tenant operativo del ERP para esta activación.',
      });
    }

    const erpTerminals = Array.isArray(resolvedContext.terminals) ? resolvedContext.terminals : [];
    let targetTerminal = resolveTargetErpTerminal(erpTerminals, terminalId, erpTerminalIdFromBody);

    // Fallback: la terminal puede existir pero estar fuera de la lista de pairing
    // (offline/inactiva/ocupada). Si el cliente envía un UUID concreto, se resuelve por id.
    if (!targetTerminal && erpTerminalIdFromBody) {
      const fallbackProfilePayload = await fetchTerminalProfileSafe(
        req,
        erpBaseUrl,
        resolvedErpTenantId,
        erpTerminalIdFromBody
      );
      const fallbackProfile = asObject(fallbackProfilePayload?.profile);
      const fallbackTerminal = asObject(fallbackProfilePayload?.terminal);
      const fallbackMetadata = asObject(fallbackProfile.metadata);
      const fallbackId = asString(fallbackTerminal.id) || asString(fallbackProfile.terminal_id) || erpTerminalIdFromBody;
      if (fallbackProfilePayload && (Object.keys(fallbackProfile).length > 0 || Object.keys(fallbackTerminal).length > 0)) {
        targetTerminal = {
          ...fallbackTerminal,
          id: fallbackId,
          name: asString(fallbackTerminal.name) || asString(fallbackProfile.terminal_name) || asString(fallbackProfile.name) || fallbackId,
          store_id: asString(fallbackTerminal.store_id) || asString(fallbackProfile.store_id) || resolvedStoreId || null,
          company_id: asString(fallbackTerminal.company_id) || asString(fallbackProfile.company_id) || resolvedCompanyId || null,
          device_id: asString(fallbackTerminal.device_id) || asString(fallbackProfile.device_id) || asString(fallbackMetadata.bound_device_id) || null,
        };
      }
    }

    if (!targetTerminal) {
      return res.status(404).json({
        status: 'error',
        message: 'La terminal no existe en el ERP para este tenant.',
      });
    }
    if (isArchivedTerminalBindingRecord(targetTerminal)) {
      return res.status(409).json({
        status: 'error',
        code: 'TERMINAL_ARCHIVED',
        message: 'La terminal seleccionada fue archivada en el ERP. Actualiza la lista y selecciona su identidad activa.',
      });
    }

    const targetErpTerminalId = asString(targetTerminal.id);
    const targetOperationalTerminalId = resolveOperationalTerminalId(targetTerminal) || targetErpTerminalId;
    const targetTerminalName = asString(targetTerminal.name) || targetOperationalTerminalId;

    const currentProfilePayload = await fetchTerminalProfileSafe(
      req,
      erpBaseUrl,
      resolvedErpTenantId,
      targetErpTerminalId
    );
    const currentProfile = asObject(currentProfilePayload?.profile);
    const currentMetadata = asObject(currentProfile.metadata);
    const occupiedDeviceId = asString(targetTerminal.device_id) || resolveOccupiedDeviceId(targetTerminal, currentProfilePayload);

    if (occupiedDeviceId && occupiedDeviceId !== posDeviceId && !forceTransfer) {
      return res.status(409).json({
        status: 'error',
        code: 'TERMINAL_OCCUPIED',
        message: 'La terminal ya está ocupada por otro equipo.',
        current_device_id: occupiedDeviceId,
      });
    }

    let takeoverPayload: any = null;
    if (occupiedDeviceId && occupiedDeviceId !== posDeviceId && forceTransfer) {
      takeoverPayload = await fetchErpJson(
        req,
        erpBaseUrl,
        `/api/settings/terminals/${encodeURIComponent(targetErpTerminalId)}/takeover`,
        {
          method: 'POST',
          tenantId: resolvedErpTenantId,
          body: {
            terminal_id: targetErpTerminalId,
            device_id: posDeviceId,
            ...(deviceName ? { device_name: deviceName } : {}),
            source: 'CLIC_POS_SELF_SERVICE_RECOVERY',
          },
        }
      );
    }

    const mergedMetadata = {
      ...currentMetadata,
      bound_device_id: posDeviceId,
      bound_at: new Date().toISOString(),
      binding_mode: bindingMode,
      transferred_from_device_id:
        occupiedDeviceId && occupiedDeviceId !== posDeviceId ? occupiedDeviceId : currentMetadata.transferred_from_device_id || null,
      binding_source: 'CLIC_POS_SETUP',
    };

    const persistedProfilePayload = await fetchErpJson(req, erpBaseUrl, '/api/sync/bootstrap/terminal-profile', {
      method: 'POST',
      tenantId: resolvedErpTenantId,
      body: {
        tenant_id: resolvedErpTenantId,
        company_id: asString(targetTerminal.company_id) || resolvedCompanyId,
        store_id: asString(targetTerminal.store_id) || resolvedStoreId,
        terminal_id: targetErpTerminalId,
        device_id: posDeviceId,
        profile_status: currentProfile.profile_status || 'ACTIVE',
        document_types: Array.isArray(currentProfile.document_types) ? currentProfile.document_types : [],
        series_codes: Array.isArray(currentProfile.series_codes) ? currentProfile.series_codes : [],
        warehouse_codes: Array.isArray(currentProfile.warehouse_codes) ? currentProfile.warehouse_codes : [],
        currency_codes: Array.isArray(currentProfile.currency_codes) ? currentProfile.currency_codes : [],
        tax_codes: Array.isArray(currentProfile.tax_codes) ? currentProfile.tax_codes : [],
        customer_codes: Array.isArray(currentProfile.customer_codes) ? currentProfile.customer_codes : [],
        supplier_codes: Array.isArray(currentProfile.supplier_codes) ? currentProfile.supplier_codes : [],
        item_codes: Array.isArray(currentProfile.item_codes) ? currentProfile.item_codes : [],
        payment_method_codes: Array.isArray(currentProfile.payment_method_codes) ? currentProfile.payment_method_codes : [],
        metadata: mergedMetadata,
      },
    });

    const selectedProfilePayload = {
      ...currentProfilePayload,
      profile: persistedProfilePayload?.profile || persistedProfilePayload,
    };

    const profiles = await Promise.all(
      erpTerminals.map(async (terminal: any) => {
        const id = asString(terminal.id);
        if (id === targetErpTerminalId) {
          return [id, selectedProfilePayload] as const;
        }
        const profile = await fetchTerminalProfileSafe(req, erpBaseUrl, resolvedErpTenantId, id);
        return [id, profile] as const;
      })
    );

    const profilesByTerminalId = new Map<string, any>(profiles);
    const boundConfig = buildBoundConfig({
      currentConfig: config,
      overview: {
        branches: [],
        terminals: erpTerminals,
      },
      profilesByTerminalId,
      selectedTerminalId: targetErpTerminalId,
      posDeviceId,
      bindingMode,
    });

    saveSetting('config', boundConfig);
    persistOperationalDocumentState(boundConfig, targetOperationalTerminalId);
    saveSetting('active_tenant_id', resolvedErpTenantId);
    saveSetting('erp_setup_context', {
      tenantId: resolvedErpTenantId,
      tenantName: resolvedContext.tenantName,
      tenantSlug,
      tenantEmail,
      erpBaseUrl,
      companyId: resolvedCompanyId,
      storeId: resolvedStoreId,
      lastResolvedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      source: 'ERP',
      transferred: Boolean(occupiedDeviceId && occupiedDeviceId !== posDeviceId),
      tenant_id: resolvedErpTenantId,
      terminal_id: targetOperationalTerminalId,
      erp_terminal_id: targetErpTerminalId,
      terminal_name: targetTerminalName,
      company_id: asString(targetTerminal.company_id) || resolvedCompanyId || null,
      store_id: asString(targetTerminal.store_id) || resolvedStoreId || null,
      current_device_id: posDeviceId,
      previous_device_id:
        asString(takeoverPayload?.previous_device_id)
        || (occupiedDeviceId && occupiedDeviceId !== posDeviceId ? occupiedDeviceId : null),
      config: boundConfig,
      users: Array.isArray(users) ? users : [],
    });
  } catch (error: any) {
    console.error('❌ Bind terminal error:', error?.message || error);

    if (hasLocalTerminalCatalog(config)) {
      const localBinding = resolveLocalBinding({
        currentConfig: config,
        selectedTerminalId: terminalId,
        posDeviceId,
        bindingMode,
        forceTransfer,
        tenantId,
        users,
      });

      return res.status(localBinding.statusCode).json(localBinding.payload);
    }

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudo vincular la terminal contra ERP.',
    });
  }
});

router.get('/initial-config/:terminalId', async (req, res) => {
  const config = getSetting('config');
  const erpTerminalId = asString(req.params.terminalId);
  const localTerminalId = asString(req.query.local_terminal_id) || erpTerminalId;
  const tenantId = resolveTenantId(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const posDeviceId = asString(req.query.pos_device_id);
  const bindingMode = asString(req.query.binding_mode).toUpperCase() === 'SLAVE' ? 'SLAVE' : 'MASTER';

  if (!erpTerminalId) {
    return res.status(400).json({
      status: 'error',
      message: 'terminalId es obligatorio.',
    });
  }

  if (!tenantId || !erpBaseUrl) {
    return res.status(400).json({
      status: 'error',
      message: 'tenant_id y erp_base_url son obligatorios para cargar la configuración inicial.',
    });
  }

  try {
    const snapshotPayload = await fetchInitialConfigSnapshot(req, erpBaseUrl, tenantId, erpTerminalId);
    const snapshot = extractTerminalConfigSnapshot(snapshotPayload);

    if (!snapshot) {
      throw new Error('El ERP no devolvió terminal_config en la configuración inicial.');
    }

    const applied = materializeTerminalConfigFromSnapshot({
      currentConfig: config,
      terminalId: localTerminalId,
      posDeviceId,
      bindingMode,
      snapshot,
    });

    saveSetting('config', applied.config);
    persistOperationalDocumentState(applied.config, applied.terminalId);
    saveSetting('active_tenant_id', asString(snapshot.tenant_id) || tenantId);
    saveSetting('erp_setup_context', {
      ...resolveStoredErpContext(),
      tenantId: asString(snapshot.tenant_id) || tenantId,
      erpBaseUrl,
      lastResolvedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      source: applied.snapshotSource,
      tenant_id: asString(snapshot.tenant_id) || tenantId,
      terminal_id: applied.terminalId,
      erp_terminal_id: erpTerminalId,
      terminal_config: snapshot,
      config: applied.config,
      snapshot_meta: {
        used_resolved: applied.usedResolved,
        used_fallback_config: applied.usedFallbackConfig,
        used_cached_snapshot: applied.usedCachedSnapshot,
        resolution_error: snapshot.resolution_error ?? null,
        full_pull_on_pairing: applied.fullPullOnPairing ?? false,
      },
    });
  } catch (error: any) {
    console.error('❌ Setup initial config error:', error?.message || error);

    const cachedSnapshot = getCachedTerminalSnapshot(localTerminalId);
    if (cachedSnapshot) {
      const applied = materializeTerminalConfigFromSnapshot({
        currentConfig: config,
        terminalId: localTerminalId,
        posDeviceId,
        bindingMode,
        snapshot: cachedSnapshot,
      });

      saveSetting('config', applied.config);
      persistOperationalDocumentState(applied.config, applied.terminalId);

      return res.json({
        success: true,
        source: 'CACHED_SNAPSHOT',
        tenant_id: asString(cachedSnapshot.tenant_id) || tenantId,
        terminal_id: applied.terminalId,
        erp_terminal_id: erpTerminalId,
        terminal_config: cachedSnapshot,
        config: applied.config,
        snapshot_meta: {
          used_resolved: applied.usedResolved,
          used_fallback_config: applied.usedFallbackConfig,
          used_cached_snapshot: true,
          resolution_error: null,
          full_pull_on_pairing: applied.fullPullOnPairing ?? false,
        },
      });
    }

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudo cargar la configuración inicial de la terminal.',
    });
  }
});

export default router;
