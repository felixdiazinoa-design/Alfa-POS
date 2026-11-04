#!/usr/bin/env bash
#
# Compila el APK de CLIC-POS y lo deja en esta misma carpeta (APK/).
#
#   ./APK/build-apk.sh              # APK debug (instalable en emulador)
#   ./APK/build-apk.sh debug        # igual que arriba
#   ./APK/build-apk.sh release      # APK release (requiere firma para instalar)
#   ./APK/build-apk.sh debug --skip-web   # reutiliza dist/ y android assets ya generados
#
# Salidas:
#   APK/Clic-Pos-<versionName>-debug.apk          (+ .sha256)
#   APK/Clic-Pos-<versionName>-release.apk        si hay keystore configurado
#   APK/unsigned/…                                APK release sin keystore (no instalable)
#   APK/logs/build-<tipo>-<fecha>.log             log completo del build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VARIANT="${1:-debug}"
SKIP_WEB="false"
for arg in "$@"; do
  case "${arg}" in
    --skip-web) SKIP_WEB="true" ;;
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

cd "${REPO_ROOT}"

if [[ "${SKIP_WEB}" == "false" ]]; then
  info "Compilando web (vite) y sincronizando Capacitor…"
  run npm run build
  run npx cap sync android
else
  info "Se reutiliza dist/ y android/app/src/main/assets/public (--skip-web)."
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

echo
echo "[apk] log: ${LOG_FILE}"
echo "[apk] instalar en el emulador/dispositivo: ./APK/install-apk.sh"
