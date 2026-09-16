# Matriz automática — ALFA-POS

Fuente ejecutable: risk-matrix.json; `node .codex/workflow.mjs plan <base-ref>` calcula diff completo desde merge-base hasta HEAD. Siempre exige review, qa, integration y release. Las reglas se acumulan, nunca se reemplazan.

| Dominio | Patrón de archivos (sin distinguir mayúsculas) | Riesgo mínimo | Gates adicionales |
| --- | --- | --- | --- |
| sync | `(sync|outbox|inbox|erp|heartbeat|terminal|storage|services/db/|recovery)` | HIGH | sync-validator, offline-validator, performance, integration |
| catalog | `(catalog|product|item|pricing|tax|discount|promotion|tariff|cart)` | HIGH | performance, integration |
| sale | `(payment|transaction|sale|checkout|POSInterface|PaymentModal|recovery)` | HIGH | offline-validator, performance, integration |
| android | `(android/|native|capacitor|printer|ticket|release|apk)` | HIGH | offline-validator, integration, security |
| auth | `(auth|permission|role|license|tenant|security)` | HIGH | security, integration |

Solo Markdown y perfiles TOML declarativos aislados bajo docs/.codex: LOW. Ejecutables y matrices bajo .codex y workflows CI: HIGH + SECURITY. UI fuera de dominios críticos: MEDIUM. Archivo funcional desconocido: HIGH y todos los validadores del producto. Secretos, borrado, reset, claves de firma y migraciones destructivas: CRITICAL. Estos últimos también necesitan security. En plan se debe subir el riesgo cuando la semántica lo justifique; el verificador acepta escalamiento, nunca reducción ni eliminación de gates. Un patrón no demuestra ausencia de impacto: analyst y orchestrator deben revisar dependencias.

No hay LOW automático para ventas, cobros, inventario, precios, impuestos, tickets, sync, offline, database, auth, permissions, tenants o licensing. Evaluación cruzada integration obligatoria; PASS sin contrato afectado exige evidencia del análisis.

Escalamiento del riesgo efectivo a HIGH/CRITICAL añade validadores especializados del producto; CRITICAL siempre añade SECURITY, aunque extraGates esté vacío.
