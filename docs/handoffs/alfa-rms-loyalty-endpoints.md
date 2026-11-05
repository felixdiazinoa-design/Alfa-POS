# Handoff → Alfa-RMS (ERP): endpoints de lealtad EGO Club

Documento para el hilo del ERP. El POS (CLIC-POS) ya tiene integrado el canal de
lealtad EGO Club y llama a **tres endpoints** bajo el canal de sync. Hoy esos
endpoints devuelven **404** (no publicados); este doc es para verificarlo y, si
falta, crearlos.

## Transporte (común a los 3)

- Base: `https://alfa-rms.vercel.app/api/sync` (canonical del binario).
- Ruta: `{base}/loyalty/{enroll|redeem|apply-sale-document}`.
- Método: `POST`, `Content-Type: application/json`.
- **Sin** `x-role-id` ni RBAC: es el canal de sync de la terminal, no el de
  `/api/settings/crm/loyalty/*`.
- El POS añade al body el contexto de la terminal (además de los campos propios):
  `tenant_id`, `company_ref`, `company_id`, `store_id`, `terminal_binding_id`, `device_id`.
- Headers de device: `x-device-id` (y el token de sync si aplica).
- Timeout del POS: ~15 s.

## Cómo verificar hoy

```bash
curl -s -i -X POST https://alfa-rms.vercel.app/api/sync/loyalty/redeem \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":"00000000-0000-0000-0000-000000000000","points":1,"reason":"probe"}'
```

- `404` → la ruta **no está publicada** (hay que crearla).
- `2xx` → ya existe; revisar el contrato de respuesta.

## 1. `POST /loyalty/enroll` — alta de socio

Body (además del contexto de terminal):

```json
{
  "nombre": "Ana Pérez",
  "cedula": "00112345678",
  "celular": "8095551234",
  "email": "ana@example.com",
  "birth_date": "1990-01-01",
  "registration_store_id": "<store_id>",
  "consents": [
    { "type": "TERMS", "granted": true },
    { "type": "PRIVACY", "granted": true },
    { "type": "EMAIL", "granted": true }
  ]
}
```

- `cedula` normalizada (solo dígitos), `celular` sin guiones, `email` en minúsculas.
- `consents[].type` = `TERMS` | `PRIVACY` | canal de marketing (`EMAIL`, `SMS`, …).
- **Idempotencia del lado del POS**: clave estable derivada de la cédula (se envía una vez).
- Respuesta esperada: cualquier `2xx` = éxito. Recomendado:
  `{"status":"success","customer_id":"<uuid>"}`.

## 2. `POST /loyalty/apply-sale-document` — devengo por venta

Body:

```json
{ "document_id": "<id local del documento de venta>" }
```

- **El ERP debe ser idempotente por `document_id`**: el POS encola una sola vez por
  documento, pero puede reenviar tras un reinicio/ACk perdido.
- El POS **no** calcula puntos: el devengo (base elegible, sin ITBIS/ofertas/tarjeta
  de regalo/wallet) lo decide el ERP.
- Respuesta esperada: `2xx` = éxito.

## 3. `POST /loyalty/redeem` — canje en el ticket

Body:

```json
{
  "customer_id": "<uuid>",
  "points": 1500,
  "reason": "Canje EGO Club"
}
```

Respuesta esperada (éxito):

```json
{ "status": "success", "snapshot": { "loyalty_points": 1500 } }
```

- `status` debe ser exactamente `"success"` (minúsculas, el POS lo normaliza).
- `snapshot` es el **saldo autoritativo tras el canje**. El POS lee el saldo de varias
  claves (`loyalty_points`, `points_balance`, `balance`, …) para ser tolerante.
- Rechazo: `{"status":"error","message":"..."}` — el POS muestra `message` y **no**
  aplica el descuento (fail-closed).
- El tope/mínimo de canje los calcula el POS con la config publicada por el ERP
  (`loyalty.tiers`, `redeemRate`, `minRedemptionUnits`), pero el **saldo** siempre lo
  dicta el ERP.

## Bandera del canal

El POS sólo llama a estos tres endpoints si la bandera de build
`VITE_ERP_SUPPORTS_LOYALTY_CHANNEL=true` está activa (default `false`). Con la bandera
apagada, la UI degrada ("no disponible en esta caja") y no se llama ni se encola nada.

## Lo que NO hace falta

- El POS no pide `GET` de saldo/estado: el saldo llega con el sync de clientes
  (`loyalty_points`/`tier`) y con el `snapshot` del canje.
- No se usa el endpoint RBAC `/api/settings/crm/loyalty/*`.
