# Canal de sincronización del ERP (Alfa-RMS)

Qué ERP usa esta caja, con qué capacidades cuenta y qué hacer cuando responde con error.
Documento operativo del corte a **Alfa-RMS**; complementa
[`APK_RELEASE_CONSTITUTION.md`](./APK_RELEASE_CONSTITUTION.md) (no cambia contratos de sync).

## 1. Base canónica

| Concepto | Valor |
| --- | --- |
| Base del canal de sync | `https://alfa-rms.vercel.app/api/sync` |
| Host del ERP (licencia) | `https://alfa-rms.vercel.app` |
| Supabase esperado (`GET /health` → `projectRef`) | `tcbleyxjwpopoierbkzo` |
| Host heredado (retirado) | `https://clic-erp.clicsuite.com` — sólo constante de referencia |

- Vive en `utils/erpBaseUrl.ts` (`DEFAULT_PUBLIC_ERP_BASE_URL`). Es la **única** fuente: el
  resto de módulos importa de ahí.
- Precedencia de overrides (`resolveErpBaseUrlCandidates`): `CLIC_ERP_BASE_URL` →
  `erp_base_url` → `CLIC_ERP_SYNC_URL` → `VITE_ERP_BASE_URL` → `VITE_ERP_SYNC_API_URL` →
  `VITE_SYNC_API_URL` → **default canónico**.
- `normalizeErpSyncApiBase` añade `/api/sync` una sola vez; `normalizeErpBaseUrl` lo quita.
- Una sola base por caja: nunca se leen clientes/promociones de un ERP y se reportan ventas
  a otro.

## 2. Capacidades: manda el ERP, no el host

`utils/erpCapabilities.ts` lee `GET {base}/version` y cachea el resultado **por sesión y por
base** (se invalida al cambiar de base o al detectar que el ERP rechazó el lote).

| Señal | Efecto en el POS |
| --- | --- |
| `capabilities.supports_batch_inbox === true` | `POST /inbox/batch` (lote durable, ≤50 eventos / 512 KB) |
| `false`, ausente o no booleano | **`POST /inbox` evento por evento** (Alfa-RMS hoy) |
| `/version` ilegible | se asume **sin lote** (nunca lote por el host) |
| `404 SYNC_BATCH_INBOX_DISABLED` al enviar el lote | se apaga el lote para la sesión y se reenvía evento por evento |

El evento de un solo `/inbox` usa el contrato del ERP (`event_id`, `event_type`, `payload`),
mapeado desde el evento durable del POS por `toErpInboxEvent`.

## 3. Diagnóstico de identidad

Al inicializar el adaptador se registra, sin secretos:

```
[ERP DIAG] base=https://alfa-rms.vercel.app/api/sync commit=<commit> projectRef=<ref> esperado=tcbleyxjwpopoierbkzo batch_inbox=no soportado
```

Si el `projectRef` no es el esperado se emite una **advertencia** (otro despliegue = otra base
de datos: confirmar antes de operar). Snapshot disponible por código con
`getErpCapabilitySnapshot()`.

## 4. Errores y acción de operador

`mapErpSyncError` traduce la respuesta del ERP (`utils/erpSyncContract.ts`):

| Código / señal | Estado | Acción |
| --- | --- | --- |
| `SYNC_TERMINAL_NOT_FOUND` | Terminal no vinculada a este ERP | Re-vincular cuando el ERP confirme la migración |
| `SYNC_TOKEN_MISSING`, `Invalid or missing sync token`, 401 | Token inválido | Re-vincular para regenerar el token |
| `DEVICE_SUPERSEDED`, `TERMINAL_WITHOUT_TENANT` | La terminal fue tomada por otro equipo | Re-vincular esta caja (registrar → autenticar) |
| `PULL_MASTERS_NOT_ALLOWED` | Terminal sin permiso de maestros | Reactivar la terminal en el ERP |
| `SYNC_BATCH_INBOX_DISABLED` | ERP sin lote | Ninguna: se envía por `/inbox` |
| `LICENSE_EXCEEDED_INACTIVE`, 403 | Licencia inactiva o cuota | Reactivar licencia |
| `TERMINAL_CONTEXT_REQUIRED` | Falta contexto de terminal | Re-vincular; si persiste, que el ERP asigne tenant |
| 429 / `RATE_LIMITED` | Saturación | Reintento con backoff (automático) |
| 404 de ruta sync | Función no publicada | Ninguna en caja: queda deshabilitada |
| Red / 5xx | Sin conexión o error del ERP | Reintento automático; la venta sigue local |

Los estados **terminales** no se reintentan en bucle: se corta el espejo hasta que el operador
actúe y la venta local continúa.

## 5. Verificación

```bash
# Contratos del corte (base canónica, guardia de host, capacidades, identidad, errores)
npx tsx --test tests/erpAlfaRmsContract.test.ts tests/erpBatchCapability.test.ts

# Contratos de sync que no deben romperse
npx tsx --test tests/syncLegacyEndpointAuth.test.ts tests/durableOutboxBatchSender.test.ts
```

La prueba `el host heredado no aparece en código de producción (guardia)` falla si alguien
vuelve a escribir `clic-erp.clicsuite.com` fuera de la constante de referencia de
`utils/erpBaseUrl.ts`.
