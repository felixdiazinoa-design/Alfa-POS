# Protocolo de release para agentes (Codex, Cursor, AG)

Objetivo: evitar que un APK salga sin fixes validados o con piezas repartidas entre `develop`, una worktree de runtime y la worktree firmada.

## Fuente de verdad

Usa siempre esta jerarquía:

1. **`develop`**
   - única fuente oficial del código que puede llegar a release
   - todo fix validado debe terminar aquí con commit/PR claro
2. **Worktrees de runtime/laboratorio**
   - sirven para probar hipótesis y validar fixes rápidamente
   - no son fuente oficial de release
3. **Worktree firmada**
   - solo compila el APK
   - no debe convertirse en un segundo lugar de desarrollo

## Regla no negociable

**No compilar un release desde código que exista solo en runtime o solo en la worktree firmada.**

**No promover un APK que no supere la [Constitución antirregresión](./APK_RELEASE_CONSTITUTION.md) y la baseline 1.1.363.**

Antes de compilar, cada fix debe cumplir una de estas dos condiciones:

- ya está en `develop`, o
- existe una rama/PR de release explícita identificable por commit

## Rutas

| Uso | Ruta |
|-----|------|
| Repo principal | `/Users/felixdiaz/Documents/ChatGPT/Alfa-POS` |
| Worktree de build (opcional) | `_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite` (solo si existe) |
| Keystore + contraseña | `APK/keys/alfa-pos-release.keystore` y `APK/keys/alfa-pos-keystore.txt` |
| Configuración de firma | `android/key.properties` (gitignored) |

> **Alfa POS ≠ CLIC-POS.** No uses rutas, keystore ni scripts de CLIC-POS.

## Flujo obligatorio

1. **Trabajar el fix** en una rama desde `develop`.
2. **Validar** el cambio en web/runtime o worktree de laboratorio si hace falta.
3. **Formalizar**:
   - commit pequeño
   - push
   - PR hacia `develop`
4. **Definir el commit fuente del release**:
   - ideal: HEAD de `origin/develop`
   - si el release requiere algo no mergeado aún: una release branch o commit explícito
5. **Alinear la worktree firmada exactamente al commit fuente**.
6. **Gate duro**: si `git status --short` en la worktree firmada no está vacío antes del build, detenerse.
7. **Solo entonces**:
   - subir `versionCode` / `versionName`
   - compilar
   - verificar firma
8. **Ejecutar la puerta de promoción** con evidencia de las tres topologías y sus métricas.
9. **Registrar** junto al release:
   - versión
   - commit fuente
   - PRs incluidos
   - smoke tests ejecutados

## Gate de release

Antes de compilar en la worktree firmada, comprobar:

```bash
git fetch origin
git status --short
git rev-parse --short HEAD
```

Condición de salida:

- `git status --short` debe estar vacío
- el `HEAD` debe corresponder al commit fuente acordado

Si la build canónica necesita quedar en una rama técnica propia, aún así debe estar **alineada** a `origin/develop` o al commit fuente explícito antes del build.

## Qué no hacer

- No copiar archivos a ciegas desde varias worktrees.
- No asumir que “si funciona en Polaris, ya está en el APK”.
- No compilar desde una worktree firmada con cambios manuales no rastreados.
- No dejar fixes importantes viviendo solo en runtime local.
- No usar la worktree archivada `legacy-dirty` como base de release.

## Smoke tests mínimos antes de un APK

### Setup de terminales

1. `MASTER + ERP`
   - activa empresa
   - lista terminales ERP
   - vincula
   - carga login/config
2. `MASTER + LOCAL_ONLY`
   - no pide IP master
   - lista terminales locales
3. `SLAVE + LOCAL_ONLY`
   - pide IP del master
   - lista terminales desde la maestra
   - vincula sin tocar ERP
4. falla takeover
   - debe permitir reintentar
   - no debe decir “ya está vinculada” si quedó incompleto

### Fiscal y crédito

1. venta en efectivo con e-CF
   - no debe quedarse en `e-CF Nuevo`
2. venta a crédito sin cliente
   - debe bloquear
3. venta a crédito sobre límite con cajero sin override
   - debe bloquear o pedir autorización
4. venta a crédito con usuario con override
   - puede continuar según política

### UI móvil

1. login vertical/horizontal
2. ventas móvil
3. catálogo móvil
4. resumen final (`Total General`, `SALIDA`, `COBRAR`)

## Plantilla corta para Cursor / AG

Pegar esto antes de pedir un release:

```text
Antes de compilar el APK:

1. Usa `develop` como fuente oficial.
2. No tomes fixes desde Polaris o worktrees locales si no están formalizados por commit/PR.
3. Alinea el checkout de build (`_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite` si existe, o el repo principal) al commit fuente exacto del release.
4. Si `git status --short` en el checkout de build no está limpio, detente.
5. Sube `versionCode/versionName`, compila, verifica firma y reporta:
   - versión
   - commit fuente
   - PRs incluidos
   - smoke tests ejecutados
```

## Script recomendado

Cuando exista el script de release, úsalo como primer camino:

```bash
npm run android:release:protocol
```

o con un ref explícito:

```bash
./scripts/release-android.sh <git-ref>
```

Eso reduce el riesgo de:

- compilar desde una base incorrecta
- olvidar el gate de limpieza
- bajar accidentalmente el contador de versión
- perder trazabilidad del commit fuente

## Criterio de cierre

Un APK solo se considera correcto si podemos responder con precisión:

- **qué commit** lo originó
- **qué PRs** incluye
- **qué smoke tests** pasaron

Si no podemos responder esas tres cosas, el release no está listo.
