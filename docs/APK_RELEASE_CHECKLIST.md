# Checklist operativo — APK release firmado (CLIC-POS)

Guía para mejoras del APK móvil: dónde editar, dónde firmar, versión y validación.

Complementa este checklist con [docs/AGENT_RELEASE_PROTOCOL.md](./AGENT_RELEASE_PROTOCOL.md), que define la fuente de verdad, el gate de limpieza y cómo coordinar a Codex, Cursor y AG sin partir fixes entre varias worktrees.

La [Constitución antirregresión](./APK_RELEASE_CONSTITUTION.md) es obligatoria: todo APK debe superar las puertas `prebuild` y `promote` contra la baseline 1.1.363.

## Rutas de referencia

| Rol | Ruta |
|-----|------|
| **Repo principal (solo código)** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS` |
| **Worktree firmado (único sitio de release)** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **Salida APK release** | `<worktree>/android/app/build/outputs/apk/release` |
| **Salida APK debug** | `<worktree>/android/app/build/outputs/apk/debug` (misma convención de nombres que `build.gradle`) |
| **Entregables dentro del repo** | `<repo>/release` — `gradlew assembleDebug/assembleRelease` copia ahí cada APK con su `.sha256` |
| **Metadata del último build** | `<worktree>/android/app/build/outputs/apk/release/output-metadata.json` |

En otros equipos, sustituye la parte base por tu clon; el worktree firmado debe ser el checkout que contiene `key.properties` y el keystore (ver abajo).

---

## Checklist

1. **Trabajar código solo** en el repo principal (`CLIC-POS`).

   Si el fix se validó primero en una worktree de runtime, **formalízalo** en una rama/PR antes de llevarlo a release.

2. **No compilar release firmado** desde el repo principal si ahí no está la configuración de firma completa. El **APK release firmado se genera siempre** desde el worktree `CLIC-POS-mobile-sqlite`.

   Ese worktree es **solo-build**; no es un segundo lugar de desarrollo.

3. **Antes de compilar**, copiar al worktree firmado **únicamente los archivos modificados** respecto al trabajo en el principal (por ejemplo: `git diff --name-only` en el repo principal y copiar esas rutas al worktree).

   Mejor aún: alinear la worktree firmada al **commit fuente exacto** del release y evitar copias manuales salvo archivos de firma.

4. **Gate duro antes del build**:

   ```bash
   git status --short
   ```

   Debe estar vacío. Si no lo está, detener el release y alinear la base.

   Ejecutar además la puerta automatizada antes de incrementar la versión:

   ```bash
   npm run qa:release-gate -- --source-commit HEAD --require-clean
   ```

5. **Firma válida** (solo en el worktree firmado; no mover ni borrar el keystore):
   - `android/key.properties`
   - `android/keys/clic-pos-release.keystore`

6. **Contador de versión** — no restaurar hacia atrás:
   - Tras decidir la nueva versión, actualizar `android/app/build.gradle` (`versionCode`, `versionName`) en el worktree y **dejarlo persistido**.
   - Confirmar coherencia con `output-metadata.json` tras el build.
   - Si `build.gradle` y `output-metadata.json` difieren, usar `max(versionCode)` entre ambos y sumar 1 para el siguiente release.

7. **Compilación en el worktree firmado** (en orden):

   ```bash
   npm run build
   npx cap sync android
   cd android
   ./gradlew clean assembleRelease
   ```

8. **Verificar firma del APK**:

   ```bash
   apksigner verify --print-certs <ruta-al.apk>
   ```

   Firma esperada (subject del certificado):

   `CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO`

   Si `apksigner` no está en el `PATH`, suele estar en  
   `$HOME/Library/Android/sdk/build-tools/<versión>/apksigner`.

9. **APK release** en la carpeta de salida del worktree (punto “Rutas de referencia”).

### Opción recomendada: script unificado

Si quieres forzar este protocolo sin depender de memoria, usa:

```bash
npm run android:release:protocol
```

Por defecto compila desde `origin/develop`.

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

- verifica que la worktree canónica esté limpia
- crea una worktree temporal limpia alineada al commit fuente
- copia firma y `local.properties`
- calcula el siguiente `versionCode` de forma monotónica
- compila y verifica firma
- deja junto al APK:
  - `output-metadata-<version>.json`
  - `release-report-<version>.txt`

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

## Orden sugerido (copia + versión + build)

1. Copiar archivos modificados al worktree.
2. Leer versión actual en `android/app/build.gradle` y, si existe, en `output-metadata.json`.
3. Subir **una** versión coherente (`versionCode` / `versionName`).
4. Ejecutar el flujo de compilación (paso 6).
5. Verificar APK, firma (paso 7) y que `build.gradle` + `output-metadata.json` reflejan la misma versión.
