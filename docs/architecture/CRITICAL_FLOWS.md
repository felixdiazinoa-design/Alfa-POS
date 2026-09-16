# Flujos críticos

| Flujo | Recorrido y criterio de éxito | Validación existente |
| --- | --- | --- |
| Venta/cobro | `components/POSInterface.tsx:5050` → `services/transactionService.ts:373` → normalización `:498` → persistencia o commit financiero `:502`. Confirmar una sola venta durable, pagos y totales correctos; repetir tras interrupción sin duplicar. | `tests/pendingOperationsRecovery.test.ts`, `tests/checkoutDiagnostics.test.ts`, `tests/salePostedContract.test.ts` |
| Ticket y cajón | `utils/printer.ts:210` genera ticket; `:663` coordina artefactos integrados; `:1264` añade tracking por referencia. Probar copias, reimpresión y cajón con hardware real. | `tests/printCopies.test.ts`, `tests/paymentDrawerPolicy.test.ts`, `tests/printOutputControl.test.ts` |
| Offline/reconexión | Guardar local; encolar durable cuando el flag está activo; reintentar y distinguir destino confirmado. | `tests/backgroundSyncRecoveryContract.test.ts`, `tests/recoveryDurableRoundTrip.test.ts` |
| Sync ERP/master | `services/sync/BackgroundSyncManager.ts:559` marca envío; `:578` distingue destino; `:607` difiere recuperables; `:622` bloquea funcionales. Confirmar ACK/aplicación y pendientes por topología. | `tests/erpMasterSyncStrategy.test.ts`, `tests/syncMetrics.test.ts` |
| Cierre Z | Preservar membresía de ventas y secuencia; verificar impresión y recuperación de cierre. | `tests/closedTransactionMembership.test.ts`, `tests/zReportSequenceContinuity.test.ts`, `tests/closeReportPrintingHotfix.test.ts` |
| Actualización APK | Verificar identidad, firma, versión monotónica y reemplazo conservando datos. | `tests/terminalUpgradePersistence.test.ts`, `tests/apkReleaseGate.test.ts` |

Pruebas listadas son artefactos descubiertos, no resultados nuevos. El smoke de negocio requiere dispositivo, impresora y ERP/master de prueba aislados. No ejecutar seed/reset ni scripts de reparación contra datos operativos.


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
