import { CustomerDisplayConfig } from '../types';
import { normalizeMediaAsset } from './media';

const DISPLAY_QUERY_PARAM = 'view=VISOR';
const DISPLAY_SURFACE_PARAM = 'surface';
const SECONDARY_DISPLAY_SURFACE = 'SECONDARY';

const DISPLAY_SESSION_KEYS = [
  'ANDROID_SECONDARY',
  'HDMI',
  'USB',
  'NETWORK',
] as const;
const NATIVE_ANDROID_VISOR_URL = 'https://localhost/?view=VISOR&surface=SECONDARY';

type DisplayLaunchMode = 'ANDROID_SECONDARY' | 'HDMI' | 'USB' | 'NETWORK';

export interface DisplayLaunchResult {
  opened: boolean;
  mode: DisplayLaunchMode;
  url: string;
  usedSecondScreen: boolean;
}

export interface DisplayPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

const isAndroidRuntime = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('android') || ua.includes(' wv)');
};

const DEFAULT_DISPLAY_CONFIG: CustomerDisplayConfig = {
  isEnabled: true,
  welcomeMessage: '¡Bienvenido a Alfa POS!',
  showItemImages: true,
  showQrPayment: true,
  layout: 'SPLIT',
  connectionType: 'ANDROID_SECONDARY',
  ipAddress: '',
  ads: [],
};

export const normalizeCustomerDisplayConnectionType = (
  value?: CustomerDisplayConfig['connectionType'] | null,
): DisplayLaunchMode => {
  switch ((value || '').toUpperCase()) {
    case 'USB':
      return 'USB';
    case 'ANDROID_SECONDARY':
      return 'ANDROID_SECONDARY';
    case 'NETWORK':
      return 'NETWORK';
    case 'HDMI':
    case 'VIRTUAL':
    default:
      return 'HDMI';
  }
};

export const normalizeCustomerDisplayConfig = (
  raw?: Partial<CustomerDisplayConfig> | null,
): CustomerDisplayConfig => ({
  ...DEFAULT_DISPLAY_CONFIG,
  ...raw,
  connectionType: normalizeCustomerDisplayConnectionType(raw?.connectionType) as CustomerDisplayConfig['connectionType'],
  ipAddress: typeof raw?.ipAddress === 'string' ? raw.ipAddress.trim() : '',
  ads: Array.isArray(raw?.ads)
    ? raw.ads
      .map((ad, index) => normalizeMediaAsset(ad, index))
      .filter((ad): ad is NonNullable<typeof ad> => Boolean(ad))
      .map(ad => ({ ...ad, active: ad.active !== false }))
    : DEFAULT_DISPLAY_CONFIG.ads,
});

const buildNetworkVisorUrl = (ipAddress: string): string => {
  const trimmed = ipAddress.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  url.searchParams.set('view', 'VISOR');
  url.searchParams.set(DISPLAY_SURFACE_PARAM, SECONDARY_DISPLAY_SURFACE);
  return url.toString();
};

export const buildCustomerDisplayUrl = (config: CustomerDisplayConfig): string => {
  const normalized = normalizeCustomerDisplayConfig(config);
  const mode = normalizeCustomerDisplayConnectionType(normalized.connectionType);

  if (mode === 'NETWORK' && normalized.ipAddress) {
    return buildNetworkVisorUrl(normalized.ipAddress);
  }

  if (isAndroidRuntime() && mode !== 'NETWORK') {
    return NATIVE_ANDROID_VISOR_URL;
  }

  const url = new URL(window.location.pathname || '/', window.location.origin);
  url.search = '';
  url.searchParams.set('view', 'VISOR');
  url.searchParams.set(DISPLAY_SURFACE_PARAM, SECONDARY_DISPLAY_SURFACE);
  return url.toString();
};

interface NativeCustomerDisplayBridge {
  launch(payload: string): string;
  dismiss(payload?: string): string;
  probe(payload?: string): string;
}

interface NativeCustomerDisplayLaunchResponse {
  success: boolean;
  opened?: boolean;
  mode?: DisplayLaunchMode;
  usedSecondScreen?: boolean;
  message?: string;
  displayName?: string;
}

