# Constitución antirregresión del APK

## Ley no negociable

> Ningún APK de Alfa POS puede promoverse si empeora los contratos funcionales, la sincronización o los presupuestos operativos comprobados en 1.1.363.

Un APK que compila, está firmado o acepta `adb install -r` es solamente un **candidato**. Se considera aprobado cuando supera las puertas `prebuild` y `promote` contra la baseline versionada en [`qa/baselines/apk-1.1.363.json`](../qa/baselines/apk-1.1.363.json).

## Fuente de verdad

- `develop` es la única fuente oficial.
- La baseline 1.1.363 identifica el commit funcional, el merge que registró la versión, el certificado y los límites aprobados.
- Todo candidato debe contener el commit ancestro exigido por la baseline. Un release no puede omitir silenciosamente un hotfix anterior.
- La worktree firmada es solo para compilar. Debe estar limpia antes de comenzar.
- Solo puede existir un APK vigente en la salida canónica; los anteriores son evidencia y pertenecen al archivo de releases.

## Puerta 1: prebuild

Ejecutar en una worktree limpia basada en el candidato:

```bash
npm ci
npm run qa:release-gate -- --source-commit HEAD --require-clean
npm run build
```

Esta puerta bloquea el candidato si:

- no desciende de la baseline;
- disminuye `versionCode`;
- falta un contrato automatizado obligatorio;
- falla una prueba de sincronización, persistencia, PANCUVI, mesas, Toma de pedidos o red LAN.

El protocolo `scripts/release-android.sh` ejecuta esta puerta antes de modificar la versión y antes de iniciar Gradle.

## Puerta 2: promote

Después de construir e instalar el canario, copiar [`qa/release-evidence.template.json`](../qa/release-evidence.template.json), completar únicamente resultados observados y ejecutar:

```bash
npm run qa:release-promote -- --evidence /ruta/absoluta/release-evidence.json
```

La promoción se bloquea si falta una topología, contrato o dispositivo, si cambia el certificado, si la versión instalada difiere o si una métrica supera el presupuesto. Al aprobar, el gate guarda automáticamente `release-evidence.json.promotion-report.json` junto a la evidencia.

No se permite marcar valores `true` sin evidencia. Los seriales, comandos, timestamps, hashes y capturas deben conservarse junto al reporte de la release. Nunca guardar tokens, PIN, claves o secretos.

## Matriz mínima

Cada release debe comprobar:

1. Master autónomo, incluso sin clientes.
2. Master + Cliente mediante HTTP LAN.
3. Toma de pedidos vinculada explícitamente a su Master.
4. Actualización con `adb install -r`, conservando SQLite, identidad, pairing y configuración.
5. Reinicio en frío con datos existentes.

## Contratos protegidos

- Ventas y Mesas responden mientras sincroniza.
- Una mesa se libera al salir si no existe una operación activa y los cambios remotos aparecen oportunamente.
- Guardar pedido funciona con una orden válida.
- Toma de pedidos oculta Cierre X/Z y no solicita tipo de comprobante.
- El layout de restaurante conserva sus acciones en vertical.
- El nombre temporal de mesa puede agregarse y modificarse.
- Los usuarios/clientes de PANCUVI no se duplican al arrancar o rehidratar SQLite.
- Precio, impuesto y operaciones viajan POS→ERP y ERP→POS.
- Cada dominio permanece aislado: cambiar precio no cambia impuesto ni operaciones.
- Un snapshot no revierte una mutación pendiente o aplicada sin confirmación.
- La cola drena, las pulsaciones avanzan y no aparecen mutaciones espontáneas.

## Presupuestos operativos

Los límites viven en la baseline, no dispersos en documentación. La promoción exige:

- cero ANR y cero cierres;
- cero operaciones sin resolver y cero mutaciones espontáneas;
- drenaje de cola en hasta 120 segundos;
- pulsación con antigüedad máxima de 180 segundos;
- navegación Ventas↔Mesas p95 de hasta 500 ms;
- medición de tráfico en reposo de al menos 15 segundos;
- hasta 10 KiB recibidos y 10 KiB enviados durante esa ventana.

Cambiar un presupuesto requiere PR separado, evidencia comparativa y aprobación explícita. Nunca se relaja dentro del mismo PR que introduce la regresión.

## Configuración previa

Antes del QA físico, comprobar sin imprimir secretos:

- identidad y dispositivo autorizado coinciden;
- terminal activa y licencia vigente;
- Master seleccionado para Toma de pedidos;
- `/api/config` y el servicio protegido de sincronización son alcanzables desde el Cliente;
- `posCatalogEdits.enabled=true` únicamente en terminales autorizadas a modificar catálogo;
- pulsaciones recientes y cero pendientes inesperados.

Una configuración inválida se corrige y se repite el caso; no se descarta como si fuera una prueba aprobada.

## Rollout y reversión

1. Emulador.
2. Una terminal Cliente canario.
3. Master.
4. Clientes restantes, uno por uno.
5. Observación operativa antes de ampliar el despliegue.

Si falla el canario se detiene el rollout. Se conserva el APK firmado anterior para reversión y nunca se usa `uninstall`, `pm clear` ni downgrade destructivo.

## Gobierno

- El job de GitHub `apk-release-gate` debe configurarse como status check obligatorio para PRs hacia `develop`.
- Un cambio a esta constitución, baseline, gate o workflow requiere revisión explícita; no debe mezclarse con una feature funcional.
- La evidencia de promoción forma parte del reporte de release.
- Una excepción necesita autorización escrita, alcance, duración y plan de reversión. No crea precedente.
