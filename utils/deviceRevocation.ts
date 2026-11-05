import { Preferences } from '@capacitor/preferences';

export const DEVICE_REVOKED_EVENT = 'clic-pos-device-revoked';
export const DEVICE_SUPERSEDED_MESSAGE = 'Este equipo ya no está autorizado para esta terminal. La caja fue tomada por otro dispositivo.';
export const DEVICE_REAUTH_GRACE_STORAGE_KEY = 'clic_device_reauthorized_at';
export const DEVICE_PAIRING_SESSION_STORAGE_KEY = 'clic_pairing_device_id';
const PERSISTENT_DEVICE_ID_STORAGE_KEY = 'clic_pos_persistent_device_id';
const DEVICE_REAUTH_DEVICE_STORAGE_KEY = 'clic_device_reauthorized_device_id';

export type DeviceRevocationReason = 'DEVICE_SUPERSEDED' | 'DEVICE_REVOKED' | 'TERMINAL_TAKEOVER';

export type DeviceRevocationDetail = {
  reason: DeviceRevocationReason;
  message: string;
  terminalId?: string | null;
  previousDeviceId?: string | null;
  newDeviceId?: string | null;
  payload?: unknown;
};

const normalize = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizeDeviceId = (value: unknown): string => normalize(value).toUpperCase();

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

export const resolveLocalDeviceId = (): string => (
  normalize(localStorage.getItem('CLIC_POS_DEVICE_ID'))
  || normalize(localStorage.getItem('pos_device_id'))
  || normalize(localStorage.getItem(DEVICE_PAIRING_SESSION_STORAGE_KEY))
);

export const persistLocalDeviceId = (deviceId: string) => {
  const normalized = normalize(deviceId);
  if (!normalized) return;
  localStorage.setItem('pos_device_id', normalized);
  localStorage.setItem('CLIC_POS_DEVICE_ID', normalized);
  localStorage.setItem(DEVICE_PAIRING_SESSION_STORAGE_KEY, normalized);
};

const persistDeviceIdToPreferences = async (deviceId: string) => {
  const normalized = normalize(deviceId);
  if (!normalized) return;
  try {
    await Preferences.set({ key: PERSISTENT_DEVICE_ID_STORAGE_KEY, value: normalized });
  } catch (error) {
    console.warn('[device_identity] persistent_storage_write_failed', error);
  }
};

const readDeviceIdFromPreferences = async (): Promise<string> => {
  try {
    const result = await Preferences.get({ key: PERSISTENT_DEVICE_ID_STORAGE_KEY });
    return normalize(result.value);
  } catch (error) {
    console.warn('[device_identity] persistent_storage_read_failed', error);
    return '';
  }
};

/**
 * Identificador estable del dispositivo físico (Android `Settings.Secure.ANDROID_ID`),
 * expuesto por el bridge nativo `ClicPOSAppBridge.getStableDeviceId()`.
 *
 * Sobrevive a desinstalación/reinstalación para el mismo par (dispositivo, llave de
 * firma, usuario). Se usa como fuente del id persistente cuando no hay ningún id
 * previo, para que "la misma caja" pueda re-vincularse sin reautorización manual.
 */
const readStableDeviceId = (): string => {
  try {
    const bridge = (window as unknown as {
      ClicPOSAppBridge?: { getStableDeviceId?: () => string };
    }).ClicPOSAppBridge;
    if (bridge && typeof bridge.getStableDeviceId === 'function') {
      const raw = normalize(bridge.getStableDeviceId());
      if (raw) return `ANDROID-${normalizeDeviceId(raw)}`;
    }
  } catch (error) {
    console.warn('[device_identity] stable_device_id_read_failed', error);
  }
  return '';
};

