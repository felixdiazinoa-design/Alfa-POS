# Arquitectura de sincronización

El sistema distingue master POS, cloud staging y ERP activo. `services/sync/ErpMasterSyncStrategy.ts`, `ErpMasterSyncContract.ts` y `SyncProfile.ts` modelan estrategia/contrato; `SyncTriggerCoordinator.ts` coordina disparadores. El transporte API y lifecycle ERP viven en `ApiSyncAdapter.ts` y `utils/erpSyncLifecycle.ts`.

`services/sync/BackgroundSyncManager.ts:552` pausa por entrada activa; `:559` persiste SYNCING antes de enviar; `:565` invoca transporte; `:578` registra SYNCED_CLOUD, APPLIED_ERP o SYNCED_MASTER según destino; `:607` y `:636` asignan RETRY_WAIT; `:622` preserva BLOCKED_FUNCTIONAL. No inferir ERP aplicado de una confirmación LAN o staging.

La outbox v2 se implementa en `DurableOutboxRepository.ts`, `DurableOutboxSchema.ts` y `DurableOutboxBatchSender.ts`. `DurableOutboxRepository.ts:70` requiere commit financiero soportado por adaptador. Está condicionada por `SyncFeatureFlags.ts:17`; comprobar configuración real antes de afirmar durabilidad v2.

`SyncMetrics.ts:11` expone tamaño/antigüedad de pendientes, último sync, última aplicación ERP y timestamps por etapa. Correlacionar con referencia de venta y destino, sin copiar credenciales o payload de clientes.

Escenarios mínimos: Android master offline/online, Android cliente con master LAN, staging cloud, ERP activo, catálogo faltante, ACK perdido, interrupción durante SYNCING y reconexión. Artefactos: `tests/erpMasterSyncStrategy.test.ts`, `tests/backgroundSyncRecoveryContract.test.ts`, `tests/syncTriggerCoordinator.test.ts`, `tests/syncMetrics.test.ts`.


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
