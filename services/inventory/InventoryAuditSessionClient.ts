import { resolveOperationalApiUrl } from '../../utils/masterOperationalApi';

/**
 * Cliente del bloqueo de conteo de inventario.
 *
 * Una sola PDA puede tener un almacén en conteo. El bloqueo vive en el Master
 * (servidor Node o servidor HTTP nativo de la APK) y se renueva con heartbeat;
 * el cliente solo reclama, renueva y libera.
 */

export interface AuditSessionHolder {
  id: string;
  warehouseId: string;
  startedAt: string;
  status?: string;
  expiresAt?: string | null;
  heartbeatAt?: string | null;
  deviceId?: string | null;
  terminalId?: string | null;
  userId?: string | null;
  userName?: string | null;
  scopeKey?: string | null;
  locationLabel?: string | null;
}

export interface AuditClaimInput {
  warehouseId: string;
  deviceId: string;
  terminalId?: string | null;
  userId?: string | null;
  userName?: string | null;
  scopeKey?: string | null;
  locationLabel?: string | null;
  force?: boolean;
  reason?: string | null;
}

export interface AuditClaimResult {
  session: AuditSessionHolder;
  reused: boolean;
}

export class AuditSessionConflictError extends Error {
  readonly code = 'AUDIT_SESSION_IN_PROGRESS';

  constructor(
    readonly holder: AuditSessionHolder | null,
    message = 'El almacén está en conteo por otro equipo.',
  ) {
    super(message);
    this.name = 'AuditSessionConflictError';
  }
}

export class AuditSessionUnsupportedError extends Error {
  readonly code = 'AUDIT_SESSION_UNSUPPORTED';

  constructor(message = 'Este Master no soporta el bloqueo de conteo.') {
    super(message);
    this.name = 'AuditSessionUnsupportedError';
  }
}

export class AuditSessionUnavailableError extends Error {
  readonly code = 'AUDIT_SESSION_UNAVAILABLE';

  constructor(message = 'No se pudo contactar al Master para reservar el almacén.') {
    super(message);
    this.name = 'AuditSessionUnavailableError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 4000;

const readJson = async (response: Response): Promise<any> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export class InventoryAuditSessionClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {}) {
    const resolved = options.baseUrl ?? resolveOperationalApiUrl('/api/audit');
    this.baseUrl = resolved.replace(/\/+$/, '');

    const candidate = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!candidate) throw new AuditSessionUnavailableError('fetch no está disponible en este runtime.');

    this.fetchImpl = candidate;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(path: string, init: RequestInit = {}): Promise<{ status: number; data: any }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });

      return { status: response.status, data: await readJson(response) };
    } catch (error) {
      throw new AuditSessionUnavailableError(
        error instanceof Error && error.name === 'AbortError'
          ? 'El Master no respondió a tiempo al reservar el almacén.'
          : undefined,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private toSession(raw: any, fallback: Partial<AuditSessionHolder>): AuditSessionHolder {
    return {
      id: String(raw?.id ?? raw?.sessionId ?? fallback.id ?? ''),
      warehouseId: String(raw?.warehouseId ?? fallback.warehouseId ?? ''),
      startedAt: String(raw?.startedAt ?? fallback.startedAt ?? new Date().toISOString()),
      status: raw?.status,
      expiresAt: raw?.expiresAt ?? null,
      heartbeatAt: raw?.heartbeatAt ?? null,
      deviceId: raw?.deviceId ?? null,
      terminalId: raw?.terminalId ?? null,
      userId: raw?.userId ?? null,
      userName: raw?.userName ?? null,
      scopeKey: raw?.scopeKey ?? null,
      locationLabel: raw?.locationLabel ?? null,
    };
  }

  async getActive(warehouseId: string): Promise<{ session: AuditSessionHolder | null; items: unknown[] }> {
    const { status, data } = await this.request(`/active/${encodeURIComponent(warehouseId)}`);

    if (status === 404) throw new AuditSessionUnsupportedError();
    if (status === 401 || status === 403) {
      throw new AuditSessionUnavailableError('El Master rechazó la consulta del almacén.');
    }
    if (status !== 200) {
      throw new AuditSessionUnavailableError(data?.message || 'No se pudo consultar el estado del almacén.');
    }

    return {
      session: data?.session ? this.toSession(data.session, { warehouseId }) : null,
      items: Array.isArray(data?.items) ? data.items : [],
    };
  }

  async start(input: AuditClaimInput): Promise<AuditClaimResult> {
    const { status, data } = await this.request('/start', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (status === 404) throw new AuditSessionUnsupportedError();
    if (status === 409) {
      throw new AuditSessionConflictError(
        data?.holder ? this.toSession(data.holder, { warehouseId: input.warehouseId }) : null,
        data?.message,
      );
    }
    if (status !== 200 || data?.success === false) {
      throw new AuditSessionUnavailableError(data?.message || 'No se pudo reservar el almacén.');
    }

    return {
      session: this.toSession(data?.session, {
        id: data?.sessionId,
        warehouseId: input.warehouseId,
        startedAt: data?.startedAt,
        deviceId: input.deviceId,
        terminalId: input.terminalId ?? null,
        userId: input.userId ?? null,
        userName: input.userName ?? null,
      }),
      reused: Boolean(data?.reused),
    };
  }

  /**
   * Reclama el alcance (almacén + ubicación). El Master decide: reutiliza la
   * sesión del mismo dispositivo, o responde 409 con el titular del bloqueo.
   */
  async claim(input: AuditClaimInput): Promise<AuditClaimResult> {
    return this.start(input);
  }

  async takeOver(input: AuditClaimInput & { reason?: string }): Promise<AuditClaimResult> {
    return this.start({ ...input, force: true });
  }

  async heartbeat(sessionId: string, deviceId: string): Promise<void> {
    const { status, data } = await this.request(`/${encodeURIComponent(sessionId)}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });

    if (status === 404) throw new AuditSessionUnsupportedError();
    if (status === 409) {
      throw new AuditSessionConflictError(
        data?.holder ? this.toSession(data.holder, { id: sessionId, warehouseId: '' }) : null,
        data?.message,
      );
    }
    if (status !== 200) {
      throw new AuditSessionUnavailableError(data?.message || 'No se pudo renovar el bloqueo.');
    }
  }

  async release(sessionId: string, deviceId: string, options: { force?: boolean; reason?: string } = {}): Promise<void> {
    const { status, data } = await this.request(`/${encodeURIComponent(sessionId)}/release`, {
      method: 'POST',
      body: JSON.stringify({ deviceId, force: Boolean(options.force), reason: options.reason ?? null }),
    });

    if (status === 404) throw new AuditSessionUnsupportedError();
    if (status === 409) {
      throw new AuditSessionConflictError(
        data?.holder ? this.toSession(data.holder, { id: sessionId, warehouseId: '' }) : null,
        data?.message,
      );
    }
    if (status !== 200) {
      throw new AuditSessionUnavailableError(data?.message || 'No se pudo liberar el almacén.');
    }
  }
}
