export const UNIDENTIFIED_COMPANY_NAME = 'Empresa sin identificar';
export const UNIDENTIFIED_STORE_NAME = 'Sucursal sin identificar';

export interface TerminalBindingRecord {
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
  occupied: boolean;
  canReauthorize: boolean;
  currentDeviceId?: string;
  config: Record<string, any>;
  [key: string]: any;
}

export interface TerminalStoreGroup<T extends TerminalBindingRecord> {
  key: string;
  id?: string;
  name: string;
  terminals: T[];
}

export interface TerminalCompanyGroup<T extends TerminalBindingRecord> {
  key: string;
  id?: string;
  name: string;
  stores: TerminalStoreGroup<T>[];
}

const cleanText = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
);

// El ERP reserva la terminal con un device placeholder (DRAFT-...) hasta que
// un POS real la reclama. Un placeholder NO es "otro equipo": la caja está libre.
const PLACEHOLDER_DEVICE_PATTERN = /^(?:DRAFT|TEMP|PLACEHOLDER|PENDING)[-_]/i;

export const isPlaceholderDeviceId = (value?: unknown): boolean => {
  const normalized = cleanText(value);
  return !normalized || PLACEHOLDER_DEVICE_PATTERN.test(normalized);
};

export const normalizeRealDeviceId = (value?: unknown): string | undefined => {
  const normalized = cleanText(value);
  return isPlaceholderDeviceId(normalized) ? undefined : normalized;
};

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (normalized === 1 || normalized === '1' || normalized === 'true') return true;
  if (normalized === 0 || normalized === '0' || normalized === 'false') return false;
  return undefined;
};

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = cleanText(value);
    if (normalized && normalized.toLowerCase() !== 'null' && normalized.toLowerCase() !== 'undefined') {
      return normalized;
    }
  }
  return '';
};

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

export const isArchivedTerminalBindingRecord = (raw: Record<string, any>): boolean => {
  const config = {
    ...asRecord(raw.terminal_config),
    ...asRecord(raw.terminalConfig),
    ...asRecord(raw.config),
  };
  const metadata = {
    ...asRecord(config.metadata),
    ...asRecord(raw.metadata),
  };
  const terminalNames = [raw.terminal_name, raw.terminalName, raw.nombre, raw.name]
    .map(cleanText)
    .filter(Boolean);
  const lifecycleStatuses = [
    raw.status,
    raw.lifecycle_status,
    raw.lifecycleStatus,
    raw.record_status,
    raw.recordStatus,
    raw.profile_status,
    raw.profileStatus,
    raw.binding_status,
    raw.bindingStatus,
    config.status,
    config.profile_status,
    metadata.status,
  ].map(value => cleanText(value).toUpperCase()).filter(Boolean);
  const explicitlyArchived = [
    raw.is_archived,
    raw.isArchived,
    raw.archived,
    config.is_archived,
    config.isArchived,
    config.archived,
    metadata.is_archived,
    metadata.isArchived,
    metadata.archived,
  ].some(value => readBoolean(value) === true);
  const explicitlyInactive = [raw.active, config.active, metadata.active]
    .some(value => readBoolean(value) === false);
  const hasArchiveTimestamp = Boolean(firstText(
    raw.archived_at,
    raw.archivedAt,
    raw.deleted_at,
    raw.deletedAt,
    config.archived_at,
    config.archivedAt,
    config.deleted_at,
    config.deletedAt,
    metadata.archived_at,
    metadata.archivedAt,
    metadata.deleted_at,
    metadata.deletedAt,
  ));

  return terminalNames.some(name => name.toUpperCase().startsWith('ARCHIVED-'))
    || explicitlyArchived
    || explicitlyInactive
    || hasArchiveTimestamp
    || lifecycleStatuses.some(status => status.includes('ARCHIV') || status.includes('DELET'));
};

