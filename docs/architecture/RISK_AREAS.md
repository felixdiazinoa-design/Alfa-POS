# Áreas de riesgo

1. **Release cruzado con CLIC-POS:** `scripts/release-android.sh:10` apunta a `_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite`; `:94` y `:120` buscan APK en esas worktrees; `:223` usa `_releases/CLIC-POS`; `:226` y `:227` buscan material de firma allí. **No ejecutar este protocolo en ALFA hasta confirmar worktree, firma e historial propios.** Descubrimiento no autoriza migrar ni tocar CLIC-POS.
2. **Identidad de aplicación:** `android/app/build.gradle:23` conserva `com.clicpos.app`, versión `1.1.373`/1373 (`:27`). No renombrar appId: podría convertir una actualización en otra app y separar datos. Tampoco asumir equivalencia de certificados o baseline entre ALFA y CLIC.
3. **Base incorrecta:** `AGENTS.md:11` exige develop. Main `319e10d` y develop `bdc4186` divergen significativamente; main tiene APK 1.0.40/41 y no representa arquitectura actual.
4. **Flags versus garantías:** `services/sync/SyncFeatureFlags.ts:10` y `:17` dejan recuperación/outbox v2 desactivadas por defecto. Existencia de commit atómico no demuestra activación en producción. `services/transactionService.ts:502` conserva camino legacy.
5. **Confirmación de sync:** `BackgroundSyncManager.ts:578` diferencia staging, master y ERP; los estados no son intercambiables. Bloqueos funcionales `:622` requieren diagnóstico, no reenvío ciego.
6. **Pruebas versus hardware:** tests TS cubren contratos y comportamiento, pero los tests Android `ExampleUnitTest.java:15` y `ExampleInstrumentedTest.java:20` son básicos. Ninguna auditoría estática prueba impresora, cajón, reconexión o reemplazo APK.
7. **Herramientas históricas:** scripts de seed/reset/reparación pueden mutar SQLite y datos. No ejecutarlos como verificación genérica; seleccionar suites herméticas.

Preservar compatibilidad mediante cambios pequeños y flags. Si se detecta regresión en un merge autorizado, seguir la política de revert del repositorio; esta tarea no realiza merges ni releases.


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
