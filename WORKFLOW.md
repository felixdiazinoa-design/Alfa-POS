# Procedimiento formal — ALFA-POS

## Alcance y estado de implantación

Este repositorio forma parte de ALFA-RMS ↔ ALFA-POS ↔ ALFA-ADMIN. El descubrimiento de los tres productos se completó sobre snapshots documentados en `docs/architecture/DISCOVERY.md`; no certifica servicios desplegados ni hardware. ALFA se estudia por código propio, sin atribuirle comportamiento de otro producto por compartir nombres históricos.

Los roles `.codex/agents/*.md` son contratos legibles; sus compañeros `.toml` son definiciones de agentes de proyecto que Codex puede cargar. No son procesos residentes ni una automatización programada. Sigue la documentación oficial de [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents). Si el cliente no carga roles TOML, el orchestrator delega explícitamente con el contrato MD; no afirma que un rol esté activo sin observar la sesión. Modelo y razonamiento se heredan, sin fijar costes/modelos globales.

El verificador local exige scope, orden, gates y separación de autor/validador; no autentica criptográficamente `agentId` ni reemplaza protección de ramas o permisos de servidor. Los reportes deben venir de sesiones independientes observables. No se ha configurado protección remota ni una promoción automática productiva. CI verifica integridad de esta infraestructura; release debe ejecutar el verificador sobre evidencia externa revisable.

## Estados obligatorios

REQUEST → ANALYSIS → PLAN → IMPLEMENTATION → CODE REVIEW → QA → INTEGRATION VALIDATION → PERFORMANCE cuando aplique → INTERNAL RELEASE → INTERNAL TESTING → PRODUCTION RELEASE.

REVIEW, QA y evaluación INTEGRATION siempre son obligatorios. Security/data/tenant/sync/offline/performance se acumulan por matriz. Los validadores independientes pueden trabajar en paralelo después de IMPLEMENTATION; release espera todos los gates. Ningún agente autor del candidato puede aprobar gates de su trabajo. Developer solo declara IMPLEMENTATION COMPLETED. El orchestrator no desarrolla.

Estados de promoción: APPROVED_FOR_INTERNAL_TESTING → DEPLOYED_FOR_INTERNAL_TESTING → INTERNAL_TESTING_PASSED → APPROVED_FOR_PRODUCTION → RELEASED_FOR_PRODUCTION. Para RMS/ADMIN `internal-release` identifica el despliegue a un entorno de pruebas concreto. POS requiere `internal-deploy` vinculado al APK exacto. Sin entorno, artefacto o prueba real: BLOCKED.

Si un gate falla: FAILED → IMPLEMENTATION → REVIEW → VALIDATION. Un cambio de SHA o diff invalida todas las evidencias. No repetir un gate fallido como PASS sin nueva ejecución. `NOT REQUIRED` solo sirve para casos opcionales en los reportes narrativos con justificación revisada; un gate requerido por matriz nunca acepta NOT REQUIRED.

## Ejecución por solicitud

1. Orchestrator recibe solicitud y asigna analyst. Leer constitución y documentación; comprobar dependencias en los otros dos repositorios.
2. Actualizar refs, crear rama de tarea desde `origin/develop` y aprobar plan antes de cambios. PR siempre a `develop`. Nunca push directo a ramas protegidas.
3. Analyst entrega requisito/evidencia/causa/archivos/dependencias/impacto cruzado/propuesta/riesgos/validación. Orchestrator decide riesgo LOW/MEDIUM/HIGH/CRITICAL y casos/checklists obligatorios.
4. Developer implementa mínimo, registra su `agentId` y los otros autores del candidato. Commit Conventional, validación local sin atribuirse QA independiente.
5. Con árbol limpio, `node .codex/workflow.mjs plan origin/develop` obtiene base SHA, candidato SHA, diffHash, archivos, scopeHash, riesgo y gates. Para evidencia reproducible fijar después la base SHA que devuelve el plan: un avance de la base exige replanificar.
6. Reviewer y cada validador se asignan a agentes distintos entre sí y de los autores, y contrastan candidato completo y registran casos reales, resultados, comandos, entorno, timestamps y referencias de evidencia. Usa `.codex/templates/task-report.json` como forma, nunca como evidencia aprobada. Guarda reportes fuera del checkout: escribirlos dentro cambiaría SHA/scope o dejaría árbol sucio. Los IDs son de sesiones de agentes, no nombres de rol intercambiables.
7. Release verifica completitud y rollback. Orchestrator establece `internal-approval` tras release. `node .codex/workflow.mjs verify <base-SHA> <informe-externo.json> internal` debe pasar antes de desplegar para pruebas.
8. Internal deploy/release registra entorno y resultado; `verify ... deployed-internal` verifica esa fase. Testing interno independiente registra resultados reales; aprobación producción independiente requiere `verify ... production`. La ejecución productiva se comprueba con `verify ... released-production` y gate `production-release`. Nunca convertir un PASS interno en autorización productiva.
9. Push únicamente rama de tarea y abrir PR a `develop`. Evidencias adjuntas/referenciadas en PR, sin secretos. Este procedimiento no autoriza merges automáticos ni elimina las protecciones existentes.

