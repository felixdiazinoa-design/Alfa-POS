# APK entregables

Esta carpeta guarda los APK que se compilan en este repositorio, para no tener que
buscarlos dentro de `android/app/build/` (Gradle puede borrar ese directorio).

El contenido se genera automáticamente; no se edita a mano y **no se versiona**
(solo este README queda en git).

## Cómo se llena

Cualquier compilación con Gradle copia su APK aquí al terminar:

```bash
npm run android:apk:debug      # APK debug
npm run android:apk:release    # APK release (requiere key.properties)
./scripts/release-android.sh   # release firmado del protocolo oficial (develop)
```

También se puede volcar a mano lo último compilado:

```bash
npm run android:apk:collect
```

## Qué se genera

| Archivo | Descripción |
|---------|-------------|
| `Clic-Pos-<versionName>-debug.apk` | APK de depuración (`assembleDebug`). |
| `Clic-Pos-<versionName>-release.apk` | APK de release (`assembleRelease`). |
| `Clic-Pos-<versionName>-<tipo>.apk.sha256` | Checksum SHA-256 del APK, para verificar la instalación. |
| `output-metadata*.json` | Metadata del build de release (versión y variante). |
| `release-report-<versionName>.txt` | Reporte del release firmado (`scripts/release-android.sh`). |

El nombre del APK lo define `android/app/build.gradle`:
`Clic-Pos-<versionName>-<buildType>.apk`.

## Instalar

```bash
adb install -r release/Clic-Pos-<versionName>-debug.apk
```

En el APK de release, `versionCode` debe ser mayor que el instalado; ver
[`docs/APK_RELEASE_CHECKLIST.md`](../docs/APK_RELEASE_CHECKLIST.md).

## Verificar el checksum

```bash
shasum -a 256 -c release/Clic-Pos-<versionName>-release.apk.sha256
```
