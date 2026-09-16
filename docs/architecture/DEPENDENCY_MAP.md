# Dependencias

| Dependencia | Contrato y evidencia | Fallo observable |
| --- | --- | --- |
| Capacitor Android + SQLite | Selección nativa `services/db/index.ts:13`; upsert `services/db/adapters/CapacitorSQLiteAdapter.ts:107`; mutaciones atómicas `:111` | Inicialización/persistencia fallida; venta no debe reportarse confirmada sin commit |
| Master LAN/Express | `/api/sync`, `server/index.ts:142`; listener `:960`; `services/sync/ApiSyncAdapter.ts` | Pendientes/retry; no confundir master confirmado con ERP aplicado |
| ERP web | `utils/erpSyncLifecycle.ts`, `services/sync/ErpMasterSyncContract.ts` | Binding/config/catálogo incompatibles; bloqueo funcional |
| Cloud staging | Destino separado `services/sync/BackgroundSyncManager.ts:578` | SYNCED_CLOUD no acredita APPLIED_ERP |
| Impresoras | `services/printer/NativePrintBridge.ts`, `PrintRouterService.ts`, `OfflinePrintQueueService.ts`; bridge Android `MainActivity.java:77` | Trabajo pendiente/error, fallo de ticket o cajón |
| Diagnósticos | `services/CheckoutDiagnosticTransport.ts`, `CheckoutDiagnosticDelivery.ts`, `CheckoutPerformanceDiagnostics.ts` | Entrega diagnóstica fallida no debe bloquear cobro |
| Toolchain | scripts de `package.json`; Capacitor/Gradle y Node CI 22 (`.github/workflows/apk-release-gate.yml:27`) | Build/gate fallido |
| Firma/release | Script con worktree histórica `scripts/release-android.sh:10` | Puede apuntar al proyecto CLIC operativo; no usar hasta confirmar mapa propio ALFA |

Versiones exactas deben obtenerse de `package-lock.json`; rangos npm no prueban versiones instaladas. No incluir credenciales, datos operativos o material de firma en documentación/evidencias.


Auditoría estática del snapshot `bdc4186` de `origin/develop`, 2026-09-16. Las referencias indican líneas del snapshot; no acreditan ejecución de pruebas, dispositivo o release.
