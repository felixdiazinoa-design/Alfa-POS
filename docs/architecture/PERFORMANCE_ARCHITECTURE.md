# Arquitectura de rendimiento

Instrumentación existente, a reutilizar: `services/CheckoutDiagnostics.ts:258` registra etapas; `:270` permite lectura/exportación; `CheckoutPerformanceDiagnostics.ts` construye snapshots de entorno y duraciones; `CheckoutDiagnosticTransport.ts` y `CheckoutDiagnosticDelivery.ts` gestionan entrega; `CheckoutPrintTracking.ts` sigue impresión.

`utils/interactionPerformance.ts` aporta medición de interacción/render; `components/POSInterface.tsx:1162` y `:1181` marcan render. `services/sync/BackgroundSyncManager.ts:552` pausa trabajo por entrada activa y `:600` cede a UI. `services/sync/SyncMetrics.ts:11` añade tamaño/edad de pendientes y etapas de sync. Android incluye diagnóstico condicionado por BuildConfig (`MainActivity.java:64`).

Presupuestos de promoción se validan en `scripts/qa/apk-release-gate.mjs:82` y `:110`: consumir baseline existente, sin inventar equivalencia de baseline ALFA/CLIC. Medir por dispositivo/topología: apertura cobro, commit local, pantalla éxito, impresión, reconexión y drenado de pendientes; reportar distribución/percentiles solo cuando haya muestras válidas.

Suites descubiertas: `tests/checkoutPerformanceDiagnostics.test.ts`, `tests/checkoutDiagnostics.test.ts`, `tests/posOperationalResponsivenessContract.test.ts`, `tests/posRuntimeLatencyHotfix.test.ts`, `tests/syncMetrics.test.ts`. No hay nuevas mediciones ni resultados ejecutados. La instrumentación de diagnóstico no debe bloquear ni modificar la venta.


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
