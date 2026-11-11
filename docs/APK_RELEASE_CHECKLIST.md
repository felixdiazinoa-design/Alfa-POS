# Checklist operativo — APK release firmado (Alfa POS)

Guía para mejoras del APK móvil: dónde editar, dónde firmar, versión y validación.

Complementa este checklist con [docs/AGENT_RELEASE_PROTOCOL.md](./AGENT_RELEASE_PROTOCOL.md), que define la fuente de verdad, el gate de limpieza y cómo coordinar a Codex, Cursor y AG sin partir fixes entre varias worktrees.

La [Constitución antirregresión](./APK_RELEASE_CONSTITUTION.md) es obligatoria: todo APK debe superar las puertas `prebuild` y `promote` contra la baseline 1.1.363.

> **Alfa POS es un proyecto independiente de CLIC-POS.** No uses la worktree, el
> keystore ni los scripts de CLIC-POS: firma con otra clave y otro `applicationId`.

## Rutas de referencia

| Rol | Ruta |
|-----|------|
| **Repo principal (código + release)** | `/Users/felixdiaz/Documents/ChatGPT/Alfa-POS` |
| **Worktree de build (opcional)** | `_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite` (solo si existe) |
| **Salida APK release** | `<repo o worktree>/android/app/build/outputs/apk/release` |
| **Salida APK debug** | `<repo o worktree>/android/app/build/outputs/apk/debug` |
| **Metadata del último build** | `<repo o worktree>/android/app/build/outputs/apk/release/output-metadata.json` |
| **Keystore release** | `APK/keys/alfa-pos-release.keystore` (fuera de git) |
| **Configuración de firma** | `android/key.properties` (gitignored) |

En otros equipos, sustituye la base por tu clon. El checkout de build debe contener
`key.properties`, el keystore y `local.properties`.

---

## Checklist

1. **Trabajar código solo** en el repo principal (`Alfa-POS`).

   Si el fix se validó primero en una worktree de runtime, **formalízalo** en una rama/PR antes de llevarlo a release.

2. **La compilación firmada** se hace desde el **repo principal** o desde una worktree
   dedicada de Alfa POS. No hace falta una worktree si `android/key.properties` y el
   keystore están presentes; ambos viven fuera de git.

   El checkout de build no es un segundo lugar de desarrollo: solo compila.

3. **Antes de compilar**, asegúrate de que el checkout de build tiene **exactamente** el
   commit fuente del release. Si usas el repo principal, compila `HEAD` limpio.

4. **Gate duro antes del build**:

   ```bash
   git status --short
   ```

   Debe estar vacío. Si no lo está, detener el release y alinear la base.

   Ejecutar además la puerta automatizada antes de incrementar la versión:

   ```bash
   npm run qa:release-gate -- --source-commit HEAD --require-clean
   ```

5. **Firma válida** (no mover ni borrar el keystore):
   - `android/key.properties`
   - `APK/keys/alfa-pos-release.keystore`
   - Respalda el keystore y su contraseña en un gestor de contraseñas: **sin él no se
     pueden publicar actualizaciones**.

6. **Contador de versión** — no restaurar hacia atrás:
   - Tras decidir la nueva versión, actualizar `android/app/build.gradle` (`versionCode`, `versionName`) y **dejarlo persistido**.
   - Confirmar coherencia con `output-metadata.json` tras el build.
   - Si `build.gradle` y `output-metadata.json` difieren, usar `max(versionCode)` entre ambos y sumar 1 para el siguiente release.
   - Versión actual: `1412` / `1.1.412`.

7. **Compilación** (en orden):

   ```bash
   npm run build
   npx cap sync android
   cd android
   ./gradlew clean assembleRelease
   ```

   Para LAN (Master/Cliente en el puerto 3001) el release necesita cleartext:

   ```bash
   ./gradlew clean assembleRelease -PclicPosAllowReleaseCleartext=true
   ```

8. **Verificar firma del APK**:

   ```bash
   apksigner verify --print-certs <ruta-al.apk>
   ```

   Firma esperada (subject del certificado):

   `CN=Alfa POS, OU=Mobile, O=Alfa POS, L=Santo Domingo, ST=Distrito Nacional, C=DO`

   Si `apksigner` no está en el `PATH`, suele estar en  
   `$HOME/Library/Android/sdk/build-tools/<versión>/apksigner`.

9. **APK release** en la carpeta de salida (`Alfa-Pos-<versión>-release.apk`).

### Opción recomendada: script unificado

Si quieres forzar este protocolo sin depender de memoria, usa:

```bash
npm run android:release:protocol
```

Con worktree dedicada compila `origin/develop` por defecto; en el repo principal
compila el `HEAD` actual (haz checkout del commit que quieras publicar).

Si necesitas un commit o rama explícita del release:

```bash
./scripts/release-android.sh <git-ref>
```

Ejemplos:

```bash
./scripts/release-android.sh origin/develop
./scripts/release-android.sh 3582a13
./scripts/release-android.sh fix/sync-full-replace-soft-delete
```

El script:

- resuelve el checkout de build: `ALFA_POS_BUILD_WORKTREE`, o `_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite` si existe, o el **repo principal**
- exige que el checkout esté limpio
- en worktree dedicada fija el commit fuente (`checkout --detach`); en el repo principal compila `HEAD`
- lee el keystore desde `android/key.properties` (no lo codifica)
- calcula el siguiente `versionCode` de forma monotónica (incluye `APK/` y `_releases/`)
- compila, verifica el manifest, la firma y que el certificado sea `CN=Alfa POS`
- deja junto al APK:
  - `output-metadata-<version>.json`
  - `release-report-<version>.txt`

Variables útiles:

- `ALFA_POS_BUILD_WORKTREE` — ruta del checkout de build.
- `ALFA_POS_RELEASE_LAN_HTTP_ENABLED` — `true`/`false` para cleartext LAN (por defecto `true`).
- `ALFA_POS_RELEASE_CERT_CN` — CN esperado del certificado (por defecto `CN=Alfa POS`).

10. **Validar en dispositivo físico**:
   - Login vertical y horizontal
   - Activación de terminal
   - Ventas móvil
   - Catálogo móvil
   - Edición masiva móvil
   - Setup `MASTER + ERP`
   - Setup `MASTER + LOCAL_ONLY`
   - Setup `SLAVE + LOCAL_ONLY`
   - e-CF ya no se queda en `Nuevo`
   - crédito sin cliente se bloquea
   - crédito sobre límite pide autorización o bloquea según rol

    Completar `qa/release-evidence.template.json` con evidencia real y exigir:

    ```bash
    npm run qa:release-promote -- --evidence /ruta/absoluta/release-evidence.json
    ```

    Sin esta segunda puerta el APK sigue siendo candidato y no puede promoverse.

11. **Git**:
    - Crear rama desde `develop`
    - Commits pequeños con [Conventional Commits](https://www.conventionalcommits.org/)
    - Abrir PR hacia `develop`

12. **Reportar siempre** al final del release:
    - versión (`versionCode` / `versionName`)
    - commit fuente
    - PRs incluidos
    - smoke tests ejecutados

---

## Orden sugerido (versión + build)

1. Confirmar que `develop` (o la rama del release) está mergeada y limpia.
2. Leer versión actual en `android/app/build.gradle` y, si existe, en `output-metadata.json`.
3. Subir **una** versión coherente (`versionCode` / `versionName`) y commitearla.
4. Ejecutar el flujo de compilación (paso 7).
5. Verificar APK, firma (paso 8) y que `build.gradle` + `output-metadata.json` reflejan la misma versión.
