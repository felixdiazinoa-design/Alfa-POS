# Arquitectura offline

`services/db/index.ts:13` selecciona SQLite Android e IndexedDB web; `:23` envuelve recuperación bajo flag. El adaptador nativo hace upsert documental `CapacitorSQLiteAdapter.ts:107`, mutaciones atómicas `:111` y serializa escritura `:682`. Esto protege operaciones soportadas por ese contrato; no implica atomicidad universal del flujo legacy.

`services/transactionService.ts:502` difiere persistencia al commit financiero únicamente con sqlite_outbox_v2; `:506` preserva persistencia legacy. Recuperación dedicada: `services/recovery/PendingOperationsRecovery.ts` y `RecoveryDatabase.ts`. `SyncFeatureFlags.ts:10` y `:17` declaran valores por defecto falsos para recuperación y outbox v2.

La impresión offline usa `services/printer/OfflinePrintQueueService.ts`, trabajos persistentes con referencia, intentos y estados; reintenta trabajos pendientes/errores y elimina exitosos. Ticket y venta son efectos distintos: verificar que error de impresión no duplique cobro.

Validar cierre abrupto antes/después del commit, arranque con pendientes, reconexión, conservación de secuencias y actualización APK con reemplazo. `tests/pendingOperationsRecovery.test.ts`, `tests/recoveryDurableRoundTrip.test.ts` y `tests/terminalUpgradePersistence.test.ts` aportan cobertura existente. No se realizaron esas pruebas en este descubrimiento.


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
