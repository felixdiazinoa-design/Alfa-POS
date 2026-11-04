import { Capacitor } from '@capacitor/core';
import type { BusinessConfig } from '../../types';

export type PosApkLocalVersion = {
  versionName: string | null;
  versionCode: number | null;
  platform: string | null;
  packageName?: string | null;
  buildInfo?: Record<string, unknown>;
};

export type PosApkRelease = {
  version_name: string;
  version_code: number;
  apk_url?: string | null;
  direct_download_url?: string | null;
  checksum_sha256?: string | null;
  changelog?: string | null;
  published_at?: string | null;
};

export type PosApkUpdateAvailable = {
  hasUpdate: true;
  local: PosApkLocalVersion;
  release: PosApkRelease;
  endpointUrl: string;
};

export type PosApkUpdateResult =
  | PosApkUpdateAvailable
  | {
      hasUpdate: false;
      local: PosApkLocalVersion;
      release?: PosApkRelease | null;
      endpointUrl: string;
      reason: 'NO_RELEASE' | 'INVALID_REMOTE_VERSION' | 'LOCAL_VERSION_UNKNOWN' | 'NOT_NEWER';
    };

type LatestReleaseResponse = {
  status?: string;
  release?: Partial<PosApkRelease> | null;
};

type CheckOptions = {
  config?: BusinessConfig | null;
  endpointUrl?: string;
  timeoutMs?: number;
  localVersion?: PosApkLocalVersion;
  force?: boolean;
};

// Origen del registro de APK. El POS consulta `{base}/api/pos-apk/latest`.
// `VITE_ALFA_ADMIN_BASE_URL` (o metadata.alfaAdminBaseUrl) tiene prioridad sobre el
// host heredado de CLIC Cloud-Admin, para que un APK compilado contra ALFA-Admin
// nunca pida actualizaciones a cloud-admin.clicsuite.com.
const CANONICAL_CLOUD_ADMIN_BASE_URL = 'https://cloud-admin.clicsuite.com';
const LEGACY_CLOUD_ADMIN_BASE_URL = 'https://cloud-admin-gamma.vercel.app';
const DEFAULT_POS_APK_LATEST_URL = `${CANONICAL_CLOUD_ADMIN_BASE_URL}/api/pos-apk/latest`;
const DEFAULT_POS_APK_PORTAL_URL = `${CANONICAL_CLOUD_ADMIN_BASE_URL}/apk-pos`;
const POS_APK_LATEST_URL_STORAGE_KEY = 'clic_pos_apk_latest_url';
const POS_APK_PORTAL_URL_STORAGE_KEY = 'clic_pos_apk_portal_url';
const POS_APK_LOCAL_VERSION_CODE_OVERRIDE_KEY = 'clic_pos_apk_local_version_code_override';
const POS_APK_LOCAL_VERSION_NAME_OVERRIDE_KEY = 'clic_pos_apk_local_version_name_override';

let hasCheckedForUpdateThisBoot = false;

const normalizeString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const toFinitePositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseBridgeResult = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const getEnv = () => ((import.meta as any).env || {}) as Record<string, string | undefined>;

const getLocalStorageValue = (key: string): string => {
  try {
    return normalizeString(window.localStorage.getItem(key));
  } catch {
    return '';
  }
};

const normalizeCloudAdminUrl = (value: unknown): string => {
  const normalized = normalizeString(value).replace(/\/$/, '');
  if (!normalized) return '';
  if (normalized === LEGACY_CLOUD_ADMIN_BASE_URL) return CANONICAL_CLOUD_ADMIN_BASE_URL;
  if (normalized.startsWith(`${LEGACY_CLOUD_ADMIN_BASE_URL}/`)) {
    return `${CANONICAL_CLOUD_ADMIN_BASE_URL}${normalized.slice(LEGACY_CLOUD_ADMIN_BASE_URL.length)}`;
  }
  return normalized;
};

const resolveCloudAdminBaseUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = (config?.metadata || {}) as Record<string, unknown>;
  return normalizeCloudAdminUrl(
    metadata.cloudAdminBaseUrl
    || metadata.cloud_admin_base_url
    || env.VITE_CLOUD_ADMIN_BASE_URL
  );
};

/** Base de ALFA-Admin (registro de APK propio). Tiene prioridad sobre Cloud-Admin. */
const resolveAlfaAdminBaseUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = (config?.metadata || {}) as Record<string, unknown>;
  return normalizeCloudAdminUrl(
    metadata.alfaAdminBaseUrl
    || metadata.alfa_admin_base_url
    || env.VITE_ALFA_ADMIN_BASE_URL
  );
};