interface NativeCustomerDisplayShim {
  platform: 'android';
  launch: (payload: {
    mode: DisplayLaunchMode;
    url: string;
    welcomeMessage?: string;
  }) => Promise<NativeCustomerDisplayLaunchResponse>;
  dismiss: () => Promise<{ success: boolean; message?: string }>;
  probe: () => Promise<{ success: boolean; displays?: Array<Record<string, unknown>>; message?: string }>;
}

declare global {
  interface Window {
    AndroidCustomerDisplay?: NativeCustomerDisplayBridge;
    ClicPOSCustomerDisplay?: NativeCustomerDisplayShim;
  }
}

const isNativeAndroidDisplayMode = (mode: DisplayLaunchMode) => mode !== 'NETWORK';

const supportsNativeAndroidCustomerDisplay = () =>
  typeof window !== 'undefined'
  && isAndroidRuntime()
  && (
    typeof window.ClicPOSCustomerDisplay?.launch === 'function'
    || typeof window.AndroidCustomerDisplay?.launch === 'function'
  );

export const isCustomerDisplaySurface = (): boolean => {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('view') !== 'VISOR') return false;

  // The native bridge only exists on MainActivity's WebView. The Presentation
  // has its own WebView without this bridge, so it remains the authoritative
  // secondary surface even when Android restores the primary URL incorrectly.
  return !supportsNativeAndroidCustomerDisplay();
};

export const isCustomerDisplayView = (view: unknown): boolean => view === 'VISOR';

export const recoverNativePrimaryDisplayUrl = (): boolean => {
  if (typeof window === 'undefined' || !supportsNativeAndroidCustomerDisplay()) {
    return false;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get('view') !== 'VISOR') return false;

  url.searchParams.delete('view');
  url.searchParams.delete(DISPLAY_SURFACE_PARAM);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}` || '/',
  );
  return true;
};

const launchNativeAndroidCustomerDisplay = async (payload: {
  mode: DisplayLaunchMode;
  url: string;
  welcomeMessage?: string;
}): Promise<NativeCustomerDisplayLaunchResponse> => {
  if (typeof window.ClicPOSCustomerDisplay?.launch === 'function') {
    return window.ClicPOSCustomerDisplay.launch(payload);
  }

  if (typeof window.AndroidCustomerDisplay?.launch !== 'function') {
    return {
      success: false,
      opened: false,
      message: 'El puente nativo del visor Android no está disponible.',
    };
  }

  try {
    const rawResponse = window.AndroidCustomerDisplay.launch(JSON.stringify(payload));
    return JSON.parse(rawResponse) as NativeCustomerDisplayLaunchResponse;
  } catch (error) {
    return {
      success: false,
      opened: false,
      message: error instanceof Error
        ? `Respuesta inválida del visor Android: ${error.message}`
        : 'Respuesta inválida del visor Android.',
    };
  }
};

export const detectSecondaryDisplayPlacement = async (): Promise<DisplayPlacement | null> => {
  if (typeof window === 'undefined') return null;

  if ('getScreenDetails' in window) {
    try {
      const details = await (window as any).getScreenDetails();
      const candidate = details?.screens?.find((screen: any) => !screen?.isPrimary)
        || details?.screens?.find((screen: any) => screen !== details?.currentScreen);

      if (candidate) {
        return {
          left: Number(candidate.left || 0),
          top: Number(candidate.top || 0),
          width: Number(candidate.width || 1280),
          height: Number(candidate.height || 720),
        };
      }
    } catch (error) {
      console.warn('[customerDisplay] screen details unavailable', error);
    }
  }

  if (isAndroidRuntime()) {
    return null;
  }

  const availWidth = window.screen?.availWidth || 0;
  const availHeight = window.screen?.availHeight || 0;
  const outerWidth = window.outerWidth || 0;
  const outerHeight = window.outerHeight || 0;
  const screenX = typeof window.screenX === 'number' ? window.screenX : 0;
  const screenY = typeof window.screenY === 'number' ? window.screenY : 0;

  const remainingWidth = availWidth - (screenX + outerWidth);
  if (remainingWidth > 320) {
    return {
      left: screenX + outerWidth,
      top: screenY,
      width: remainingWidth,
      height: Math.max(outerHeight, availHeight || 720),
    };
  }

  return null;
};

const buildDisplayWindowFeatures = (placement?: DisplayPlacement | null) => {
  if (!placement) {
    return 'left=0,top=0,width=1024,height=768,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no';
  }

  return [
    `left=${Math.round(placement.left)}`,
    `top=${Math.round(placement.top)}`,
    `width=${Math.max(640, Math.round(placement.width))}`,
    `height=${Math.max(480, Math.round(placement.height))}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=no',
  ].join(',');
};