export const normalizeTerminalBindingRecord = (
  raw: Record<string, any>,
  options: { deviceId?: string; tenantId?: string } = {},
): TerminalBindingRecord => {
  const config = raw?.config && typeof raw.config === 'object' ? raw.config : {};
  // GET /api/setup/terminals defines id/terminal_id as the authoritative UUID.
  // ERP aliases are accepted only as a fallback for legacy responses.
  const id = firstText(raw.id, raw.terminal_id, raw.erpTerminalId, raw.erp_terminal_id);
  const currentDeviceId = normalizeRealDeviceId(
    firstText(raw.currentDeviceId, raw.current_device_id, raw.device_id),
  );
  const bindingStatus = firstText(raw.binding_status, raw.bindingStatus).toUpperCase() || undefined;
  const explicitOccupied = readBoolean(raw.is_occupied ?? raw.occupied);
  // Sin device real no hay dueño: el placeholder DRAFT-* (o un device vacío)
  // nunca puede contar como "ocupada por otro equipo", aunque el status venga
  // como OCCUPIED por datos legados.
  const occupied = !currentDeviceId
    ? false
    : (explicitOccupied ?? (
      bindingStatus === 'OCCUPIED'
      || currentDeviceId !== cleanText(options.deviceId)
    ));
  const explicitCanReauthorize = readBoolean(raw.can_reauthorize ?? raw.canReauthorize);

  return {
    ...raw,
    id,
    erpTerminalId: id,
    tenantId: firstText(raw.tenant_id, raw.tenantId, options.tenantId) || undefined,
    companyId: firstText(raw.company_id, raw.companyId) || undefined,
    companyName: firstText(raw.company_name, raw.companyName) || UNIDENTIFIED_COMPANY_NAME,
    storeId: firstText(raw.store_id, raw.storeId) || undefined,
    storeName: firstText(raw.store_name, raw.storeName, raw.sucursal, raw.location) || UNIDENTIFIED_STORE_NAME,
    name: firstText(raw.terminal_name, raw.terminalName, raw.nombre, raw.name, id),
    terminalCode: firstText(raw.terminal_code, raw.terminalCode, config.stationNumber) || undefined,
    bindingStatus,
    occupied,
    canReauthorize: explicitCanReauthorize ?? occupied,
    currentDeviceId,
    config,
  };
};

export const groupTerminalBindingRecords = <T extends TerminalBindingRecord>(
  terminals: T[],
): TerminalCompanyGroup<T>[] => {
  const companies = new Map<string, TerminalCompanyGroup<T> & { storeMap: Map<string, TerminalStoreGroup<T>> }>();

  terminals.forEach((terminal, index) => {
    const companyKey = terminal.companyId ? `company:${terminal.companyId}` : 'company:unidentified';
    let company = companies.get(companyKey);
    if (!company) {
      company = {
        key: companyKey,
        id: terminal.companyId,
        name: terminal.companyName,
        stores: [],
        storeMap: new Map(),
      };
      companies.set(companyKey, company);
    }

    // A legacy response without store_id gets an identity-based group. This avoids
    // using a repeated display name as an authoritative grouping key.
    const storeKey = terminal.storeId
      ? `${companyKey}:store:${terminal.storeId}`
      : `${companyKey}:legacy-store:${terminal.id || index}`;
    let store = company.storeMap.get(storeKey);
    if (!store) {
      store = { key: storeKey, id: terminal.storeId, name: terminal.storeName, terminals: [] };
      company.storeMap.set(storeKey, store);
      company.stores.push(store);
    }
    store.terminals.push(terminal);
  });

  return Array.from(companies.values()).map(({ storeMap: _storeMap, ...company }) => company);
};

export const formatTerminalBindingLabel = (terminal: Pick<TerminalBindingRecord, 'name' | 'terminalCode'>): string => (
  [cleanText(terminal.name), cleanText(terminal.terminalCode)].filter(Boolean).join(' · ')
);

export const formatTerminalBindingStatus = (terminal: Pick<TerminalBindingRecord, 'bindingStatus' | 'occupied'>): string => {
  if (terminal.bindingStatus === 'AVAILABLE') return 'Disponible';
  if (terminal.bindingStatus === 'OCCUPIED') return 'Vinculada';
  if (terminal.bindingStatus) {
    const readable = terminal.bindingStatus.toLowerCase().replace(/[_-]+/g, ' ');
    return readable.charAt(0).toUpperCase() + readable.slice(1);
  }
  return terminal.occupied ? 'Vinculada' : 'Disponible';
};

export const isTerminalBindingSelectable = (
  terminal: Pick<TerminalBindingRecord, 'occupied' | 'canReauthorize'>,
): boolean => !terminal.occupied || terminal.canReauthorize;

export const buildTerminalBindIdentityPayload = (
  terminal: Pick<TerminalBindingRecord, 'id'>,
  deviceId: string,
  deviceName?: string,
): { terminal_id: string; new_device_id: string; device_name?: string } => ({
  terminal_id: terminal.id,
  new_device_id: deviceId,
  ...(cleanText(deviceName) ? { device_name: cleanText(deviceName) } : {}),
});
