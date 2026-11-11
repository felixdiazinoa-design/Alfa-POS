#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMMON_GIT_DIR="$(git -C "${REPO_ROOT}" rev-parse --path-format=absolute --git-common-dir)"
SOURCE_REPO_ROOT="$(dirname "${COMMON_GIT_DIR}")"
WORKSPACE_ROOT="$(dirname "${SOURCE_REPO_ROOT}")"
DEFAULT_BUILD_WORKTREE="${WORKSPACE_ROOT}/_worktrees/Alfa-POS/Alfa-POS-mobile-sqlite"
if [[ -n "${ALFA_POS_BUILD_WORKTREE:-}" ]]; then
  CANONICAL_BUILD_WORKTREE="${ALFA_POS_BUILD_WORKTREE}"
elif [[ -d "${DEFAULT_BUILD_WORKTREE}" ]]; then
  CANONICAL_BUILD_WORKTREE="${DEFAULT_BUILD_WORKTREE}"
else
  # Alfa POS aún no tiene una worktree de build dedicada: compilar desde el repo
  # principal es válido (el keystore vive en APK/keys y key.properties es local).
  CANONICAL_BUILD_WORKTREE="${REPO_ROOT}"
fi
SOURCE_REF="${1:-origin/develop}"
# Alfa POS Master/Cliente se comunican por la LAN de la tienda en el puerto 3001.
# Mantén el build directo estricto, pero el protocolo de release permite optar
# explícitamente por el transporte HTTP LAN que usa el producto.
LAN_HTTP_ENABLED="${ALFA_POS_RELEASE_LAN_HTTP_ENABLED:-${CLIC_POS_RELEASE_LAN_HTTP_ENABLED:-true}}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

case "${LAN_HTTP_ENABLED}" in
  true|false) ;;
  *) fail "ALFA_POS_RELEASE_LAN_HTTP_ENABLED debe ser true o false" ;;
esac

info() {
  echo "[release-android] $*"
}

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || fail "No existe el archivo requerido: ${path}"
}

extract_version_code_from_metadata() {
  local metadata_file="$1"
  node --input-type=module -e '
    import fs from "node:fs";

    const file = process.argv[1];
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const values = Array.isArray(json?.elements)
      ? json.elements.map(item => Number(item?.versionCode)).filter(Number.isFinite)
      : [];
    console.log(values.length ? Math.max(...values) : 0);
  ' "${metadata_file}"
}

extract_version_name_from_metadata() {
  local metadata_file="$1"
  node --input-type=module -e '
    import fs from "node:fs";

    const file = process.argv[1];
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const latest = (Array.isArray(json?.elements) ? json.elements : [])
      .filter(item => Number.isFinite(Number(item?.versionCode)) && typeof item?.versionName === "string")
      .sort((left, right) => Number(right.versionCode) - Number(left.versionCode))[0];
    console.log(latest ? `${Number(latest.versionCode)}|${latest.versionName}` : "0|");
  ' "${metadata_file}"
}

update_gradle_version() {
  local gradle_file="$1"
  local version_code="$2"
  local version_name="$3"

  node --input-type=module -e '
    import fs from "node:fs";

    const [file, code, name] = process.argv.slice(1);
    let source = fs.readFileSync(file, "utf8");
    source = source.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    source = source.replace(/versionName\s+"[^"]+"/, `versionName "${name}"`);
    fs.writeFileSync(file, source);
  ' "${gradle_file}" "${version_code}" "${version_name}"
}