export const resetCustomerDisplayAutoLaunch = (contextKey = 'default') => {
  if (typeof window === 'undefined') return;
  DISPLAY_SESSION_KEYS.forEach((mode) => {
    sessionStorage.removeItem(`clic_pos_customer_display_${contextKey}_${mode}`);
  });
};

export const launchCustomerDisplay = async (
  config: CustomerDisplayConfig,
  options?: { contextKey?: string },
): Promise<DisplayLaunchResult> => {
  const normalized = normalizeCustomerDisplayConfig(config);
  const mode = normalizeCustomerDisplayConnectionType(normalized.connectionType);
  const url = buildCustomerDisplayUrl(normalized);

  if (supportsNativeAndroidCustomerDisplay() && isNativeAndroidDisplayMode(mode)) {
    const response = await launchNativeAndroidCustomerDisplay({
      mode,
      url,
      welcomeMessage: normalized.welcomeMessage,
    });

    if (!response?.success || !response?.opened) {
      throw new Error(
        response?.message
          || 'No detectamos una segunda pantalla Android disponible para el visor del cliente.',
      );
    }

    if (options?.contextKey) {
      sessionStorage.setItem(`clic_pos_customer_display_${options.contextKey}_${mode}`, String(Date.now()));
    }

    return {
      opened: true,
      mode,
      url,
      usedSecondScreen: response.usedSecondScreen !== false,
    };
  }

  const placement = mode === 'NETWORK' ? null : await detectSecondaryDisplayPlacement();
  if (mode !== 'NETWORK' && !placement) {
    throw new Error(
      isAndroidRuntime()
        ? 'No detectamos una segunda pantalla real en este APK. No abriremos el visor sobre la pantalla principal.'
        : 'No detectamos una segunda pantalla disponible para HDMI/USB. Conecta el display externo e inténtalo de nuevo.',
    );
  }
  const features = buildDisplayWindowFeatures(placement);
  const target = mode === 'NETWORK' ? 'clic_pos_visor_network' : 'clic_pos_visor';

  const visorWindow = window.open(url, target, features);
  if (!visorWindow) {
    throw new Error(
      mode === 'NETWORK'
        ? 'No pudimos abrir el visor por IP. Revise la URL y permisos del navegador/aplicación.'
        : 'No pudimos abrir el visor en la segunda pantalla. Revise permisos de ventanas y que la pantalla externa esté conectada.',
    );
  }

  try {
    visorWindow.focus?.();
  } catch {
    // no-op
  }

  if (options?.contextKey) {
    sessionStorage.setItem(`clic_pos_customer_display_${options.contextKey}_${mode}`, String(Date.now()));
  }

  return {
    opened: true,
    mode,
    url,
    usedSecondScreen: Boolean(placement),
  };
};

export const maybeAutoLaunchCustomerDisplay = async (
  config: CustomerDisplayConfig | null | undefined,
  options?: { contextKey?: string },
): Promise<DisplayLaunchResult | null> => {
  if (typeof window === 'undefined' || !config?.isEnabled) return null;

  const normalized = normalizeCustomerDisplayConfig(config);
  const mode = normalizeCustomerDisplayConnectionType(normalized.connectionType);
  const contextKey = options?.contextKey || 'default';
  const sessionKey = `clic_pos_customer_display_${contextKey}_${mode}`;

  if (sessionStorage.getItem(sessionKey)) {
    return null;
  }

  if (mode === 'NETWORK' && !normalized.ipAddress) {
    return null;
  }

  try {
    return await launchCustomerDisplay(normalized, { contextKey });
  } catch (error) {
    console.warn('[customerDisplay] auto launch failed', error);
    return null;
  }
};
