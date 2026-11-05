#!/usr/bin/env bash
#
# Verifica que un APK contenga las funciones que debe llevar antes de publicarlo.
#
#   ./APK/verify-apk.sh                          # el APK release más reciente de APK/
#   ./APK/verify-apk.sh APK/Clic-Pos-1.1.375-release.apk
#   ./APK/verify-apk.sh --list                   # solo lista lo que encuentra
#
# Sale con código 1 si falta alguna función obligatoria. La lista por defecto
# cubre lo que debe llegar al cliente: EGO Club, CardNET e identidad estable.
#
# Contexto: la 1.1.374 publicada se compiló desde un worktree firmado atrasado y
# salió SIN EGO Club aunque el repo ya lo tenía. Este script existe para que eso
# no vuelva a pasar en silencio.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REQUIRED=(
  "Alta EGO Club"
  "Tarjeta EGO Club"
  "Canjear puntos EGO Club"
  "CardNET"
  "ANDROID-"
)

LIST_ONLY="false"
APK_PATH=""
for arg in "$@"; do
  case "${arg}" in
    --list) LIST_ONLY="true" ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *.apk) APK_PATH="${arg}" ;;
  esac
done

if [[ -z "${APK_PATH}" ]]; then
  APK_PATH="$(ls -t "${SCRIPT_DIR}"/*-release.apk 2>/dev/null | head -1 || true)"
  [[ -n "${APK_PATH}" ]] || APK_PATH="$(ls -t "${SCRIPT_DIR}"/*.apk 2>/dev/null | head -1 || true)"
fi

if [[ -z "${APK_PATH}" || ! -f "${APK_PATH}" ]]; then
  echo "ERROR: no encontré un APK. Indica la ruta: ./APK/verify-apk.sh APK/algo.apk" >&2
  exit 1
fi

echo "[verify] $(basename "${APK_PATH}") ($(du -h "${APK_PATH}" | cut -f1))"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

unzip -q -o "${APK_PATH}" 'assets/public/assets/*' -d "${TMP}" 2>/dev/null || true
BUNDLE_FILES=$(ls "${TMP}"/assets/public/assets/*.js 2>/dev/null | wc -l | tr -d ' ')
if [[ "${BUNDLE_FILES}" == "0" ]]; then
  echo "ERROR: el APK no contiene el bundle web (assets/public/assets/*.js)." >&2
  exit 1
fi

BUNDLE="${TMP}/assets/public/assets"
hits() { { grep -rl -F -- "$1" "${BUNDLE}"/*.js 2>/dev/null || true; } | wc -l | tr -d ' '; }

# Identidad del binario, si hay build-tools disponibles.
BT="$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools/"* 2>/dev/null | tail -1 || true)"
if [[ -n "${BT}" && -x "${BT}/aapt2" ]]; then
  BADGING="$( { "${BT}/aapt2" dump badging "${APK_PATH}" 2>/dev/null || true; } | head -1 || true)"
  [[ -n "${BADGING}" ]] && echo "[verify] ${BADGING}"
fi
if [[ -n "${BT}" && -x "${BT}/apksigner" ]]; then
  CERT="$( { "${BT}/apksigner" verify --print-certs "${APK_PATH}" 2>/dev/null || true; } \
           | grep -E "certificate SHA-256 digest" | head -1 || true)"
  if [[ -n "${CERT}" ]]; then
    echo "[verify] ${CERT}"
  else
    echo "[verify] firma: NO VERIFICADA (APK sin firmar)"
  fi
fi

echo "[verify] ${BUNDLE_FILES} chunks JS"
MISSING=()
for needle in "${REQUIRED[@]}"; do
  n="$(hits "${needle}")"
  if [[ "${n}" -gt 0 ]]; then
    printf '[verify]   OK    %-26s %s archivo(s)\n' "${needle}" "${n}"
  else
    printf '[verify]   FALTA %-26s 0 archivos\n' "${needle}"
    MISSING+=("${needle}")
  fi
done

if [[ "${LIST_ONLY}" == "true" ]]; then
  exit 0
fi

if [[ "${#MISSING[@]}" -gt 0 ]]; then
  echo
  echo "ERROR: el APK no puede publicarse; le faltan:" >&2
  for m in "${MISSING[@]}"; do echo "  - ${m}" >&2; done
  echo "       Compila desde la rama que sí las tiene (no desde un worktree atrasado)." >&2
  exit 1
fi

echo
echo "[verify] APK válido para publicar."
