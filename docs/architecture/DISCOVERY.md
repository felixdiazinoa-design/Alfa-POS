# Descubrimiento ALFA-POS

Fuente definitiva: worktree de tarea derivada de origin/develop, commit `bdc4186` (merge de performance diagnostics). Fecha 2026-09-16. Auditoría estática, sin builds, npm install, ejecución de tests, servicios, dispositivos ni cambios de runtime.

El clon inicial tenía main `319e10d`; ese snapshot conserva APK 1.0.40/41 y es sustancialmente anterior. Develop tiene 1.1.373/1373, outbox/recuperación condicionadas, numerosas suites y gates. Las conclusiones se basan en develop. `AGENTS.md:11` confirma develop como fuente oficial.

Inventario: React/Vite; shell Capacitor Android; SQLite nativo y IndexedDB web; backend Express/SQLite; sync master/cloud/ERP; impresión native/ESC-POS/router/offline; diagnóstico checkout/render/sync y release gates. El nombre npm sigue clic-pos/0.0.0; appId com.clicpos.app. Ninguno fue renombrado.

Validación disponible: scripts build/lint/Android/gates/catalog-sync en `package.json`; tests TS en `tests/`; pruebas Android básicas de ejemplo. CI `.github/workflows/apk-release-gate.yml:31` instala; `:34` valida baseline; `:37` construye web. Promoción `scripts/qa/apk-release-gate.mjs:90` exige commit, hashes, firma, métricas, contratos, topologías y evidencia de dispositivos `:123`.

**Límite operativo:** protocolo `scripts/release-android.sh:10` usa worktree CLIC-POS compartida e historial/firma `:223`–`:227`. No usarlo en ALFA hasta confirmar mapa propio de firma/worktrees. No tocar CLIC-POS, no modificar appId y no asumir equivalencia de baseline/certificado. Existencia de tests/gates no equivale a release aprobado.

Documentos: [sistema](SYSTEM_MAP.md), [flujos](CRITICAL_FLOWS.md), [dependencias](DEPENDENCY_MAP.md), [riesgos](RISK_AREAS.md), [sync](SYNC_ARCHITECTURE.md), [offline](OFFLINE_ARCHITECTURE.md), [rendimiento](PERFORMANCE_ARCHITECTURE.md).


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
