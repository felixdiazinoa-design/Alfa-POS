# Historial de APK release (referencia)

Registro de builds **release firmados** validados. El código fuente de referencia sigue siendo `develop`; esta tabla documenta el artefacto y el contexto de build.

> **Cambio de proyecto.** Las entradas anteriores a **1.1.412** corresponden a
> **CLIC-POS** y conservan sus rutas y firmas originales. Desde **1.1.412** el
> proyecto es **Alfa POS** (`com.alfapos.app`), con keystore propio en
> `APK/keys/alfa-pos-release.keystore`. No reutilices rutas ni claves de CLIC-POS.

---

## 1.1.412 (versionCode 1412) — 2026-11-10

Primer release de **Alfa POS** con identidad propia.

| Campo | Valor |
|--------|--------|
| **APK** | `Alfa-Pos-1.1.412-release.apk` |
| **applicationId** | `com.alfapos.app` (label `Alfa POS`) |
| **versionCode** | 1412 |
| **versionName** | 1.1.412 |
| **Rama de build** | `fix/recepcion-movil-idempotencia` (merge en `develop` `a833623`) |
| **Checkout de build** | repo principal (`/Users/felixdiaz/Documents/ChatGPT/Alfa-POS`) |
| **Keystore** | `APK/keys/alfa-pos-release.keystore` (`CN=Alfa POS`) |
| **SHA-256** | `d9dced899f56abd1e19bee0c78334baf5df5601382dd28d7ac9d0c49391fab06` |
| **Nota funcional** | Recepción idempotente/atómica + bloqueo de conteo por almacén/ubicación |

### Verificación ejecutada

- `npm run qa:release-gate -- --stage prebuild` — PASSED (117 tests)
- `npm run build` — OK
- `npx cap sync android` — OK
- `./gradlew clean assembleRelease -PclicPosAllowReleaseCleartext=true` — OK
- `apksigner verify --print-certs` — OK (`CN=Alfa POS`)
- `aapt dump badging` — package `com.alfapos.app`, label `Alfa POS`

---

## 1.0.763 (versionCode 763) — 2026-06-06

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.763-release.apk` |
| **Metadata** | `output-metadata-1.0.763.json` |
| **versionCode** | 763 |
| **versionName** | 1.0.763 |
| **Rama de build** | `feature/pos-consignments-on-demand` |
| **Commit build** | `db5fdafc0fd13f22001faddd99241f079cbba5a7` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `fcd1d6132fc180c2fe52ca43aacb1b6df74316884016dc6248801144e6bfa24e` |
| **Firma release** | Válida (`CN=CLIC POS, OU=Mobile...`) |
| **Nota funcional** | `fix(setup): route terminal takeover through local setup proxy` |

### Verificación ejecutada

- `npx tsc -b` — OK
- `npm run build` — OK
- `npx cap sync android` — OK
- `./gradlew clean assembleRelease` — OK
- `apksigner verify --print-certs` — OK
- Build timestamp: `2026-06-06 08:59:15 AST`

---

## 1.0.762 (versionCode 762) — 2026-06-05

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.762-release.apk` |
| **Metadata** | `output-metadata-1.0.762.json` |
| **versionCode** | 762 |
| **versionName** | 1.0.762 |
| **Rama de build** | `feature/pos-consignments-on-demand` |
| **Commit build** | `305b049623f521d7f4ca27526c296adbe62f8948` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `efff85a207d28077d95e7e216e7ad5b76b81d7ce60540e7dd8a14a9c4b885331` |
| **Firma release** | Válida (`CN=CLIC POS, OU=Mobile...`) |
| **Nota funcional** | `fix(sync): suppress erp metadata timeouts` |

### Verificación ejecutada

- `npx tsc -b` — OK
- `npm run build` — OK
- `npx cap sync android` — OK
- `./gradlew clean assembleRelease` — OK
- Build timestamp: `2026-06-05 19:45:55 AST`

---

