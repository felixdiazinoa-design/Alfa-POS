#!/usr/bin/env bash
#
# Compila el APK de CLIC-POS y lo deja en esta misma carpeta (APK/).
#
#   ./APK/build-apk.sh              # APK debug (instalable en emulador)
#   ./APK/build-apk.sh debug        # igual que arriba
#   ./APK/build-apk.sh release      # APK release (requiere firma para instalar)
#   ./APK/build-apk.sh debug --skip-web   # reutiliza dist/ y android assets ya generados
#   ./APK/build-apk.sh release --no-bump  # no incrementa versionCode/versionName
#
# Por defecto cada compilación incrementa el secuencial: versionCode +1 y el
# patch de versionName en paralelo (1374/1.1.374 → 1375/1.1.375), para que
# ninguna release reutilice el identificador anterior. Usa --no-bump solo para
# reintentar un build que ya consumió su número.
#
# Salidas:
#   APK/Clic-Pos-<versionName>-debug.apk          (+ .sha256)
#   APK/Clic-Pos-<versionName>-release.apk        si hay keystore configurado
#   APK/unsigned/…                                APK release sin keystore (no instalable)
#   APK/logs/build-<tipo>-<fecha>.log             log completo del build
#
# Al terminar ejecuta APK/verify-apk.sh: si al binario le falta EGO Club,
# CardNET o el id de dispositivo estable, el build falla y no se publica.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VARIANT="${1:-debug}"
SKIP_WEB="false"
BUMP_VERSION="true"
for arg in "$@"; do
  case "${arg}" in
    --skip-web) SKIP_WEB="true" ;;
    --no-bump) BUMP_VERSION="false" ;;
  esac
done

case "${VARIANT}" in
  debug|release) ;;
  -h|--help)
    sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "ERROR: variante desconocida '${VARIANT}'. Usa debug o release." >&2
    exit 1
    ;;
esac

GRADLE_TASK="assembleDebug"
[[ "${VARIANT}" == "release" ]] && GRADLE_TASK="assembleRelease"

export PATH="/usr/local/bin:${PATH}"
mkdir -p "${SCRIPT_DIR}/logs" "${SCRIPT_DIR}/unsigned"
LOG_FILE="${SCRIPT_DIR}/logs/build-${VARIANT}-$(date '+%Y%m%d-%H%M%S').log"

info() { echo "[apk] $*"; }
run() {
  info "$*"
  if ! "$@" >>"${LOG_FILE}" 2>&1; then
    echo "ERROR: falló: $*" >&2
    echo "       revisa el log: ${LOG_FILE}" >&2
    tail -25 "${LOG_FILE}" >&2
    exit 1
  fi
}

# Secuencial por compilación: versionCode +1 y patch de versionName en paralelo.
# Convención histórica del repo: 1374 ↔ 1.1.374 (name = "1.1." + code-1000).
GRADLE_FILE="${REPO_ROOT}/android/app/build.gradle"

bump_version() {
  local current_code current_name next_code next_name
  [[ -f "${GRADLE_FILE}" ]] || { echo "ERROR: no existe ${GRADLE_FILE}" >&2; exit 1; }

  current_code="$(awk '/versionCode[[:space:]]+[0-9]+/ { print $2; exit }' "${GRADLE_FILE}")"
  current_name="$(sed -n 's/.*versionName[[:space:]]*"\([^"]*\)".*/\1/p' "${GRADLE_FILE}" | head -1)"
  [[ "${current_code}" =~ ^[0-9]+$ ]] || { echo "ERROR: no pude leer versionCode" >&2; exit 1; }

  next_code=$((current_code + 1))
  if (( next_code > 1000 && next_code < 2000 )); then
    next_name="1.1.$((next_code - 1000))"
  else
    # Fuera de la convención 1xxx: incrementa el último segmento numérico.
    next_name="$(awk -v n="${current_name}" 'BEGIN {
      split(n, parts, ".")
      last = parts[length(parts)] + 0
      parts[length(parts)] = last + 1
      out = parts[1]
      for (i = 2; i <= length(parts); i++) out = out "." parts[i]
      print out
    }')"
  fi

  node --input-type=module -e '
    import fs from "node:fs";
    const [file, code, name] = process.argv.slice(1);
    let source = fs.readFileSync(file, "utf8");
    source = source.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    source = source.replace(/versionName\s+"[^"]+"/, `versionName "${name}"`);
    fs.writeFileSync(file, source);
  ' "${GRADLE_FILE}" "${next_code}" "${next_name}" || {
    echo "ERROR: no pude escribir la versión en ${GRADLE_FILE}" >&2
    exit 1
  }

  info "Secuencial: ${current_name} (${current_code}) → ${next_name} (${next_code})"
  echo "${next_code}" > "${SCRIPT_DIR}/.last-version-code"
}

