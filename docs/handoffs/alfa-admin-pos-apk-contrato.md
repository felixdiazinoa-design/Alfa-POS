# Handoff → ALFA-Admin: contrato con CLIC-POS

Documento para el hilo que trabaja en **ALFA-Admin** (`https://alfa-admin-nine.vercel.app`).

> Ojo: existen dos proyectos Vercel llamados `alfa-admin`. El del canal del POS es
> **`alfa-admin-nine.vercel.app`** (team `alfa-rms`, Supabase `tcble…`).
> `alfa-admin-eta.vercel.app` pertenece a otro team y está desactualizado (sin
> `/apk` ni `/apk-pos`): no usarlo.
Describe exactamente lo que la caja (APK CLIC-POS) espera de ese panel, verificado
contra el código del POS el 2026-11-04.

## Contexto

- POS = APK Android (Capacitor, WebView). Compila `1.1.373` / `versionCode 1373`,
  el **primer** APK de ALFA-Admin.
- El POS consulta el registro de APK **al arrancar** (timeout 3.5 s) y desde
  Configuración ("Buscar actualización", timeout 5 s).
- Hasta ahora el POS consultaba Cloud-Admin (`cloud-admin.clicsuite.com`), que
  publica `1.1.405` (1405): por eso una caja recién compilada ofrecía
  "nueva versión disponible" contra otro panel. El POS ya fue reconfigurado para
  usar ALFA-Admin (`VITE_ALFA_ADMIN_BASE_URL`), pero **ALFA-Admin todavía no
  publica ningún release**.

## 1. Obligatorio — `GET /api/pos-apk/latest`

Requisitos:

- Público: **sin autenticación** (el POS no envía tokens ni cookies).
- Método `GET`, respuesta **JSON** (si responde HTML, el POS descarta la validación).
- Responder en **menos de 3.5 s** (si tarda más, el POS lo ignora en silencio).
- CORS abierto para el origen del WebView (`Origin: https://localhost` en el APK)
  y para el origen web de desarrollo.
- `Cache-Control: no-store` (el POS pide `cache: 'no-store'`).

Respuesta esperada (mismo contrato que Cloud-Admin):

```json
{
  "status": "ok",
  "release": {
    "version_name": "1.1.373",
    "version_code": 1373,
    "apk_url": "https://…/Clic-Pos-1.1.373-release.apk",
    "direct_download_url": "https://…/Clic-Pos-1.1.373-release.apk",
    "checksum_sha256": "<sha256 del archivo publicado>",
    "changelog": "Primer APK de ALFA-Admin.",
    "published_at": "2026-11-04T18:00:00.000000+00:00"
  }
}
```

Reglas:

- `release: null` es **válido** (significa "no hay release publicado"). Es lo que
  responde hoy y ya evita el falso aviso.
- `version_code` debe ser un entero > 0: es el único campo que decide si hay
  actualización (`remoto > local`, comparación estricta). Publicar 1373 en un
  equipo con 1373 **no** genera aviso.
- Devuelve siempre el release con **mayor** `version_code` entre los publicados.
- Campos que el POS consume: `version_name`, `version_code`, `apk_url`,
  `direct_download_url` (tiene prioridad sobre `apk_url`), `changelog`,
  `published_at`. Cualquier otro campo (`release_type`, `summary`, `bugs_fixed`…)
  se ignora hoy: se puede seguir enviando sin coste.

## 2. Obligatorio — `GET /apk-pos`

Página pública de descarga (portal). El POS abre esta URL desde el banner y desde
Configuración. No requiere contrato de datos, sólo existir y ofrecer el APK.

## 3. El archivo APK

- URL **directa y pública** (o accesible desde la red de la caja), sin auth.
- `Content-Type: application/vnd.android.package-archive`.
- **Misma firma** que el APK instalado en las cajas. Si cambia la clave, el equipo
  no podrá actualizar encima (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) y habrá que
  desinstalar, perdiendo datos locales.
- `checksum_sha256` debe corresponder al archivo publicado. Hoy el POS lo guarda
  pero **no lo verifica** antes de instalar: sirve para auditoría y para futuras
  validaciones.

## 4. Criterios de aceptación

```bash
# 1) El endpoint existe y es JSON
curl -s -i https://alfa-admin-nine.vercel.app/api/pos-apk/latest

# 2) CORS para el origen del WebView del APK
curl -s -i -H 'Origin: https://localhost' \
  https://alfa-admin-nine.vercel.app/api/pos-apk/latest | grep -i access-control

# 3) Tras publicar el release 1.1.373
curl -s https://alfa-admin-nine.vercel.app/api/pos-apk/latest \
  | python3 -m json.tool
```

Estado esperado:

| Momento | `release` | Efecto en la caja |
|---------|-----------|-------------------|
| Hoy (sin publicar) | `null` | Sin aviso de actualización (`NO_RELEASE`) |
| Tras publicar 1373 | objeto con `version_code: 1373` | Sin aviso (equipo ya está en 1373) |
| Tras publicar 1374+ | objeto con `version_code` mayor | Banner "Nueva versión disponible" con `Origen: alfa-admin-nine.vercel.app` |

## 5. Decisión pendiente — `/api/activation`

Hoy `https://alfa-admin-nine.vercel.app/api/activation` responde **404**. El POS
**no** lo usa: la activación la resuelve el ERP (`alfa-rms.vercel.app`) vía
`/api/sync/bootstrap/check` y `/api/sync/terminals`.

Confirmar una de estas dos opciones:

1. **No aplica**: ALFA-Admin no implementa activación → no hay que hacer nada.
2. **Sí aplica**: replicar el contrato de Cloud-Admin (`/api/activation/…`).
   En ese caso hay que avisar al POS para definir
   `VITE_ACTIVATION_API_BASE_URL=https://alfa-admin-nine.vercel.app/api/activation`.

## 6. Relacionado (sólo si entra en tu alcance) — vinculación tenant/empresa

En la pantalla de activación la caja muestra *"Tenant no identificado"*, *"No hay
terminales disponibles"* y el error:

> `ERP https://alfa-rms.vercel.app/api/sync/bootstrap/check: No se encontró una
> empresa vinculada para esta validación`

Endpoints que consume el POS y que hoy no resuelven empresa/terminales:

| Llamada | Body / query | Respuesta esperada |
|---------|--------------|--------------------|
| `POST {ERP}/api/sync/bootstrap/check` | `{ tenant_id, company_ref, email, device_id }` | `{ status: "success", tenant: { id, name }, company: { id }, store: { id } }` |
| `GET {ERP}/api/sync/terminals` | `?tenant_id=&company_id=&store_id=` | `{ terminals: [ … ] }` |
| `POST {ERP}/api/sync/terminals/register` | registro de la caja | alta de la terminal |

Falta vincular la empresa (`company_ref`) al tenant con el que se activa la caja,
y que esa empresa tenga terminales creadas y operativas.

## Lo que NO hace falta implementar

- No hay webhook ni push: el POS consulta bajo demanda.
- No hay API de subida de APK: el release se puede registrar/publicar manualmente.
- No se requiere token, sesión ni credencial para `/api/pos-apk/latest`.
