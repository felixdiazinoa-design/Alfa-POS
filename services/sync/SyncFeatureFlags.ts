export type SyncFeatureFlagName =
    | 'adaptive_polling'
    | 'sync_hint_v2'
    | 'heartbeat_v2'
    | 'private_realtime'
    | 'sqlite_outbox_v2'
    | 'pending_operations_recovery';

const DEFAULTS: Record<SyncFeatureFlagName, boolean> = {
    pending_operations_recovery: false,
    adaptive_polling: true,
    sync_hint_v2: true,
    heartbeat_v2: true,
    // Requires matching Supabase channel authorization before rollout.
    private_realtime: false,
    // POS-2A/POS-2B stay dark until the ERP batch receiver is deployed.
    sqlite_outbox_v2: false,
};

const ENV_KEYS: Record<SyncFeatureFlagName, string> = {
    pending_operations_recovery: 'VITE_PENDING_OPERATIONS_RECOVERY_ENABLED',
    adaptive_polling: 'VITE_ADAPTIVE_POLLING_ENABLED',
    sync_hint_v2: 'VITE_SYNC_HINT_V2_ENABLED',
    heartbeat_v2: 'VITE_HEARTBEAT_V2_ENABLED',
    private_realtime: 'VITE_PRIVATE_REALTIME_ENABLED',
    sqlite_outbox_v2: 'VITE_SQLITE_OUTBOX_V2_ENABLED',
};

const LOCAL_PREFIX = 'clic_pos_feature_';

const parseBoolean = (value: unknown): boolean | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
};

type SyncFeatureFlagInputs = {
    localValue: unknown;
    envValue: unknown;
    legacyPrivateEnvValue?: unknown;
};

export const resolveSyncFeatureFlagValue = (
    name: SyncFeatureFlagName,
    { localValue, envValue, legacyPrivateEnvValue }: SyncFeatureFlagInputs,
): boolean => {
    const parsedLocalValue = parseBoolean(localValue);
    const parsedEnvValue = parseBoolean(envValue);

    if (name === 'private_realtime') {
        // Production security policy is authoritative. A stale device override
        // must never downgrade a private-only Supabase project to public channels.
        return parsedEnvValue
            ?? parseBoolean(legacyPrivateEnvValue)
            ?? parsedLocalValue
            ?? DEFAULTS[name];
    }

    return parsedLocalValue ?? parsedEnvValue ?? DEFAULTS[name];
};

export const isSyncFeatureEnabled = (name: SyncFeatureFlagName): boolean => {
    // Keep the access statically analyzable so Vite replaces production flags in the bundle.
    // `import.meta.env` no existe fuera de Vite (tests en Node). Mismo patrón que
    // `utils/supabase.ts`: si falta, se usan los valores por defecto.
    const env = (import.meta as any).env || {};
    return resolveSyncFeatureFlagValue(name, {
        localValue: typeof localStorage !== 'undefined'
            ? localStorage.getItem(`${LOCAL_PREFIX}${name}`)
            : null,
        envValue: env[ENV_KEYS[name]],
        legacyPrivateEnvValue: env.VITE_SYNC_PRIVATE_REALTIME_ENABLED,
    });
};

export const setLocalSyncFeatureOverride = (name: SyncFeatureFlagName, enabled: boolean | null): void => {
    if (typeof localStorage === 'undefined') return;
    const key = `${LOCAL_PREFIX}${name}`;
    if (enabled === null) {
        localStorage.removeItem(key);
        return;
    }
    localStorage.setItem(key, String(enabled));
};
