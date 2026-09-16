# Infraestructura de procedimiento ALFA-POS

- `agents/*.md`: contratos especializados; `agents/*.toml`: perfiles standalone Codex equivalentes. Agentes no residentes; delegación por solicitud desde AGENTS/WORKFLOW.
- `risk-matrix.json`: reglas reales por rutas/dominios, acumuladas por `workflow.mjs`.
- `workflow.mjs`: plan desde diff Git completo y verificación de ledger externo, identidades distintas, orden, hashes evidencia/APK y separación interno/productivo.
- `workflow.test.mjs`: pruebas negativas/recovery del control, sin servicios externos.
- `validate_agents.py`: perfiles/paridad/checklists y enlaces locales; Python >=3.11.
- `templates/`: plantillas deliberadamente BLOCKED; no constituyen evidencia ni autorizaciones.
- `checklists/`: cobertura base y especializada a seleccionar según riesgo y caso.

Leer [WORKFLOW](../WORKFLOW.md). No hay secretos, llamadas productivas ni uploader binario inventado. Gate correcto no sustituye verificación de significado de evidencia, identidad real de sesión, firma/metadata Android o protecciones Git. Confirmar esas condiciones con actores independientes.