export const resolveOrCreateLocalDeviceId = (): string => {
  const existing = resolveLocalDeviceId();
  if (existing) {
    persistLocalDeviceId(existing);
    void persistDeviceIdToPreferences(existing);
    return existing;
  }

  const stableDeviceId = readStableDeviceId();
  if (stableDeviceId) {
    persistLocalDeviceId(stableDeviceId);
    void persistDeviceIdToPreferences(stableDeviceId);
    console.info('device_id_derived_from_android_id', { deviceId: stableDeviceId });
    return stableDeviceId;
  }

  const generated = `DEV-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  persistLocalDeviceId(generated);
  void persistDeviceIdToPreferences(generated);
  console.info('device_id_generated_first_install', { deviceId: generated });
  return generated;
};

export const resolveOrCreatePersistentDeviceId = async (): Promise<string> => {
  const persistentDeviceId = await readDeviceIdFromPreferences();
  if (persistentDeviceId) {
    persistLocalDeviceId(persistentDeviceId);
    console.info('device_id_loaded_from_persistent_storage', { deviceId: persistentDeviceId });
    return persistentDeviceId;
  }

  const localDeviceId = resolveLocalDeviceId();
  if (localDeviceId) {
    persistLocalDeviceId(localDeviceId);
    await persistDeviceIdToPreferences(localDeviceId);
    console.info('device_id_restored_after_db_reset', { deviceId: localDeviceId });
    return localDeviceId;
  }

  // Instalación limpia: deriva el id del ANDROID_ID para que sobreviva a
  // desinstalaciones (misma caja física = mismo id). Fallback al id aleatorio.
  const stableDeviceId = readStableDeviceId();
  if (stableDeviceId) {
    persistLocalDeviceId(stableDeviceId);
    await persistDeviceIdToPreferences(stableDeviceId);
    console.info('device_id_derived_from_android_id', { deviceId: stableDeviceId });
    return stableDeviceId;
  }

  const generated = `DEV-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  persistLocalDeviceId(generated);
  await persistDeviceIdToPreferences(generated);
  console.info('device_id_generated_first_install', { deviceId: generated });
  return generated;
};

export const restorePersistentDeviceIdAfterDbReset = async (): Promise<string> => {
  const deviceId = await resolveOrCreatePersistentDeviceId();
  persistLocalDeviceId(deviceId);
  console.info('device_id_restored_after_db_reset', { deviceId });
  return deviceId;
};

export const resetDeviceIdentityBySupport = async (): Promise<string> => {
  const generated = `DEV-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  persistLocalDeviceId(generated);
  await persistDeviceIdToPreferences(generated);
  console.warn('device_id_reset_by_support', { deviceId: generated });
  return generated;
};

export const markDeviceReauthorized = (deviceId?: string | null) => {
  const normalized = normalize(deviceId) || resolveLocalDeviceId();
  if (!normalized) return;
  persistLocalDeviceId(normalized);
  void persistDeviceIdToPreferences(normalized);
  localStorage.setItem(DEVICE_REAUTH_GRACE_STORAGE_KEY, String(Date.now()));
  localStorage.setItem(DEVICE_REAUTH_DEVICE_STORAGE_KEY, normalized);
};

export const isDeviceSupersededError = (error: unknown): boolean => {
  const record = error && typeof error === 'object' ? error as Record<string, any> : {};
  const code = normalize(record.code || record.errorCode).toUpperCase();
  const status = Number(record.status);
  const message = normalize(record.message).toLowerCase();

  return (
    code === 'DEVICE_SUPERSEDED'
    || (status === 403 && message.includes('terminal autorizada'))
    || message.includes('device_superseded')
    || message.includes('dispositivo ya no')
    || message.includes('equipo ya no')
  );
};

const shouldSuppressFreshAuthorizationRevocation = (detail: DeviceRevocationDetail): boolean => {
  // A backend DEVICE_SUPERSEDED response is authoritative. Never let the
  // recent-reauthorization grace window or an echoed device id bypass it.
  if (detail.reason === 'DEVICE_SUPERSEDED') return false;

  const localDeviceId = normalizeDeviceId(resolveLocalDeviceId());
  if (!localDeviceId) return false;

  const payload = asRecord(detail.payload);
  const payloadAuth = asRecord(payload.auth);
  const candidateAuthorizedDevices = [
    detail.newDeviceId,
    payload.canonical_device_id,
    payload.canonicalDeviceId,
    payload.new_device_id,
    payload.newDeviceId,
    payload.authorized_device_id,
    payload.authorizedDeviceId,
    payload.current_device_id,
    payload.currentDeviceId,
    payload.bound_device_id,
    payload.boundDeviceId,
    payload.reauthorized_device_id,
    payload.reauthorizedDeviceId,
    payload.device_id,
    payload.deviceId,
    payload.pos_device_id,
    payload.posDeviceId,
    payloadAuth.device_id,
    payloadAuth.deviceId,
  ].map(normalizeDeviceId).filter(Boolean);

  if (candidateAuthorizedDevices.includes(localDeviceId)) {
    console.warn('[DEVICE_REVOCATION_IGNORED]', 'Backend payload points to the current local device.', {
      localDeviceId,
      reason: detail.reason,
      terminalId: detail.terminalId || payload.terminal_id || null,
    });
    return true;
  }

  return false;
};

export const dispatchDeviceRevoked = (detail: DeviceRevocationDetail) => {
  if (shouldSuppressFreshAuthorizationRevocation(detail)) return;

  window.dispatchEvent(new CustomEvent<DeviceRevocationDetail>(DEVICE_REVOKED_EVENT, {
    detail,
  }));
};