## 1.0.755 (versionCode 755) — 2026-06-04

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.755-release.apk` |
| **Metadata** | `output-metadata-1.0.755.json` |
| **versionCode** | 755 |
| **versionName** | 1.0.755 |
| **Rama de build** | `feature/pos-consignments-on-demand` |
| **Commit build** | `6ea2492ebff950fbf43304da27b85a0637dd61dd` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `5fd874599a26535c5e9773b0efb31cd7e5d4e66c46579aa791a75efd822df167` |
| **Firma release** | Válida (`CN=CLIC POS, OU=Mobile...`) |
| **Nota funcional** | `fix(sync): defer POS cloud staging auth failures` |

### Verificación ejecutada

- `npx tsc -b` — OK
- `npm run build` — OK
- `npx cap sync android` — OK
- `./gradlew clean assembleRelease` — OK
- Build timestamp: `2026-06-04 18:08:19 AST`

---

## 1.0.299 (versionCode 299) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.299-release.apk` |
| **Metadata** | `output-metadata.json` |
| **versionCode** | 299 |
| **versionName** | 1.0.299 |
| **Rama de build** | `hotfix/apk-1.0.299-backend-license-guard` |
| **Commit build** | `d01bce6` |
| **Base desde `develop`** | `09408fa` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `45819f013c09a6c5a69770b5b7ce634b3d73688be3ad10f1c72838d998e8dc2b` |
| **Firma release** | Válida (`CN=CLIC POS, OU=Mobile...`) |
| **Nota funcional** | Sin cambios de UI en POS para licencias; la protección `403 Forbidden` queda heredada desde backend API. |

### Verificación ejecutada

- `npx tsc -b` — OK
- `npm run build` — OK
- `npx cap sync android` — OK
- `./gradlew clean assembleRelease` — OK
- `apksigner verify --print-certs` — OK

---

## 1.0.298 (versionCode 298) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.298-release.apk` |
| **Metadata** | `output-metadata.json` |
| **versionCode** | 298 |
| **versionName** | 1.0.298 |
| **Rama de build** | `hotfix/apk-1.0.298-handheld-reception` |
| **Commit build** | `16857c3bc457fc723249a5a6fdae467a3ba55103` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `cd44d9fb8f2e8cdecb864c35a796e54044c4026bdd69c2c4fe61813996ebc200` |
| **Firma release** | Válida (`CN=CLIC POS, OU=Mobile...`) |

### Verificación ejecutada

- **POS worktree:** `npm run build` — OK
- **ERP worktree:** `npm run build` — OK
- **APK checks:** `npx tsc -b`, `npm run build`, `npx cap sync android`, `./gradlew clean assembleRelease` — OK

---

## 1.0.297 (versionCode 297) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.297-release.apk` |
| **Metadata** | `output-metadata.json` (junto al APK en el directorio de release) |
| **versionCode** | 297 |
| **versionName** | 1.0.297 |
| **PR del fix / bump** | #131 y #132 |
| **Merge en `develop`** | `83f8d8b84b098967ab1068ced05da962861a8ec5` |
| **Commit bump** | `9da9eff` |
| **Rama de build** | `hotfix/apk-1.0.297-license-subscription-select` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `9ec5c20a0a4d5a18610eebd364493d9f67f10225240c5c172ccc0534b3018c55` |
| **Firma release** | Válida |
| **Certificado** | `CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO` |

### Verificación de build (misma línea que produjo el APK)

- `./node_modules/.bin/tsc -b` — OK  
- `npm run build` — OK  
- `npx cap sync android` — OK  
- `./gradlew clean assembleRelease` — OK (warnings de Vite/Kotlin/Gradle esperados)

---

## 1.0.295 (versionCode 295) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.295-release.apk` |
| **Metadata** | `output-metadata.json` (junto al APK en el directorio de release) |
| **versionCode** | 295 |
| **versionName** | 1.0.295 |
| **PR del fix** | #128 |
| **Merge en `develop`** | `9b4849b22b075b27e0a94b4ac2221243c710c17d` |
| **Rama de build** | `hotfix/apk-1.0.295-warehouse-activation` |
| **Commit del build** | `f3f31d1` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `6de6143fada1cbde2d4b6f2e775a0c962f1be354834518bccc47024d353c46a7` |
| **Firma release** | Válida |
| **Certificado** | `CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO` |

### Verificación de build (misma línea que produjo el APK)

- `./node_modules/.bin/tsc -b` — OK  
- `npm run build` — OK  
- `npx cap sync android` — OK  
- `./gradlew clean assembleRelease` — OK  

---

Para el flujo operativo (worktree, firma, checklist), ver [APK_RELEASE_CHECKLIST.md](./APK_RELEASE_CHECKLIST.md).
