#!/usr/bin/env bash
#
# Instala en el emulador/dispositivo el APK compilado en APK/.
#
#   ./APK/install-apk.sh                     # instala el APK más reciente de APK/
#   ./APK/install-apk.sh APK/mi-app.apk      # instala un APK concreto
#   ./APK/install-apk.sh --replace           # desinstala antes (BORRA los datos locales)
#   ./APK/install-apk.sh --launch            # abre la app al terminar
#   ./APK/install-apk.sh -s 127.0.0.1:6555   # elige el dispositivo (Genymotion usa ese puerto)
#
# Usa ADB en vez del drag & drop de Genymotion: el diálogo
# "An error occured while deploying the file" suele ser un APK sin firmar o un
# conflicto de firma, y aquí se explica el motivo real.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ID="com.clicpos.app"

APK_FILE=""
SERIAL=""
REPLACE="false"
LAUNCH="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--serial) SERIAL="${2:-}"; shift 2 ;;
    --replace) REPLACE="true"; shift ;;
    --launch) LAUNCH="true"; shift ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) APK_FILE="$1"; shift ;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "[adb] $*"; }

# --- SDK / adb ---
find_adb() {
  local candidate
  for candidate in \
    "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
    "${ANDROID_HOME:-}/platform-tools/adb" \
    "${HOME}/Library/Android/sdk/platform-tools/adb" \
    "$(command -v adb 2>/dev/null || true)"
  do
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

find_apksigner() {
  local sdk_root build_tools
  sdk_root="$(cd "$(dirname "${ADB}")/.." && pwd)"
  build_tools="$(ls -1 "${sdk_root}/build-tools" 2>/dev/null | sort -V | tail -1 || true)"
  [[ -n "${build_tools}" ]] || return 1
  [[ -x "${sdk_root}/build-tools/${build_tools}/apksigner" ]] || return 1
  echo "${sdk_root}/build-tools/${build_tools}/apksigner"
}

ADB="$(find_adb)" || fail "No encontré adb. Instala Android Platform Tools o exporta ANDROID_SDK_ROOT."

# --- dispositivo ---
if [[ -z "${SERIAL}" ]]; then
  DEVICES="$("${ADB}" devices | awk 'NR>1 && $2=="device" {print $1}')"
  [[ -n "${DEVICES}" ]] || fail "No hay emulador ni dispositivo conectado. Abre el emulador (Genymotion) o conecta el equipo por USB."
  # Preferencia: Genymotion (127.0.0.1:6555), luego el primero disponible.
  SERIAL="127.0.0.1:6555"
  if ! printf '%s\n' "${DEVICES}" | grep -qx "${SERIAL}"; then
    SERIAL="$(printf '%s\n' "${DEVICES}" | head -1)"
  fi
fi

"${ADB}" -s "${SERIAL}" get-state >/dev/null 2>&1 || fail "El dispositivo ${SERIAL} no responde a adb."

DEVICE_MODEL="$("${ADB}" -s "${SERIAL}" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
DEVICE_SDK="$("${ADB}" -s "${SERIAL}" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
DEVICE_ABIS="$("${ADB}" -s "${SERIAL}" shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r')"
info "Dispositivo: ${SERIAL} · ${DEVICE_MODEL} · API ${DEVICE_SDK} · ${DEVICE_ABIS}"

# --- APK ---
if [[ -z "${APK_FILE}" ]]; then
  APK_FILE="$(ls -1t "${SCRIPT_DIR}"/*.apk 2>/dev/null | head -1 || true)"
  [[ -n "${APK_FILE}" ]] || APK_FILE="$(ls -1t "${SCRIPT_DIR}"/unsigned/*.apk 2>/dev/null | head -1 || true)"
  [[ -n "${APK_FILE}" ]] || fail "No hay APK en ${SCRIPT_DIR}. Compila primero: ./APK/build-apk.sh"
fi

[[ -f "${APK_FILE}" ]] || fail "No existe el APK: ${APK_FILE}"
info "APK: ${APK_FILE} ($(du -h "${APK_FILE}" | cut -f1))"

# --- firma: es la causa habitual del error de Genymotion ---
APKSIGNER="$(find_apksigner || true)"
if [[ -n "${APKSIGNER}" ]]; then
  if ! "${APKSIGNER}" verify "${APK_FILE}" >/dev/null 2>&1; then
    echo >&2
    fail "Este APK NO está firmado, y Genymotion lo rechaza con \"An error occured while deploying the file\".
       - Para probar en el emulador usa el APK debug:  ./APK/build-apk.sh debug
       - Para release necesitas android/key.properties + keystore:  ./scripts/release-android.sh"
  fi
  SIGNER="$("${APKSIGNER}" verify --print-certs "${APK_FILE}" 2>/dev/null | sed -n 's/.*certificate DN: //p' | head -1)"
  info "Firma verificada: ${SIGNER:-desconocido}"
else
  info "Aviso: no encontré apksigner; se omite la verificación de firma."
fi

# --- ABI ---
ABIS_IN_APK="$(unzip -l "${APK_FILE}" 2>/dev/null | awk '/lib\//{print $4}' | cut -d/ -f2 | sort -u | tr '\n' ' ')"
if [[ -n "${ABIS_IN_APK// /}" ]]; then
  MATCH="false"
  for abi in ${DEVICE_ABIS//,/ }; do
    [[ " ${ABIS_IN_APK} " == *" ${abi} "* ]] && MATCH="true"
  done
  [[ "${MATCH}" == "true" ]] || fail "El APK no trae librerías nativas para este dispositivo (APK: ${ABIS_IN_APK} · dispositivo: ${DEVICE_ABIS})."
  info "ABIs del APK: ${ABIS_IN_APK}"
fi

# --- instalación ---
if [[ "${REPLACE}" == "true" ]]; then
  info "Desinstalando ${APP_ID} (se pierden los datos locales)…"
  "${ADB}" -s "${SERIAL}" uninstall "${APP_ID}" >/dev/null 2>&1 || true
fi

info "Instalando…"
INSTALL_OUTPUT="$("${ADB}" -s "${SERIAL}" install -r "${APK_FILE}" 2>&1 || true)"
echo "${INSTALL_OUTPUT}" | sed 's/^/    /'

if echo "${INSTALL_OUTPUT}" | grep -qiE "^Success|Success$"; then
  :
else
  echo >&2
  case "${INSTALL_OUTPUT}" in
    *NO_CERTIFICATES*) fail "APK sin firma. Usa el APK debug (./APK/build-apk.sh debug)." ;;
    *UPDATE_INCOMPATIBLE*)
      fail "Firma distinta a la app ya instalada. Ejecuta: ./APK/install-apk.sh --replace  (borra los datos locales)" ;;
    *VERSION_DOWNGRADE*) fail "El APK tiene versionCode menor que el instalado. Sube versionCode o usa --replace." ;;
    *NO_MATCHING_ABIS*) fail "ABIs incompatibles con el emulador (ver mensaje arriba)." ;;
    *INSUFFICIENT_STORAGE*) fail "Sin espacio en el emulador. Libera espacio o crea un dispositivo con más disco." ;;
    *TEST_ONLY*) fail "El APK es 'test only'. Usa el build normal (assembleDebug)." ;;
    *) fail "Fallo al instalar. Revisa el mensaje de adb de arriba." ;;
  esac
fi

info "Instalado ${APP_ID} correctamente."

if [[ "${LAUNCH}" == "true" ]]; then
  info "Abriendo la app…"
  "${ADB}" -s "${SERIAL}" shell am start -n "${APP_ID}/.MainActivity" >/dev/null 2>&1 || \
    info "No se pudo abrir automáticamente; ábrela desde el launcher."
  sleep 6
  PID="$("${ADB}" -s "${SERIAL}" shell pidof "${APP_ID}" 2>/dev/null | tr -d '\r')"
  if [[ -n "${PID}" ]]; then
    info "App en ejecución (pid ${PID})."
  else
    echo "AVISO: la app no quedó en ejecución. Revisa el log:" >&2
    echo "  ${ADB} -s ${SERIAL} logcat -d | grep -E 'FATAL|AndroidRuntime'" >&2
  fi
fi
