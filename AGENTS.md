# Alfa POS — contexto para agentes (Codex, Cursor)

## Qué es este repo

Frontend POS (Vite/React) con shell Android vía Capacitor; SQLite nativo en APK.
App Android: **`com.alfapos.app`** ("Alfa POS").

> Este repositorio es **independiente de CLIC-POS**. No reutilices su worktree, su
> keystore, sus scripts de release ni sus rutas: son otro proyecto.

## Fuente de verdad y rutas operativas

Para evitar releases incompletos, usa siempre esta jerarquía:

1. **`develop` es la única fuente oficial** del código que puede llegar a un APK release.
2. **Worktrees de runtime/laboratorio** sirven para validar y depurar, pero **ningún fix debe vivir solo ahí**.
3. **La compilación firmada** se hace desde el **repo principal** o desde una worktree dedicada
   `_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite` si existe. El keystore vive en
   `APK/keys/alfa-pos-release.keystore` y se configura en `android/key.properties`
   (ambos fuera de git).

## Dónde trabajar (no confundir rutas)

| Objetivo | Ubicación |
|----------|-----------|
| Código, commits y PRs | **Repo principal** (este directorio). |
| APK **release firmado** (keystore) | **Repo principal** o worktree `_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite`. Keystore y contraseña en `APK/keys/`. |
| Runtime/laboratorio | **Worktree separada**; útil para pruebas, no para releases oficiales. |

Detalle operativo: [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md).
Protocolo de coordinación con agentes: [docs/AGENT_RELEASE_PROTOCOL.md](./docs/AGENT_RELEASE_PROTOCOL.md).
Constitución antirregresión obligatoria: [docs/APK_RELEASE_CONSTITUTION.md](./docs/APK_RELEASE_CONSTITUTION.md).

## Ramas

- Base habitual: **`develop`**. Las ramas **`fix/*`** y **`feat/*`** (o `codex/*`) son para PRs; el nombre describe el cambio.
- **Git no permite** tener la **misma** rama checked out en dos sitios a la vez. Si la worktree de build usa otra rama que el principal, alinea código con merge, cherry-pick o **rsync de archivos** antes de `assembleRelease`.
- Antes de un release: confirma que el checkout de build tiene el mismo código que la rama que vas a integrar (revisa diff frente a `origin`).

## Versión Android

En `android/app/build.gradle`, **`versionCode`** debe subir en cada subida a Play (monotónico).
Versión actual: **`1421` / `1.1.421`** (`com.alfapos.app`).
El `namespace` Java sigue siendo `com.clicpos.app` por compatibilidad con `MainActivity` y los
plugins nativos; **no** cambies la identidad de la app desde el namespace.

## Lecturas útiles

- [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md) — flujo build + firma + verificación.
- [docs/AGENT_RELEASE_PROTOCOL.md](./docs/AGENT_RELEASE_PROTOCOL.md) — protocolo para Codex, Cursor y AG; evita mezclar fixes entre ramas, runtime y APK.
- [docs/APK_RELEASE_CONSTITUTION.md](./docs/APK_RELEASE_CONSTITUTION.md) — baseline 1.1.363, puertas prebuild/promote y presupuestos que bloquean regresiones.
- [docs/INVENTORY_COUNT_LOCK.md](./docs/INVENTORY_COUNT_LOCK.md) — bloqueo de conteo por almacén/ubicación.
- [docs/ANDROID_APK_SQLITE.md](./docs/ANDROID_APK_SQLITE.md) — notas SQLite / APK (si aplica a tu tarea).
