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
  package_name?: string | null;
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
      reason:
        | 'NO_RELEASE'
        | 'INVALID_REMOTE_VERSION'
        | 'LOCAL_VERSION_UNKNOWN'
        | 'NOT_NEWER'
        | 'FOREIGN_RELEASE';
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

// Canal APK de Alfa POS: ALFA-Admin (proyecto independiente de CLIC-Suite).
// Nunca se debe consultar el feed de Cloud-Admin de CLIC-Suite: publica la APK de
// CLIC POS (com.clicpos.app) y el POS de Alfa terminaría ofreciendo otro binario.
const ALFA_CLOUD_ADMIN_BASE_URL = 'https://alfa-admin-nine.vercel.app';
const LEGACY_CLIC_CLOUD_ADMIN_HOSTS = ['cloud-admin.clicsuite.com', 'cloud-admin-gamma.vercel.app'];
const DEFAULT_POS_APK_LATEST_URL = `${ALFA_CLOUD_ADMIN_BASE_URL}/api/pos-apk/latest`;
const DEFAULT_POS_APK_PORTAL_URL = `${ALFA_CLOUD_ADMIN_BASE_URL}/apk-pos`;
export const ALFA_POS_ANDROID_PACKAGE = 'com.alfapos.app';
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

const readUrlHost = (value: unknown): string => {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${normalized.replace(/^\/\//, '')}`).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
};

export const isClicSuiteAdminUrl = (value: unknown): boolean => {
  const host = readUrlHost(value);
  if (!host) return false;
  return LEGACY_CLIC_CLOUD_ADMIN_HOSTS.some(
    (legacyHost) => host === legacyHost || host.endsWith(`.${legacyHost}`),
  );
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
  // Cualquier host heredado de CLIC-Suite se remapea al canal de Alfa POS,
  // conservando la ruta para no perder endpoints explícitos.
  if (!isClicSuiteAdminUrl(normalized)) return normalized;
  try {
    const parsed = new URL(normalized);
    return `${ALFA_CLOUD_ADMIN_BASE_URL}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  } catch {
    return ALFA_CLOUD_ADMIN_BASE_URL;
  }
};

const resolveCloudAdminBaseUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = (config?.metadata || {}) as Record<string, unknown>;
  return normalizeCloudAdminUrl(
    metadata.cloudAdminBaseUrl
    || metadata.cloud_admin_base_url
    || metadata.alfaAdminBaseUrl
    || metadata.alfa_admin_base_url
    || env.VITE_CLOUD_ADMIN_BASE_URL
    || env.VITE_CLOUD_ADMIN_URL
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
    package_name:
      normalizeString((release as Record<string, unknown>).package_name)
      || normalizeString((release as Record<string, unknown>).packageName)
      || normalizeString((release as Record<string, unknown>).application_id)
      || normalizeString((release as Record<string, unknown>).applicationId)
      || null,
  };
};

/**
 * Un release sólo puede aplicarse si pertenece a Alfa POS. Si Cloud-Admin declara el
 * package del binario y no es `com.alfapos.app` (p. ej. la APK de CLIC POS), se descarta.
 * También se descarta cualquier enlace de descarga alojado en Cloud-Admin de CLIC-Suite.
 */
export const isPosApkReleaseForAlfaPos = (release: PosApkRelease): boolean => {
  const declaredPackage = normalizeString(release.package_name).toLowerCase();
  if (declaredPackage && declaredPackage !== ALFA_POS_ANDROID_PACKAGE) return false;
  if (isClicSuiteAdminUrl(release.direct_download_url)) return false;
  if (isClicSuiteAdminUrl(release.apk_url)) return false;
  return true;
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

  // Nunca se consulta el feed de CLIC-Suite desde Alfa POS, ni siquiera si viene
  // forzado por opciones o por localStorage: publica la APK de CLIC POS.
  if (isClicSuiteAdminUrl(endpointUrl)) {
    console.warn('[posApkUpdate] Endpoint de CLIC-Suite rechazado en Alfa POS:', endpointUrl);
    return { hasUpdate: false, local, endpointUrl, release: null, reason: 'FOREIGN_RELEASE' };
  }

  const response = await fetchWithTimeout(endpointUrl, timeoutMs);
  if (!response.ok) {
    throw new Error(`Cloud-Admin APK latest endpoint responded ${response.status}`);
  }

  const payload = await response.json().catch(() => null) as LatestReleaseResponse | null;
  const release = normalizeRemoteRelease(payload);
  if (!release) {
    return { hasUpdate: false, local, endpointUrl, release: null, reason: 'NO_RELEASE' };
  }

  if (!isPosApkReleaseForAlfaPos(release)) {
    console.warn('[posApkUpdate] Release descartado: no corresponde a Alfa POS', {
      version: release.version_name,
      packageName: release.package_name,
      downloadUrl: release.direct_download_url || release.apk_url,
    });
    return { hasUpdate: false, local, endpointUrl, release, reason: 'FOREIGN_RELEASE' };
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

export const resetPosApkUpdateCheckForTests = () => {
  hasCheckedForUpdateThisBoot = false;
};