## Reportes y límites

Cada registro incluye gate, agentId, sourceCommit, scopeHash, completedAt UTC, PASS/FAILED/BLOCKED, summary y evidence (objetos con path absoluto de archivo local archivado y sha256 real). Incluye todos los autores en developerIds. La secuencia timestamp es analysis → plan → implementation → validadores → release → internal-approval → despliegue interno → internal-testing → production-approval → production-release. Cambios planeados antes del commit se adjuntan al scope final por revisión del analyst; no inventar timestamps de aprobación.

POS además requiere artefacto con apk, versionName, versionCode, applicationId, buildId, sizeBytes, sourceCommit, sha256 y certificateSha256; `artifactHash` en cada gate de promoción se calcula con `validateArtifact` exportado por workflow.mjs. No basta hash sin cadena build→source acreditada. SHA/versiones/firma se extraen del APK real y manifiesto build, nunca solo Gradle o nombre de archivo.

No declarar REVIEW/QA/PERFORMANCE/SECURITY/READY sin casos ejecutados. Pruebas regex prueban contrato estático, no aislamiento vivo ni hardware. La evidencia externa debe existir y poder abrirse por release; el verificador abre cada archivo y comprueba su SHA-256; no evalúa su significado ni autentica a quien lo generó. Archivar evidencia de enlaces remotos como archivos locales antes de verificar. Comprueba bytes/tamaño/SHA y formato ZIP del APK; firma, metadata y cadena source→build siguen requiriendo herramientas Android y evidencia independiente. No pegar tokens ni URLs firmadas de vida corta en reportes públicos.

## Checklists y comandos

Usar functional, regression, integration y release siempre; agregar dominios por `.codex/RISK_MATRIX.md`. QA explica cobertura vecina y límites. Security se exige en auth/permisos/tenants/licencias y APK según matriz. La clasificación automática es un mínimo y se puede elevar con risk/extraGates; nunca reducir.

`npm ci`, `npm run lint`, `npm run build`, `npm run test:catalog-sync`; tests de contratos específicos con `npx tsx --test tests/<archivo>.test.ts`. `npm run qa:release-gate` y `npm run qa:release-promote -- --evidence <archivo>` conservan sus requisitos existentes. Leer constitución y scripts reales antes de invocarlos: build firmado/protocol queda bloqueado hasta identificar worktree/keystore ALFA propios.

Verificación del procedimiento, sin dependencias de aplicación: `node --test .codex/workflow.test.mjs` y `python3 .codex/validate_agents.py` (Python >=3.11). CI aplica ambas y no modifica código operativo, DB, APK ni configuración de producción.

## Release y rollback

Preservar compatibilidad POS operativo local. Si un cambio funcional futuro requiere transición, planificar feature flag y ambos caminos. Registrar esquema/API compatible, orden despliegue y recuperación; no hacer cambios oportunistas en este encargo. Revertir merge no revierte DB ni writes de negocio: validar migración compensatoria, idempotencia y artefacto anterior antes del release.

## Publicación APK interna

El descubrimiento confirmó ADMIN `pos-apk-releases-api` con create/list/set_status y tabla landlord.pos_apk_releases; no confirmó canal de upload APK binario. `internal_testing` no aparece en `/api/pos-apk/latest`, que devuelve solo `available`. Usar el registro/URL exactos para testers.

Antes de operar documentar destino de storage ALFA, uploader/API/permisos, canal interno y worktree firma/keystore ALFA propios. El script `scripts/release-android.sh` conserva rutas CLIC: no ejecutarlo contra worktree compartida sin mapa propio confirmado. Si falta cualquiera, internal-deploy debe bloquear publicación; no inventar Vercel Blob/bucket ni reutilizar secretos de CLIC.

Secuencia obligatoria: IDENTIFY APK → VALIDATE firma/versiones/source/build/tamaño/SHA → INSPECT CURRENT VERSION → UPLOAD NEW a ruta versionada si destino lo permite → VERIFY STORAGE → PUBLISH en ALFA-ADMIN con `internal_testing` → VERIFY DOWNLOAD exacta (bytes/tamaño/SHA) → CLEANUP OLD conforme retención. Mantener versión previa hasta verificación y ventana rollback; no eliminarla por defecto. Preferir `alfa-pos-<versionName>.apk` como objeto externo sin renombrar appId ni cambiar firma de actualización. No ejecutar delete-old primero ni marcar `available` para que testers lo encuentren.

El agente produce `.codex/templates/internal-deployment-report.md` completado con evidencia, no checks vacíos. Ningún APK fue compilado/aprobado/publicado al implantar este procedimiento. Automatismo interno se activa solo con gates completos y destino documentado; producción sigue requiriendo gate independiente.
