# Publicar una release APK en el canal de Alfa POS

El POS consulta `https://alfa-admin-nine.vercel.app/api/pos-apk/latest` y ese endpoint lee
la tabla `landlord.pos_apk_releases` de Supabase (`release_status = 'available'`).
Publicar una versión son **dos pasos**: hospedar el binario y registrar la fila.

> El repositorio `Alfa-Admin` (incluido su deploy en Vercel y la base `landlord`) es otro
> proyecto: estos pasos se ejecutan **desde allí**, no desde `Alfa-POS`.

## Estado al escribir este documento

| Dato | Valor |
|------|-------|
| Última release publicada | `1.1.374` (1374) — el archivo servido es **`com.clicpos.app`** (APK de CLIC POS) |
| Release pendiente de publicar | `1.1.412` (1412) — `com.alfapos.app` |
| SHA-256 del APK 1.1.412 | `d9dced899f56abd1e19bee0c78334baf5df5601382dd28d7ac9d0c49391fab06` |
| Tamaño | 33 382 881 bytes |

Mientras la fila 1.1.374 sea la última `available`, cualquier POS con `versionCode ≥ 1374`
(es decir, todo Alfa POS actual) no recibe aviso de actualización. Es el comportamiento
seguro: mejor sin aviso que ofrecer la APK equivocada.

## 1. Hospedar el binario

El binario debe ser descargable por HTTPS sin autenticación. Opciones válidas:

- **`Alfa-Admin/public/apk/`** + deploy (es como se sirve `Clic-Pos-1.1.374-release.apk`):
  copiar `Alfa-Pos-1.1.412-release.apk` ahí y desplegar el proyecto `alfa-admin`.
- Supabase Storage o cualquier CDN con URL pública estable.

Verificar el archivo **descargándolo** (no solo que exista):

```bash
URL=https://alfa-admin-nine.vercel.app/apk/Alfa-Pos-1.1.412-release.apk
curl -sL "$URL" -o /tmp/alfa.apk
shasum -a 256 /tmp/alfa.apk     # d9dced89...91fab06
~/Library/Android/sdk/build-tools/35.0.0/aapt dump badging /tmp/alfa.apk | head -1
# package: name='com.alfapos.app' versionCode='1412' versionName='1.1.412'
```

Si el `package` no es `com.alfapos.app`, **no registrar la release**: el POS la rechaza
(`FOREIGN_RELEASE`) y, si el `package_name` faltara, se ofrecería un binario equivocado.

## 2. Registrar la release

Vía UI de Alfa-Admin (*APK releases*) o con SQL en `landlord`. SQL idempotente:

```sql
begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

insert into landlord.pos_apk_releases (
  version_name, version_code, apk_url, direct_download_url, checksum_sha256,
  changelog, release_type, release_status, summary, new_features,
  internal_changes, validation_checklist, install_notes, rollout_scope, is_latest
)
select
  '1.1.412', 1412,
  'https://alfa-admin-nine.vercel.app/apk/Alfa-Pos-1.1.412-release.apk',
  'https://alfa-admin-nine.vercel.app/apk/Alfa-Pos-1.1.412-release.apk',
  'd9dced899f56abd1e19bee0c78334baf5df5601382dd28d7ac9d0c49391fab06',
  'Corrige el canal de actualización: el POS consultaba el Cloud-Admin de CLIC-Suite y ofrecía la APK de CLIC POS (1.1.477). Ahora usa ALFA-Admin y rechaza binarios ajenos.',
  'fix', 'available',
  'Primera release de Alfa POS publicada en el canal de ALFA-Admin.',
  to_jsonb(array['Chequeo de actualización contra ALFA-Admin.']::text[]),
  to_jsonb(array['Rechazo de releases ajenas (package distinto de com.alfapos.app).']::text[]),
  to_jsonb(array[
    'npx tsc -b sin errores.',
    'tests/posApkUpdateContract 6/6 PASS.',
    'APK verificado: com.alfapos.app, versionCode 1412, firma CN=Alfa POS.'
  ]::text[]),
  'Android 7.0+ (minSdk 24). Instalar encima conservando datos.',
  'general', false
where not exists (
  select 1 from landlord.pos_apk_releases where version_code = 1412
);

-- Recalcular la versión vigente.
update landlord.pos_apk_releases
set is_latest = false, updated_at = timezone('utc'::text, now())
where is_latest;

update landlord.pos_apk_releases
set is_latest = true, updated_at = timezone('utc'::text, now())
where id = (
  select id from landlord.pos_apk_releases
  where release_status = 'available'
  order by version_code desc, published_at desc
  limit 1
);

commit;
```

> La service role key del Supabase de Alfa-Admin está rotada: las claves *legacy*
> (`service_role`/`anon`) fueron deshabilitadas el 2026-10-21. Usar la *secret key* nueva
> desde el dashboard o desde el deploy de Alfa-Admin, no el `.env.local` local.

## 3. Verificar el canal

```bash
curl -s https://alfa-admin-nine.vercel.app/api/pos-apk/latest |
  python3 -c "import json,sys; r=json.load(sys.stdin)['release']; print(r['version_name'], r['version_code'], r['direct_download_url'])"
```

Debe responder `1.1.412 1412 https://alfa-admin-nine.vercel.app/apk/Alfa-Pos-1.1.412-release.apk`.

Después, en un equipo con `1412` instalada no aparece aviso (misma versión). Para probar
el aviso, usar un `versionCode` menor al de la release publicada o el override de
desarrollo `localStorage.clic_pos_apk_local_version_code_override`.

## Qué NO hacer

- No apuntar el canal a `cloud-admin.clicsuite.com` ni `cloud-admin-gamma.vercel.app`:
  publican la APK de CLIC POS. El servicio remapea esos hosts y rechaza sus releases.
- No registrar una release con `apk_url` de CLIC-Suite ni con `package_name`
  `com.clicpos.app`.
