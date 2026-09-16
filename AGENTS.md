# ALFA-POS — contexto técnico encontrado en el repositorio independiente

## Qué es este repo

Frontend POS (Vite/React) con shell Android vía Capacitor; SQLite nativo en APK.

## Fuente de verdad y rutas operativas

Para evitar releases incompletos, usa siempre esta jerarquía:

1. **`develop` es la única fuente oficial** del código que puede llegar a un APK release.
2. **Worktrees de runtime/laboratorio** (por ejemplo Polaris) sirven para validar y depurar, pero **ningún fix debe vivir solo ahí**.
3. **La worktree firmada** sirve para compilar el APK release. No se usa para desarrollar features ni para acumular fixes sueltos.

## Dónde trabajar (no confundir rutas)

| Objetivo | Ubicación |
|----------|-----------|
| Código, commits y PRs | **Repo principal** (este directorio). |
| APK **release firmado** (keystore) | **Worktree** `_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` en la misma máquina de build. |
| Runtime/laboratorio Polaris | **Worktree separada**; útil para pruebas, no para releases oficiales. |

Detalle operativo: [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md).
Protocolo de coordinación con agentes: [docs/AGENT_RELEASE_PROTOCOL.md](./docs/AGENT_RELEASE_PROTOCOL.md).
Constitución antirregresión obligatoria: [docs/APK_RELEASE_CONSTITUTION.md](./docs/APK_RELEASE_CONSTITUTION.md).

## Ramas

- Base habitual: **`develop`**. Las ramas **`fix/*`** y **`feat/*`** (o `codex/*`) son para PRs; el nombre describe el cambio.
- **Git no permite** tener la **misma** rama checked out en dos sitios a la vez. Si el worktree firmado usa otra rama que el principal, es normal: alinea código con merge, cherry-pick o **rsync de archivos** según el checklist antes de `assembleRelease`.
- Antes de un release: confirma que el worktree tiene el mismo código que la rama que vas a integrar (revisa diff frente a `origin`).

## Versión Android

En `android/app/build.gradle`, **`versionCode`** debe subir en cada subida a Play (monotónico). Después de un release firmado, mantén **alineados** `versionCode` / `versionName` en el repo principal y en el worktree firmado.

## Lecturas útiles

- [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md) — flujo build + firma + verificación.
- [docs/AGENT_RELEASE_PROTOCOL.md](./docs/AGENT_RELEASE_PROTOCOL.md) — protocolo para Codex, Cursor y AG; evita mezclar fixes entre ramas, runtime y APK.
- [docs/APK_RELEASE_CONSTITUTION.md](./docs/APK_RELEASE_CONSTITUTION.md) — baseline 1.1.363, puertas prebuild/promote y presupuestos que bloquean regresiones.
- [docs/ANDROID_APK_SQLITE.md](./docs/ANDROID_APK_SQLITE.md) — notas SQLite / APK (si aplica a tu tarea).


## Constitución ALFA-POS: procedimiento multiagente obligatorio

ALFA es una plataforma independiente; los nombres históricos en código son evidencia técnica, no equivalencia comercial ni autorización para operar otros repositorios.

Antes de cualquier tarea leer [WORKFLOW.md](./WORKFLOW.md), [.codex/RISK_MATRIX.md](./.codex/RISK_MATRIX.md) y [descubrimiento](./docs/architecture/DISCOVERY.md). Usar agentes de proyecto MD/TOML de `.codex/agents/`. Orchestrator coordina sin desarrollar; analyst investiga; developer implementa; reviewer, QA, integration y validadores especializados verifican en sesiones independientes. Ningún autor del candidato puede aprobarlo. Developer declara solo IMPLEMENTATION COMPLETED.

Base obligatoria `origin/develop`; crear `feature/<modulo>-<tarea>` o `fix/<modulo>-<bug>` y `hotfix/<tema-critico>` solo urgencias. Commits Conventional pequeños; validar, push únicamente rama de tarea y PR hacia `develop`. Nunca push directo a clean-erp/develop/main. Mantener compatibilidad operativa y rollback propio de DB/API/artefactos.

La matriz determina mínimos acumulativos; nunca LOW automático para ventas/cobros/inventario/precios/impuestos/tickets/sync/offline/database/auth/permisos/tenants/licencias. Siempre REVIEW + QA + análisis INTEGRATION + RELEASE. FAILED vuelve a implementación/review/validación. Evidencia estática no certifica producción.

Comandos y alcance: `npm ci`, `npm run lint`, `npm run build`, `npm run test:catalog-sync`; tests de contratos específicos con `npx tsx --test tests/<archivo>.test.ts`. `npm run qa:release-gate` y `npm run qa:release-promote -- --evidence <archivo>` conservan sus requisitos existentes. Leer constitución y scripts reales antes de invocarlos: build firmado/protocol queda bloqueado hasta identificar worktree/keystore ALFA propios.

Arquitectura y módulos críticos: [SYSTEM_MAP](./docs/architecture/SYSTEM_MAP.md), [CRITICAL_FLOWS](./docs/architecture/CRITICAL_FLOWS.md), [DEPENDENCY_MAP](./docs/architecture/DEPENDENCY_MAP.md), [RISK_AREAS](./docs/architecture/RISK_AREAS.md). Antes de cambios de datos/security/sync verificar aislamiento, atomicidad real e idempotencia; no asumir que UI PASS equivale a DATA/SECURITY PASS.

`node .codex/workflow.mjs plan origin/develop` genera scope exacto. Evidencias externas deben conservar sourceCommit y scopeHash; cualquier cambio los invalida. `verify` exige autores/validadores diferentes y gates ordenados; las identidades/reportes necesitan revisión humana/observación de sesiones, pues no son firmas criptográficas. Integración considera siempre los tres repos y sus SHAs.

APPROVED_FOR_INTERNAL_TESTING nunca equivale a APPROVED_FOR_PRODUCTION. Release requiere testing interno y aprobación productiva independientes; no hay publicación ni merge automático por crear estos archivos. No imprimir secretos ni consultar/modificar datos reales fuera del alcance de la tarea.

Las rutas `_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` de instrucciones/scripts anteriores son referencias históricas encontradas. Para ALFA, build firmado/publicación quedan BLOCKED hasta confirmar worktree y firma propios autorizados; no ejecutar rsync/cherry-pick/build en worktrees CLIC por esta guía. Preservar `com.clicpos.app` si corresponde a actualización existente; no cambiar appId/firma/datos sin plan y validación específicos. Objetivo general interacciones p95 <=50 ms donde razonable; usar instrumentación y presupuestos existentes documentados en PERFORMANCE_ARCHITECTURE.
