import { Capacitor } from '@capacitor/core';

/**
 * Base canónica del ERP para esta caja: **Alfa-RMS** (fuente de verdad de clientes,
 * promociones y lealtad). El host heredado (clic-ERP) se retira; se conserva sólo como
 * referencia para el diagnóstico y las pruebas de guardia, nunca como valor por defecto.
 */
export const DEFAULT_PUBLIC_ERP_BASE_URL = 'https://alfa-rms.vercel.app';

/** Host heredado, sólo referencia (diagnóstico + guardia de código). */
export const LEGACY_PUBLIC_ERP_BASE_URL = 'https://clic-erp.clicsuite.com';

/** projectRef del proyecto Supabase de Alfa-RMS, publicado por `GET /health`. */
export const EXPECTED_ERP_SUPABASE_PROJECT_REF = 'tcbleyxjwpopoierbkzo';

export const isNativeAndroidRuntime = (): boolean => {
    try {
        return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    } catch {
        return false;
    }
};

export const isLoopbackHost = (hostname: string): boolean => {
    const host = String(hostname || '').trim().toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

export const normalizeErpBaseUrl = (value?: string | null): string | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const withProtocol = /^https?:\/\//i.test(raw)
        ? raw
        : isNativeAndroidRuntime()
            ? `https://${raw}`
            : `${typeof window !== 'undefined' ? window.location.protocol : 'https:'}//${raw}`;

    try {
        const url = new URL(withProtocol);
        if (isNativeAndroidRuntime() && isLoopbackHost(url.hostname)) {
            return null;
        }
        return url
            .toString()
            .replace(/\/api\/sync\/?$/i, '')
            .replace(/\/api\/?$/i, '')
            .replace(/\/+$/, '');
    } catch {
        return null;
    }
};

export const normalizeErpSyncApiBase = (value?: string | null): string | null => {
    const base = normalizeErpBaseUrl(value);
    return base ? `${base}/api/sync` : null;
};

export const resolveErpBaseUrlCandidates = (): Array<string | null | undefined> => {
    const env = (import.meta as any)?.env || {};
    return [
        typeof localStorage !== 'undefined' ? localStorage.getItem('CLIC_ERP_BASE_URL') : null,
        typeof localStorage !== 'undefined' ? localStorage.getItem('erp_base_url') : null,
        typeof localStorage !== 'undefined' ? localStorage.getItem('CLIC_ERP_SYNC_URL') : null,
        env.VITE_ERP_BASE_URL,
        env.VITE_ERP_SYNC_API_URL,
        env.VITE_SYNC_API_URL,
        DEFAULT_PUBLIC_ERP_BASE_URL,
    ];
};

export const resolveErpBaseUrl = (): string | null => {
    for (const candidate of resolveErpBaseUrlCandidates()) {
        const normalized = normalizeErpBaseUrl(candidate);
        if (normalized) return normalized;
    }
    return null;
};

export const resolveErpSyncApiBase = (): string | null => {
    for (const candidate of resolveErpBaseUrlCandidates()) {
        const normalized = normalizeErpSyncApiBase(candidate);
        if (normalized) return normalized;
    }
    return null;
};
