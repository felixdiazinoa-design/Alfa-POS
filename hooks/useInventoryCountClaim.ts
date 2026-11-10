import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuditSessionConflictError,
  AuditSessionUnsupportedError,
  InventoryAuditSessionClient,
  type AuditSessionHolder,
} from '../services/inventory/InventoryAuditSessionClient';
import { resolveOrCreateLocalDeviceId } from '../utils/deviceRevocation';
import { buildInventoryScopeKey, inventoryScopeDisplayLabel } from '../utils/inventoryScope';

export type InventoryClaimState =
  | 'DISABLED'
  | 'CHECKING'
  | 'CLAIMED'
  | 'BLOCKED'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE';

interface UseInventoryCountClaimOptions {
  warehouseId?: string | null;
  /** Zona/ubicación contada. Vacío = almacén completo. */
  locationLabel?: string | null;
  terminalId?: string | null;
  userId?: string | null;
  userName?: string | null;
  enabled?: boolean;
  heartbeatMs?: number;
  client?: InventoryAuditSessionClient;
}

const HEARTBEAT_MS = 60_000;

/**
 * Reserva el almacén para esta PDA antes de contar.
 *
 * - `CLAIMED`: el almacén es de esta sesión (heartbeat activo).
 * - `BLOCKED`: otra PDA lo tiene tomado; se puede tomar el control con motivo.
 * - `UNSUPPORTED` / `UNAVAILABLE`: el Master no expone o no responde; se permite
 *   contar pero sin exclusividad (no se bloquea la operación offline).
 */
export const useInventoryCountClaim = ({
  warehouseId,
  locationLabel = null,
  terminalId,
  userId,
  userName,
  enabled = true,
  heartbeatMs = HEARTBEAT_MS,
  client,
}: UseInventoryCountClaimOptions = {}) => {
  const deviceIdRef = useRef<string>('');
  if (!deviceIdRef.current) {
    try {
      deviceIdRef.current = resolveOrCreateLocalDeviceId();
    } catch {
      deviceIdRef.current = 'device-unknown';
    }
  }

  const clientRef = useRef<InventoryAuditSessionClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = client || new InventoryAuditSessionClient();
  }

  const sessionRef = useRef<AuditSessionHolder | null>(null);
  const mountedRef = useRef(true);

  const [state, setState] = useState<InventoryClaimState>(
    enabled && warehouseId ? 'CHECKING' : 'DISABLED',
  );
  const [session, setSession] = useState<AuditSessionHolder | null>(null);
  const [holder, setHolder] = useState<AuditSessionHolder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const storeSession = useCallback((next: AuditSessionHolder | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const claimInput = useCallback(() => ({
    warehouseId: String(warehouseId || ''),
    deviceId: deviceIdRef.current,
    terminalId: terminalId ?? null,
    userId: userId ?? null,
    userName: userName ?? null,
    scopeKey: buildInventoryScopeKey(warehouseId, locationLabel),
    locationLabel: String(locationLabel || '').trim() || null,
  }), [locationLabel, terminalId, userId, userName, warehouseId]);

  const claim = useCallback(async () => {
    if (!enabled || !warehouseId) {
      setState('DISABLED');
      return;
    }

    setState('CHECKING');
    setError(null);

    try {
      const result = await clientRef.current!.claim(claimInput());
      storeSession(result.session);
      setHolder(null);
      setState('CLAIMED');
    } catch (caught) {
      storeSession(null);

      if (caught instanceof AuditSessionConflictError) {
        setHolder(caught.holder);
        setState('BLOCKED');
      } else if (caught instanceof AuditSessionUnsupportedError) {
        setState('UNSUPPORTED');
      } else {
        setError(caught instanceof Error ? caught.message : 'No se pudo reservar el almacén.');
        setState('UNAVAILABLE');
      }
    }
  }, [claimInput, enabled, storeSession, warehouseId]);

  useEffect(() => {
    if (!enabled || !warehouseId) {
      setState('DISABLED');
      storeSession(null);
      return;
    }

    void claim();
  }, [claim, enabled, storeSession, warehouseId]);

  const takeOver = useCallback(async (reason: string) => {
    if (!warehouseId || !String(reason || '').trim()) return false;

    setState('CHECKING');
    setError(null);

    try {
      const result = await clientRef.current!.takeOver({ ...claimInput(), reason: String(reason).trim() });
      storeSession(result.session);
      setHolder(null);
      setState('CLAIMED');
      return true;
    } catch (caught) {
      if (caught instanceof AuditSessionConflictError) {
        setHolder(caught.holder);
        setState('BLOCKED');
      } else if (caught instanceof AuditSessionUnsupportedError) {
        setState('UNSUPPORTED');
      } else {
        setError(caught instanceof Error ? caught.message : 'No se pudo tomar el control del almacén.');
        setState('UNAVAILABLE');
      }
      return false;
    }
  }, [claimInput, storeSession, warehouseId]);

  const release = useCallback(async (options: { force?: boolean; reason?: string } = {}) => {
    const current = sessionRef.current;
    storeSession(null);
    setState(enabled && warehouseId ? 'CHECKING' : 'DISABLED');

    if (!current) return;

    try {
      await clientRef.current!.release(current.id, deviceIdRef.current, options);
    } catch {
      // Si falla, el TTL del Master libera el almacén.
    }
  }, [enabled, storeSession, warehouseId]);

  // Renueva el bloqueo mientras el conteo sigue abierto.
  useEffect(() => {
    if (state !== 'CLAIMED') return;

    const timer = setInterval(() => {
      const current = sessionRef.current;
      if (!current) return;

      clientRef.current!.heartbeat(current.id, deviceIdRef.current).catch((caught) => {
        if (!mountedRef.current) return;
        if (caught instanceof AuditSessionConflictError) {
          storeSession(null);
          setHolder(caught.holder);
          setState('BLOCKED');
        }
      });
    }, heartbeatMs);

    return () => clearInterval(timer);
  }, [heartbeatMs, state, storeSession]);

  // Libera al salir de la pantalla de conteo.
  useEffect(() => () => {
    const current = sessionRef.current;
    sessionRef.current = null;
    if (!current) return;
    void clientRef.current!.release(current.id, deviceIdRef.current).catch(() => undefined);
  }, []);

  return {
    state,
    session,
    holder,
    error,
    deviceId: deviceIdRef.current,
    scopeKey: buildInventoryScopeKey(warehouseId, locationLabel),
    scopeLabel: inventoryScopeDisplayLabel(locationLabel),
    isClaimed: state === 'CLAIMED',
    claim,
    takeOver,
    release,
  };
};
