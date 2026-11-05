/**
 * Diagnóstico mínimo del canal de lealtad EGO Club sobre la pila de sync de develop.
 *
 * Sustituye al `utils/erpDiagnostics` de la rama `main` (que dependía de una pila de
 * transporte propia) por una versión autocontenida que:
 *
 * - lee la bandera de build `VITE_ERP_SUPPORTS_LOYALTY_CHANNEL` (default `false`),
 * - recuerda en memoria qué rutas del canal están publicadas o no durante la sesión.
 *
 * El flag por defecto está apagado porque los endpoints `/api/sync/loyalty/*` todavía
 * no están publicados en Alfa-RMS: enroll/redeem/report degradan y la lealtad se
 * acumula por el evento de venta en `/inbox`.
 */

const unavailableRoutes = new Set<string>();

/** Bandera de build que habilita el canal de lealtad del ERP. */
export const isErpLoyaltyChannelFlagEnabled = (): boolean => {
    const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) || {};
    // En los scripts de verificación (tsx/Node) no existe `import.meta.env`: se lee también
    // de `process.env` para poder probar el camino en línea sin Vite.
    const raw = String(
        env.VITE_ERP_SUPPORTS_LOYALTY_CHANNEL
        ?? (typeof process !== 'undefined' ? process.env?.VITE_ERP_SUPPORTS_LOYALTY_CHANNEL : undefined)
        ?? '',
    ).trim().toLowerCase();
    return raw === 'true' || raw === '1';
};

export const markErpRouteAvailable = (route: string): void => {
    unavailableRoutes.delete(route);
};

export const markErpRouteUnavailable = (route: string, _reason?: string | null): void => {
    unavailableRoutes.add(route);
};

/** Estado de disponibilidad del canal para una ruta concreta. */
export const getLoyaltyChannelAvailability = (route: string): { enabled: boolean; reason: string | null } => {
    if (!isErpLoyaltyChannelFlagEnabled()) {
        return {
            enabled: false,
            reason: 'No disponible en esta caja: el canal de lealtad no está habilitado (ERP_SUPPORTS_LOYALTY_CHANNEL).',
        };
    }

    if (unavailableRoutes.has(route)) {
        return { enabled: false, reason: `El ERP todavía no publica ${route}.` };
    }

    return { enabled: true, reason: null };
};

/**
 * Guardia de tipo para los errores del transporte de sync de develop: un `Error` que
 * además lleva `status`, `code` o `payload` (ver `readJson` en `erpSyncLifecycle`).
 */
export const isErpSyncRequestError = (error: unknown): error is Error & {
    status?: number | null;
    code?: string | null;
    payload?: unknown;
} => {
    if (!(error instanceof Error)) return false;
    const record = error as Error & { status?: unknown; code?: unknown };
    return typeof record.status === 'number' || typeof record.code === 'string';
};
