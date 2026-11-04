# APK — compilación y entregables

Todo lo necesario para compilar, instalar y verificar el APK de CLIC-POS vive
aquí. El proyecto Gradle sigue en `android/` (Capacitor lo exige), pero ya no hay
que buscarlo: se compila desde esta carpeta y el resultado cae aquí mismo.

| Archivo | Qué es |
|---------|--------|
| `build-apk.sh` | Compila web + sincroniza Capacitor + ejecuta Gradle y deja el APK aquí. |
| `install-apk.sh` | Instala por ADB (verifica firma y ABI) con diagnóstico de errores. |
| `Clic-Pos-<versionName>-debug.apk` | APK de depuración, firmado con la clave debug. Instalable en emulador. |
| `Clic-Pos-<versionName>-release.apk` | APK release **solo si** existe `android/key.properties` (firma real). |
| `unsigned/` | APK release compilado sin keystore. **No es instalable** (Genymotion lo rechaza). |
| `logs/` | Log completo de cada compilación. |
| `*.sha256` | Checksum del APK para verificar el archivo. |

Los APK, logs y checksums están en `.gitignore`: esta carpeta versiona únicamente
este README y los dos scripts.

## Compilar

```bash
./APK/build-apk.sh                  # debug (por defecto)
./APK/build-apk.sh release          # release (necesita keystore para instalar)
./APK/build-apk.sh debug --skip-web # reutiliza dist/ ya compilado
npm run android:apk:debug           # equivalente al primero
```

Cada corrida deja el log en `APK/logs/build-<tipo>-<fecha>.log`.

## Instalar

```bash
./APK/install-apk.sh --launch          # instala el APK más reciente y abre la app
./APK/install-apk.sh --replace         # desinstala antes (borra datos locales)
./APK/install-apk.sh -s 127.0.0.1:6555 # elige Genymotion explícitamente
npm run android:apk:install            # equivalente al primero
```

Se usa ADB en lugar de arrastrar el archivo a Genymotion: el diálogo
*"An error occured while deploying the file. Please refer to Genymotion logs for
more information"* es genérico y casi siempre esconde una de estas causas, que el
script detecta y traduce:

| Causa real | Qué hacer |
|------------|-----------|
| APK **sin firma** (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`) | Usar el APK **debug**, o firmar el release con `scripts/release-android.sh`. |
| Firma distinta a la app instalada (`UPDATE_INCOMPATIBLE`) | `./APK/install-apk.sh --replace` (borra datos locales) o firmar con la misma clave. |
| `versionCode` menor al instalado (`VERSION_DOWNGRADE`) | Subir `versionCode` en `android/app/build.gradle`. |
| ABIs incompatibles (`NO_MATCHING_ABIS`) | El APK trae arm64-v8a, armeabi-v7a, x86 y x86_64; revisar el ABI del dispositivo. |
| Sin espacio (`INSUFFICIENT_STORAGE`) | Ampliar el disco del dispositivo virtual. |

Si el problema es de arranque (no de instalación), el script lo avisa al usar
`--launch`; el detalle está en:

```bash
adb logcat -d | grep -E 'FATAL|AndroidRuntime'
```

## Verificar el entregable

```bash
cd APK && shasum -a 256 -c Clic-Pos-<versionName>-debug.apk.sha256
```

## Release firmado (protocolo oficial)

El release firmado de producción **no** se compila desde esta carpeta: se genera
con el protocolo de worktree firmada, que exige keystore y pasa las puertas
antirregresión:

```bash
./scripts/release-android.sh    # → deja también el APK firmado en APK/
```

Ver [`docs/APK_RELEASE_CHECKLIST.md`](../docs/APK_RELEASE_CHECKLIST.md) y
[`docs/ANDROID_APK_SQLITE.md`](../docs/ANDROID_APK_SQLITE.md).
