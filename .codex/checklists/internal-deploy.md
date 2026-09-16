# internal-deploy — ALFA-POS

Registrar PASS / FAILED / BLOCKED por caso con SHA, entorno y evidencia. No dar PASS a casos no ejecutados. NOT REQUIRED exige motivo y revisión independiente del alcance.

- [ ] Artefacto aprobado con ruta/build/SHA/versiones/tamaño/certificado.
- [ ] Destino storage y firma propios ALFA verificados; si ausentes BLOCKED.
- [ ] Upload→verify→create internal_testing→download hash→retención/rollback.
- [ ] No latest/available ni borrar anterior antes de verificar.

Referencias de implementación y límites: docs/architecture/DISCOVERY.md y RISK_AREAS.md.