if [[ "${BUMP_VERSION}" == "true" ]]; then
  bump_version
else
  info "Sin incremento de versión (--no-bump): se reutiliza el secuencial actual."
fi

cd "${REPO_ROOT}"

if [[ "${SKIP_WEB}" == "false" ]]; then
  info "Compilando web (vite) y sincronizando Capacitor…"
  run npm run build
  run npx cap sync android
else
  info "Se reutiliza dist/ y android/app/src/main/assets/public (--skip-web)."
fi

# Origen del registro de APK que queda dentro del binario.
# VITE_ALFA_ADMIN_BASE_URL (o .env) manda; si no está, el APK consulta Cloud-Admin.
resolve_apk_update_origin() {
  local env_file value
  value="${VITE_ALFA_ADMIN_BASE_URL:-}"
  if [[ -z "${value}" ]]; then
    for env_file in "${REPO_ROOT}/.env" "${REPO_ROOT}/.env.local" "${REPO_ROOT}/.env.production"; do
      [[ -f "${env_file}" ]] || continue
      value="$(sed -n 's/^VITE_ALFA_ADMIN_BASE_URL=//p' "${env_file}" | tail -1 | tr -d '"' | tr -d "'" | tr -d '\r')"
      [[ -n "${value}" ]] && break
    done
  fi
  echo "${value}"
}

ALFA_ADMIN_URL="$(resolve_apk_update_origin)"
if [[ -n "${ALFA_ADMIN_URL}" ]]; then
  info "Registro de APK: ${ALFA_ADMIN_URL} (ALFA-Admin)"
elif grep -rqs "cloud-admin.clicsuite.com" "${REPO_ROOT}/dist/assets" 2>/dev/null; then
  info "AVISO: el APK consultará Cloud-Admin (https://cloud-admin.clicsuite.com/api/pos-apk/latest)."
  info "       Para que apunte a ALFA-Admin define VITE_ALFA_ADMIN_BASE_URL en .env y recompila."
fi

info "Ejecutando ${GRADLE_TASK}…"
run bash -c "cd '${REPO_ROOT}/android' && ./gradlew ${GRADLE_TASK} --console=plain"

info "APK listo:"
shopt -s nullglob
FOUND=0
for apk in "${SCRIPT_DIR}"/*.apk; do
  FOUND=1
  SIZE="$(du -h "${apk}" | cut -f1)"
  printf '  %-46s %s\n' "$(basename "${apk}")" "${SIZE}"
  if [[ -f "${apk}.sha256" ]]; then
    printf '  %-46s %s\n' "" "sha256 $(cut -d' ' -f1 "${apk}.sha256")"
  fi
done
for apk in "${SCRIPT_DIR}"/unsigned/*.apk; do
  FOUND=1
  printf '  %-46s %s\n' "unsigned/$(basename "${apk}")" "(SIN FIRMA: no se puede instalar)"
done
shopt -u nullglob

if [[ "${FOUND}" == "0" ]]; then
  echo "ERROR: no se generó ningún APK. Revisa ${LOG_FILE}" >&2
  exit 1
fi

# Puerta de contenido: un APK sin EGO Club o sin CardNET no debe publicarse.
# (La 1.1.374 salió sin EGO Club porque se compiló desde un worktree atrasado.)
if [[ -x "${SCRIPT_DIR}/verify-apk.sh" ]]; then
  VERIFY_TARGET="$(ls -t "${SCRIPT_DIR}"/*-"${VARIANT}".apk 2>/dev/null | head -1 || true)"
  if [[ -n "${VERIFY_TARGET}" ]]; then
    echo
    info "Verificando contenido de $(basename "${VERIFY_TARGET}")…"
    if ! "${SCRIPT_DIR}/verify-apk.sh" "${VERIFY_TARGET}"; then
      echo "ERROR: el APK no contiene todo lo requerido; revisa el log del build." >&2
      exit 1
    fi
  fi
fi

echo
echo "[apk] log: ${LOG_FILE}"
echo "[apk] instalar en el emulador/dispositivo: ./APK/install-apk.sh"