# Metadatos de releases previos: repo principal + worktrees de Alfa POS.
list_release_metadata_files() {
  {
    find "${REPO_ROOT}/android/app/build/outputs/apk/release" \
      -maxdepth 1 -type f -name 'output-metadata*.json' -print 2>/dev/null || true
    for worktree_dir in "${WORKSPACE_ROOT}/_worktrees/Alfa-POS"/*; do
      [[ -d "${worktree_dir}" ]] || continue
      find "${worktree_dir}/android/app/build/outputs/apk/release" \
        -maxdepth 1 -type f -name 'output-metadata*.json' -print 2>/dev/null || true
    done
  } | sort -u
}

resolve_next_version_code() {
  local gradle_file="$1"
  local max_version
  local metadata_version

  max_version="$(awk '/versionCode[[:space:]]+[0-9]+/ { print $2; exit }' "${gradle_file}")"
  [[ -n "${max_version}" ]] || fail "No pude leer versionCode desde ${gradle_file}"

  while IFS= read -r metadata_file; do
    metadata_version="$(extract_version_code_from_metadata "${metadata_file}")"
    if [[ "${metadata_version}" =~ ^[0-9]+$ ]] && (( metadata_version > max_version )); then
      max_version="${metadata_version}"
    fi
  done < <(list_release_metadata_files)

  echo $((max_version + 1))
}

resolve_latest_version_name() {
  local max_version_code=0
  local latest_version_name=""
  local metadata_entry
  local metadata_version_code
  local metadata_version_name

  while IFS= read -r metadata_file; do
    metadata_entry="$(extract_version_name_from_metadata "${metadata_file}")"
    metadata_version_code="${metadata_entry%%|*}"
    metadata_version_name="${metadata_entry#*|}"
    if [[ "${metadata_version_code}" =~ ^[0-9]+$ ]] && (( metadata_version_code > max_version_code )); then
      max_version_code="${metadata_version_code}"
      latest_version_name="${metadata_version_name}"
    fi
  done < <(list_release_metadata_files)

  echo "${latest_version_name}"
}

resolve_sdk_dir() {
  local local_properties="$1"
  local sdk_dir

  sdk_dir="$(sed -n 's/^sdk\.dir=//p' "${local_properties}" | tail -n1)"
  [[ -n "${sdk_dir}" ]] || sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  [[ -n "${sdk_dir}" ]] || fail "No pude resolver sdk.dir desde ${local_properties} ni desde ANDROID_SDK_ROOT/ANDROID_HOME"
  [[ -d "${sdk_dir}" ]] || fail "Android SDK no existe en ${sdk_dir}"

  echo "${sdk_dir}"
}

resolve_apksigner() {
  local sdk_dir="$1"
  local build_tools_version
  local apksigner

  build_tools_version="$(ls -1 "${sdk_dir}/build-tools" | sort -V | tail -n1)"
  [[ -n "${build_tools_version}" ]] || fail "No encontré build-tools dentro de ${sdk_dir}"

  apksigner="${sdk_dir}/build-tools/${build_tools_version}/apksigner"
  [[ -x "${apksigner}" ]] || fail "No encontré apksigner ejecutable en ${apksigner}"

  echo "${apksigner}"
}

resolve_aapt() {
  local sdk_dir="$1"
  local build_tools_version
  local aapt

  build_tools_version="$(ls -1 "${sdk_dir}/build-tools" | sort -V | tail -n1)"
  [[ -n "${build_tools_version}" ]] || fail "No encontré build-tools dentro de ${sdk_dir}"

  aapt="${sdk_dir}/build-tools/${build_tools_version}/aapt"
  [[ -x "${aapt}" ]] || fail "No encontré aapt ejecutable en ${aapt}"

  echo "${aapt}"
}

verify_apk_network_policy() {
  local aapt="$1"
  local apk="$2"
  local lan_http_enabled="$3"
  local cleartext_attribute

  cleartext_attribute="$("${aapt}" dump xmltree "${apk}" AndroidManifest.xml \
    | grep 'android:usesCleartextTraffic' \
    | head -n1)"
  [[ -n "${cleartext_attribute}" ]] || fail "El APK no declara android:usesCleartextTraffic"

  if [[ "${lan_http_enabled}" == "true" ]]; then
    [[ "${cleartext_attribute}" == *'0xffffffff'* ]] \
      || fail "El APK bloquea HTTP LAN aunque el release solicitó Master/Cliente LAN habilitado"
  else
    [[ "${cleartext_attribute}" == *'(type 0x12)0x0'* ]] \
      || fail "El APK permite HTTP LAN aunque el release solicitó política estricta"
  fi
}

# Android packaging owns its output directory and may replace it without `clean`.
# Keep versioned deliverables outside app/build and restore missing history afterward.
sync_release_artifacts() {
  node --input-type=module - "$1" "$2" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [source, destination] = process.argv.slice(2);
if (fs.existsSync(source)) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    if (!item.isFile() || !/\d+\.\d+\.\d+/.test(item.name)) continue;
    const target = path.join(destination, item.name);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(source, item.name), target);
  }
}
NODE
}

git -C "${REPO_ROOT}" fetch origin --quiet

SOURCE_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --verify "${SOURCE_REF}")" || fail "No pude resolver el ref fuente: ${SOURCE_REF}"
SOURCE_COMMIT_SHORT="$(git -C "${REPO_ROOT}" rev-parse --short "${SOURCE_COMMIT}")"
SOURCE_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref "${SOURCE_REF}" 2>/dev/null || true)"
[[ -n "${SOURCE_BRANCH}" ]] || SOURCE_BRANCH="${SOURCE_REF}"

[[ -d "${CANONICAL_BUILD_WORKTREE}" ]] || fail "No existe el checkout de build: ${CANONICAL_BUILD_WORKTREE}"

CANONICAL_STATUS="$(git -C "${CANONICAL_BUILD_WORKTREE}" status --porcelain)"
if [[ -n "${CANONICAL_STATUS}" ]]; then
  fail "El checkout de build no está limpio (${CANONICAL_BUILD_WORKTREE}). Corrige eso antes de compilar."
fi

# Sin worktree dedicada se compila el árbol actual del repo principal.
if [[ "${CANONICAL_BUILD_WORKTREE}" == "${REPO_ROOT}" ]]; then
  SOURCE_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  SOURCE_COMMIT_SHORT="$(git -C "${REPO_ROOT}" rev-parse --short "${SOURCE_COMMIT}")"
  SOURCE_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
  info "Build desde el repo principal: se compila HEAD (${SOURCE_COMMIT_SHORT}), no ${SOURCE_REF}."
fi

RELEASE_OUTPUT_DIR="${CANONICAL_BUILD_WORKTREE}/android/app/build/outputs/apk/release"
RELEASE_HISTORY_DIR="${WORKSPACE_ROOT}/_releases/Alfa-POS"
sync_release_artifacts "${RELEASE_OUTPUT_DIR}" "${RELEASE_HISTORY_DIR}"

KEY_PROPERTIES="${CANONICAL_BUILD_WORKTREE}/android/key.properties"
LOCAL_PROPERTIES="${CANONICAL_BUILD_WORKTREE}/android/local.properties"

require_file "${KEY_PROPERTIES}"
require_file "${LOCAL_PROPERTIES}"

# La ruta del keystore vive en key.properties (gitignored); no se codifica aquí.
KEYSTORE_FILE="$(sed -n 's/^storeFile=//p' "${KEY_PROPERTIES}" | tail -n1)"
[[ -n "${KEYSTORE_FILE}" ]] || fail "key.properties no define storeFile"
if [[ "${KEYSTORE_FILE}" != /* ]]; then
  KEYSTORE_FILE="${CANONICAL_BUILD_WORKTREE}/android/${KEYSTORE_FILE}"
fi
require_file "${KEYSTORE_FILE}"

SDK_DIR="$(resolve_sdk_dir "${LOCAL_PROPERTIES}")"
APKSIGNER="$(resolve_apksigner "${SDK_DIR}")"
AAPT="$(resolve_aapt "${SDK_DIR}")"

CANONICAL_GRADLE_FILE="${CANONICAL_BUILD_WORKTREE}/android/app/build.gradle"
require_file "${CANONICAL_GRADLE_FILE}"

NEXT_VERSION_CODE="$(resolve_next_version_code "${CANONICAL_GRADLE_FILE}")"
LATEST_RELEASE_VERSION_NAME="$(resolve_latest_version_name)"
SOURCE_VERSION_CODE="$(git -C "${REPO_ROOT}" show "${SOURCE_COMMIT}:android/app/build.gradle" | awk '/versionCode[[:space:]]+[0-9]+/ { print $2; exit }')"
SOURCE_VERSION_NAME="$(git -C "${REPO_ROOT}" show "${SOURCE_COMMIT}:android/app/build.gradle" | sed -n 's/.*versionName[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

if [[ "${SOURCE_VERSION_CODE}" =~ ^[0-9]+$ ]] && (( SOURCE_VERSION_CODE > NEXT_VERSION_CODE )); then
  NEXT_VERSION_CODE="${SOURCE_VERSION_CODE}"
fi

if [[ "${SOURCE_VERSION_CODE}" == "${NEXT_VERSION_CODE}" && -n "${SOURCE_VERSION_NAME}" ]]; then
  VERSION_NAME="${SOURCE_VERSION_NAME}"
elif [[ "${LATEST_RELEASE_VERSION_NAME}" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  VERSION_NAME="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
elif [[ "${SOURCE_VERSION_NAME}" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  VERSION_NAME="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
else
  VERSION_NAME="1.0.${NEXT_VERSION_CODE}"
fi

info "Fuente del release: ${SOURCE_REF} (${SOURCE_COMMIT_SHORT})"
info "VersionCode siguiente: ${NEXT_VERSION_CODE}"
info "VersionName siguiente: ${VERSION_NAME}"
info "HTTP LAN Master/Cliente: ${LAN_HTTP_ENABLED}"
info "Checkout de build: ${CANONICAL_BUILD_WORKTREE}"

# En worktree dedicada se fija el commit fuente; en el repo principal se compila
# el árbol actual (HEAD) sin dejar el checkout en detached HEAD.
if [[ "${CANONICAL_BUILD_WORKTREE}" != "${REPO_ROOT}" ]]; then
  git -C "${CANONICAL_BUILD_WORKTREE}" checkout --detach "${SOURCE_COMMIT}"
fi
BUILD_WORKTREE="${CANONICAL_BUILD_WORKTREE}"
info "Instalando dependencias del commit fuente"
(cd "${BUILD_WORKTREE}" && npm ci)
# Selective JS diagnostics deliberately do not patch Capacitor or SQLite sources.

RELEASE_GATE_REPORT="$(mktemp /private/tmp/alfapos-release-gate-XXXXXX)"
info "Ejecutando puerta antirregresión prebuild contra baseline 1.1.363"
(cd "${BUILD_WORKTREE}" && node scripts/qa/apk-release-gate.mjs \
  --stage prebuild \
  --source-commit "${SOURCE_COMMIT}" \
  --require-clean \
  --report "${RELEASE_GATE_REPORT}")

BUILD_GRADLE_FILE="${BUILD_WORKTREE}/android/app/build.gradle"
update_gradle_version "${BUILD_GRADLE_FILE}" "${NEXT_VERSION_CODE}" "${VERSION_NAME}"

info "Ejecutando npm run build"
(cd "${BUILD_WORKTREE}" && npm run build)

info "Ejecutando npx cap sync android"
(cd "${BUILD_WORKTREE}" && npx cap sync android)

info "Verificando assets Capacitor antes de firmar"
ASSET_REPORT="$(mktemp /private/tmp/alfapos-packaged-assets-XXXXXX)"
node --input-type=module - "${BUILD_WORKTREE}" "${ASSET_REPORT}" "${SOURCE_COMMIT}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [root, report, sourceCommit] = process.argv.slice(2);
const dist = path.join(root, 'dist');
const packaged = path.join(root, 'android/app/src/main/assets/public');
const hashes = {};
const walk = (dir, relative = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
    else {
      const original = fs.readFileSync(path.join(dist, name));
      const copy = fs.readFileSync(path.join(packaged, name));
      if (!original.equals(copy)) throw new Error(`Asset distinto: ${name}`);
      hashes[name] = crypto.createHash('sha256').update(copy).digest('hex');
    }
  }
};
walk(dist);
if (!Object.keys(hashes).length) throw new Error('dist está vacío');
fs.mkdirSync(path.dirname(report), { recursive: true });
fs.writeFileSync(report, JSON.stringify({ sourceCommit, assetsVerified: true, hashes }, null, 2));
console.log(`Assets verificados: ${Object.keys(hashes).length}`);
NODE

# Gradle owns the canonical output directory. Historical deliverables remain in
# RELEASE_HISTORY_DIR; only the APK produced by this run stays in app/build.
info "Ejecutando ./gradlew assembleRelease"
(cd "${BUILD_WORKTREE}/android" && ./gradlew assembleRelease \
  "-PclicPosAllowReleaseCleartext=${LAN_HTTP_ENABLED}")

APK_BASE_NAME="$(sed -n "s/.*def apkBaseName = '\([^']*\)'.*/\1/p" "${BUILD_GRADLE_FILE}" | head -n1)"
[[ -n "${APK_BASE_NAME}" ]] || APK_BASE_NAME="Alfa-Pos"

APK_SRC="${BUILD_WORKTREE}/android/app/build/outputs/apk/release/${APK_BASE_NAME}-${VERSION_NAME}-release.apk"
METADATA_SRC="${BUILD_WORKTREE}/android/app/build/outputs/apk/release/output-metadata.json"

require_file "${APK_SRC}"
require_file "${METADATA_SRC}"

info "Verificando política HTTP LAN del manifiesto"
verify_apk_network_policy "${AAPT}" "${APK_SRC}" "${LAN_HTTP_ENABLED}"

info "Verificando firma"
SIGNER_DN="$("${APKSIGNER}" verify --print-certs "${APK_SRC}" | sed -n 's/^Signer #1 certificate DN: //p' | head -n1)"
info "Firma: ${SIGNER_DN}"
EXPECTED_CERT_CN="${ALFA_POS_RELEASE_CERT_CN:-CN=Alfa POS}"
[[ "${SIGNER_DN}" == *"${EXPECTED_CERT_CN}"* ]] \
  || fail "El APK no está firmado con el certificado de Alfa POS (${EXPECTED_CERT_CN}): ${SIGNER_DN}"

DEST_DIR="${CANONICAL_BUILD_WORKTREE}/android/app/build/outputs/apk/release"
mkdir -p "${DEST_DIR}"

APK_DEST="${DEST_DIR}/${APK_BASE_NAME}-${VERSION_NAME}-release.apk"
METADATA_DEST="${DEST_DIR}/output-metadata-${VERSION_NAME}.json"
REPORT_DEST="${DEST_DIR}/release-report-${VERSION_NAME}.txt"
ASSET_REPORT_DEST="${DEST_DIR}/packaged-assets-${VERSION_NAME}.json"
RELEASE_GATE_REPORT_DEST="${DEST_DIR}/release-gate-${VERSION_NAME}.json"

[[ "${APK_SRC}" == "${APK_DEST}" ]] || cp "${APK_SRC}" "${APK_DEST}"
cp "${METADATA_SRC}" "${METADATA_DEST}"
cp "${ASSET_REPORT}" "${ASSET_REPORT_DEST}"
rm "${ASSET_REPORT}"
cp "${RELEASE_GATE_REPORT}" "${RELEASE_GATE_REPORT_DEST}"
rm "${RELEASE_GATE_REPORT}"

cat > "${REPORT_DEST}" <<EOF
versionCode=${NEXT_VERSION_CODE}
versionName=${VERSION_NAME}
sourceRef=${SOURCE_REF}
sourceBranch=${SOURCE_BRANCH}
sourceCommit=${SOURCE_COMMIT}
sourceCommitShort=${SOURCE_COMMIT_SHORT}
lanHttpEnabled=${LAN_HTTP_ENABLED}
manifestNetworkPolicyVerified=true
packagedAssetsVerified=true
packagedAssetsReport=${ASSET_REPORT_DEST}
releaseGatePrebuildPassed=true
releaseGateReport=${RELEASE_GATE_REPORT_DEST}
promotionGatePassed=false
canonicalBuildWorktree=${CANONICAL_BUILD_WORKTREE}
artifact=${APK_DEST}
metadata=${METADATA_DEST}
builtAt=$(date '+%Y-%m-%d %H:%M:%S %Z')
EOF

sync_release_artifacts "${DEST_DIR}" "${RELEASE_HISTORY_DIR}"
info "APK listo"
echo "APK=${APK_DEST}"
echo "METADATA=${METADATA_DEST}"
echo "REPORT=${REPORT_DEST}"
echo "SOURCE_COMMIT=${SOURCE_COMMIT_SHORT}"
echo "VERSION_NAME=${VERSION_NAME}"
