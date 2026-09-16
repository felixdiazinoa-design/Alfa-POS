# Mapa del sistema ALFA-POS

Frontend React/Vite, shell Android Capacitor y persistencia local; backend Express, SQLite de servidor y KDS incluidos. La identidad técnica heredada sigue CLIC-POS.

| Capa | Responsabilidad | Evidencia |
| --- | --- | --- |
| UI | Venta, pedidos, devoluciones, cobro | `components/POSInterface.tsx:5050`, `components/PaymentModal.tsx:32` |
| Dominio | Construcción y normalización de transacciones | `services/transactionService.ts:373` |
| Persistencia | SQLite Android; IndexedDB web; wrapper recuperación | `services/db/index.ts:13`, `services/db/index.ts:23` |
| Sincronización | Master local, staging cloud y ERP activo | `services/sync/BackgroundSyncManager.ts:572` |
| Backend | API sync y transporte LAN | `server/index.ts:142`, `server/index.ts:960` |
| Hardware | Bridge impresora Android y metadatos runtime | `android/app/src/main/java/com/clicpos/app/MainActivity.java:77` |
| Distribución | APK, gate y evidencias | `android/app/build.gradle:27`, `scripts/qa/apk-release-gate.mjs:90` |

Ver [flujos críticos](CRITICAL_FLOWS.md), [dependencias](DEPENDENCY_MAP.md), [riesgos](RISK_AREAS.md), [sync](SYNC_ARCHITECTURE.md), [offline](OFFLINE_ARCHITECTURE.md) y [rendimiento](PERFORMANCE_ARCHITECTURE.md).


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