export const resolvePosApkLatestUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = (config?.metadata || {}) as Record<string, unknown>;
  const configuredBaseUrl = resolveCloudAdminBaseUrl(config);

  const explicitUrl = normalizeCloudAdminUrl(
    metadata.posApkLatestUrl
    || metadata.pos_apk_latest_url
    || getLocalStorageValue(POS_APK_LATEST_URL_STORAGE_KEY)
    || env.VITE_POS_APK_LATEST_URL
    || env.VITE_CLOUD_ADMIN_POS_APK_LATEST_URL
  );

  if (explicitUrl) return explicitUrl;
  const alfaAdminBaseUrl = resolveAlfaAdminBaseUrl(config);
  if (alfaAdminBaseUrl) return `${alfaAdminBaseUrl}/api/pos-apk/latest`;
  if (configuredBaseUrl) return `${configuredBaseUrl}/api/pos-apk/latest`;
  return DEFAULT_POS_APK_LATEST_URL;
};

export const resolvePosApkPortalUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = (config?.metadata || {}) as Record<string, unknown>;
  const configuredBaseUrl = resolveCloudAdminBaseUrl(config);

  const explicitUrl = normalizeCloudAdminUrl(
    metadata.posApkPortalUrl
    || metadata.pos_apk_portal_url
    || metadata.posApkManualUrl
    || metadata.pos_apk_manual_url
    || getLocalStorageValue(POS_APK_PORTAL_URL_STORAGE_KEY)
    || env.VITE_POS_APK_PORTAL_URL
    || env.VITE_CLOUD_ADMIN_POS_APK_PORTAL_URL
  );

  if (explicitUrl) return explicitUrl;
  const alfaAdminBaseUrl = resolveAlfaAdminBaseUrl(config);
  if (alfaAdminBaseUrl) return `${alfaAdminBaseUrl}/apk-pos`;
  if (configuredBaseUrl) return `${configuredBaseUrl}/apk-pos`;
  return DEFAULT_POS_APK_PORTAL_URL;
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const normalizeLocalVersion = (raw: Record<string, unknown> | null): PosApkLocalVersion => {
  const env = getEnv();
  const overrideCode = toFinitePositiveNumber(getLocalStorageValue(POS_APK_LOCAL_VERSION_CODE_OVERRIDE_KEY));
  const overrideName = getLocalStorageValue(POS_APK_LOCAL_VERSION_NAME_OVERRIDE_KEY);
  const versionName = overrideName || normalizeString(raw?.versionName) || normalizeString(env.VITE_POS_APK_VERSION_NAME) || null;
  const versionCode = overrideCode
    || toFinitePositiveNumber(raw?.versionCode)
    || toFinitePositiveNumber(env.VITE_POS_APK_VERSION_CODE);

  return {
    versionName,
    versionCode,
    platform: normalizeString(raw?.platform) || (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web'),
    packageName: normalizeString(raw?.packageName) || null,
    buildInfo: raw || undefined,
  };
};

export const readInstalledPosApkVersion = async (): Promise<PosApkLocalVersion> => {
  try {
    const runtimeWindow = window as any;
    let rawDeviceInfo: unknown = null;

    if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
      rawDeviceInfo = await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
    } else if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
      rawDeviceInfo = runtimeWindow.AndroidPrinter.getDeviceInfo();
    }

    return normalizeLocalVersion(parseBridgeResult(rawDeviceInfo));
  } catch (error) {
    console.info('[posApkUpdate] No se pudo leer versión instalada del APK:', error);
    return normalizeLocalVersion(null);
  }
};

const normalizeRemoteRelease = (payload: LatestReleaseResponse | null): PosApkRelease | null => {
  const release = payload?.release;
  if (!release) return null;

  const versionCode = toFinitePositiveNumber(release.version_code);
  const versionName = normalizeString(release.version_name);
  if (!versionCode || !versionName) return null;

  return {
    version_name: versionName,
    version_code: versionCode,
    apk_url: normalizeString(release.apk_url) || null,
    direct_download_url: normalizeString(release.direct_download_url) || null,
    checksum_sha256: normalizeString(release.checksum_sha256) || null,
    changelog: normalizeString(release.changelog) || null,
    published_at: normalizeString(release.published_at) || null,
  };
};

export const isRemotePosApkNewer = (
  localVersionCode: number | null | undefined,
  remoteVersionCode: number | null | undefined
): boolean => (
  Number.isFinite(Number(localVersionCode))
  && Number.isFinite(Number(remoteVersionCode))
  && Number(remoteVersionCode) > Number(localVersionCode)
);

