# Bloqueo de conteo de inventario (una PDA por almacén)

Una sola PDA puede tener un almacén en conteo. El bloqueo (claim) vive en el
Master y se renueva por heartbeat; el cliente solo reclama, renueva y libera.

## Por qué

Dos equipos contando el mismo almacén producen dos sesiones y, al aplicar los
ajustes, diferencias duplicadas. El bloqueo evita la concurrencia; la
idempotencia de recepción (`utils/receptionIdempotency.ts`) resuelve el problema
distinto de recibir dos veces el mismo documento.

## Modelo

`audit_sessions` (Master) guarda:

| Campo | Uso |
| --- | --- |
| `warehouseId` | almacén del conteo |
| `scopeKey` | alcance real: `warehouseId::<zona>` o `warehouseId::*` |
| `locationLabel` | zona elegida (vacío = almacén completo) |
| `status` | `OPEN`, `CLOSED`, `CANCELLED`, `EXPIRED`, `TAKEN_OVER` |
| `deviceId` / `terminalId` | dueño del bloqueo |
| `userId` / `userName` | quién cuenta (para el aviso en la otra PDA) |
| `startedAt` / `heartbeatAt` / `expiresAt` | vigencia |
| `takeoverReason` | motivo de la toma de control |

- **El bloqueo es por `scopeKey`**: dos PDAs pueden contar zonas distintas del
  mismo almacén a la vez; la misma zona no.
- La zona se identifica por su **nombre normalizado** (minúsculas, sin acentos,
  espacios colapsados) en `utils/inventoryScope.ts`, no por un id local. Así dos
  PDAs con catálogos independientes coinciden al escribir la misma zona.
- **TTL = 15 min**, heartbeat cada 60 s. Si la PDA muere, el alcance se libera solo.
- El claim es **idempotente por dispositivo**: la misma PDA que reintenta obtiene
  su sesión en lugar de un conflicto.
- **Toma de control** explícita (`force` + `reason`) para cambio de turno o equipo
  bloqueado; queda registrada en `takeoverReason`.

## Catálogo de ubicaciones

Colección local `locations` (`InventoryLocation`: `warehouseId`, `name`, `code`,
`type`), gestionada desde el selector de la pantalla de conteo. Si un almacén no
tiene ubicaciones se cuenta el almacén completo. El catálogo **no se sincroniza
todavía** con el ERP: el bloqueo funciona por nombre aunque cada PDA tenga el suyo.

## Endpoints

| Método | Ruta | Efecto |
| --- | --- | --- |
| `GET` | `/api/audit/active/:warehouseId` | sesión abierta + titular (o `null`) |
| `POST` | `/api/audit/start` | reclama el `scopeKey`; `409 AUDIT_SESSION_IN_PROGRESS` con `holder` si está ocupado |
| `POST` | `/api/audit/:sessionId/heartbeat` | renueva; `409` si otra PDA tomó el control |
| `POST` | `/api/audit/:sessionId/release` | libera (dueño o `force`) |

Implementado en dos runtimes:

- **Node** (`server/routes/auditRoutes.ts`) — modo laboratorio/ERP local.
- **Android Master** (`native-stubs/android/ClicPOSMasterHttpServer.kt`) — sesiones
  en memoria con TTL, claim dentro de `synchronized` para evitar carreras.

## Comportamiento en la PDA

`hooks/useInventoryCountClaim.ts` expone el estado:

| Estado | UI | Conteo permitido |
| --- | --- | --- |
| `CLAIMED` | “<zona> reservado para esta PDA” | sí |
| `BLOCKED` | pantalla con el titular + **Tomar el control** (pide motivo) | no |
| `UNSUPPORTED` | aviso: el master no bloquea | sí (sin exclusividad) |
| `UNAVAILABLE` | aviso: sin conexión con el master | sí (sin exclusividad) |

`DISABLED`: el conteo se abrió sin almacén identificado.

Antes de reclamar, `InventoryScopePicker` pregunta **dónde** se va a contar
(almacén completo o una ubicación) y permite crear ubicaciones en el momento.

Al guardar, el conteo se encola con `claimSessionId` y `locationLabel`, se empuja
al Master si hay red y se libera el bloqueo.

## Límites conocidos

- **Sin red no hay bloqueo**: la PDA puede contar offline y el Master solo puede
  detectar el conflicto al sincronizar. Es una decisión deliberada para no
  bloquear la operación.
- **El stock sigue siendo por almacén**: el catálogo `locations` identifica zonas
  para el conteo, pero `productStocks` y el kardex no se abren por ubicación
  todavía. Un conteo por zona ajusta el total del almacén.
- **El catálogo de ubicaciones no se sincroniza** con el ERP; el bloqueo funciona
  por nombre normalizado, no por id.
- El bloqueo **no** valida el estado del documento de recepción en el Master;
  eso sigue pendiente para el flujo de OC/traspasos.