export const checkForPosApkUpdate = async (options: CheckOptions = {}): Promise<PosApkUpdateResult | null> => {
  if (hasCheckedForUpdateThisBoot && !options.force) return null;
  if (!options.force) hasCheckedForUpdateThisBoot = true;

  const endpointUrl = options.endpointUrl || resolvePosApkLatestUrl(options.config);
  const local = options.localVersion || await readInstalledPosApkVersion();
  const timeoutMs = options.timeoutMs || 3500;

  const response = await fetchWithTimeout(endpointUrl, timeoutMs);
  if (!response.ok) {
    throw new Error(`Cloud-Admin APK latest endpoint responded ${response.status}`);
  }

  const payload = await response.json().catch(() => null) as LatestReleaseResponse | null;
  const release = normalizeRemoteRelease(payload);
  if (!release) {
    return { hasUpdate: false, local, endpointUrl, release: null, reason: 'NO_RELEASE' };
  }

  if (!toFinitePositiveNumber(release.version_code)) {
    return { hasUpdate: false, local, endpointUrl, release, reason: 'INVALID_REMOTE_VERSION' };
  }

  if (!local.versionCode) {
    return { hasUpdate: false, local, endpointUrl, release, reason: 'LOCAL_VERSION_UNKNOWN' };
  }

  if (!isRemotePosApkNewer(local.versionCode, release.version_code)) {
    return { hasUpdate: false, local, endpointUrl, release, reason: 'NOT_NEWER' };
  }

  return {
    hasUpdate: true,
    local,
    release,
    endpointUrl,
  };
};

export const openPosApkDownloadUrl = async (release: PosApkRelease): Promise<void> => {
  const url = normalizeString(release.direct_download_url || release.apk_url);
  if (!url) return;

  try {
    const runtimeWindow = window as any;
    const browserPlugin = runtimeWindow.Capacitor?.Plugins?.Browser;
    if (browserPlugin && typeof browserPlugin.open === 'function') {
      await browserPlugin.open({ url });
      return;
    }

    const target = Capacitor.isNativePlatform() ? '_system' : '_blank';
    const opened = window.open(url, target, 'noopener,noreferrer');
    if (!opened && !Capacitor.isNativePlatform()) {
      window.location.assign(url);
    }
  } catch (error) {
    console.warn('[posApkUpdate] No se pudo abrir URL de descarga:', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

export const openExternalUrl = async (url: string): Promise<void> => {
  const normalizedUrl = normalizeString(url);
  if (!normalizedUrl) return;

  try {
    const runtimeWindow = window as any;
    const browserPlugin = runtimeWindow.Capacitor?.Plugins?.Browser;
    if (browserPlugin && typeof browserPlugin.open === 'function') {
      await browserPlugin.open({ url: normalizedUrl });
      return;
    }

    const target = Capacitor.isNativePlatform() ? '_system' : '_blank';
    const opened = window.open(normalizedUrl, target, 'noopener,noreferrer');
    if (!opened && !Capacitor.isNativePlatform()) {
      window.location.assign(normalizedUrl);
    }
  } catch (error) {
    console.warn('[posApkUpdate] No se pudo abrir URL externa:', error);
    window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
  }
};

export const openPosApkPortalUrl = async (config?: BusinessConfig | null): Promise<void> => {
  await openExternalUrl(resolvePosApkPortalUrl(config));
};

/**
 * Origen efectivo del registro de APK, para mostrarlo en diagnóstico y en el log
 * de `APK/build-apk.sh`: nunca debe apuntar por accidente a Cloud-Admin.
 */
export const describePosApkUpdateSource = (config?: BusinessConfig | null): {
  latestUrl: string;
  portalUrl: string;
  baseUrl: string;
  origin: 'ALFA_ADMIN' | 'CLOUD_ADMIN' | 'EXPLICIT' | 'DEFAULT';
} => {
  const latestUrl = resolvePosApkLatestUrl(config);
  const portalUrl = resolvePosApkPortalUrl(config);
  const alfaAdminBaseUrl = resolveAlfaAdminBaseUrl(config);
  const cloudAdminBaseUrl = resolveCloudAdminBaseUrl(config);

  let origin: 'ALFA_ADMIN' | 'CLOUD_ADMIN' | 'EXPLICIT' | 'DEFAULT' = 'DEFAULT';
  if (alfaAdminBaseUrl && latestUrl.startsWith(alfaAdminBaseUrl)) origin = 'ALFA_ADMIN';
  else if (cloudAdminBaseUrl && latestUrl.startsWith(cloudAdminBaseUrl)) origin = 'CLOUD_ADMIN';
  else if (latestUrl !== DEFAULT_POS_APK_LATEST_URL) origin = 'EXPLICIT';

  return {
    latestUrl,
    portalUrl,
    baseUrl: alfaAdminBaseUrl || cloudAdminBaseUrl,
    origin,
  };
};

export const resetPosApkUpdateCheckForTests = () => {
  hasCheckedForUpdateThisBoot = false;
};
