#!/bin/sh
set -eu

normalize_base_path() {
  path=$1
  # trim leading/trailing whitespace
  trimmed=$(printf '%s' "${path}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -z "$trimmed" ] || [ "$trimmed" = "/" ]; then
    printf '%s' ''
    return
  fi
  case "$trimmed" in
    /*) ;;
    *) trimmed="/$trimmed" ;;
  esac
  # remove trailing slashes
  trimmed=$(printf '%s' "$trimmed" | sed 's:/\+$::')
  printf '%s' "$trimmed"
}

BASE_PATH=$(normalize_base_path "${PUBLIC_BASE_PATH-}")
OUTPUT_DIR="/usr/share/nginx/html${BASE_PATH}"
OUTPUT="${OUTPUT_DIR}/runtime-env.js"
LEGACY_OUTPUT="/usr/share/nginx/html/runtime-env.js"

mkdir -p "$OUTPUT_DIR"
mkdir -p "$(dirname "$LEGACY_OUTPUT")"

api_json=$(printf '%s' "${PUBLIC_API_BASE_URL-}" | jq -R .)
ws_json=$(printf '%s' "${PUBLIC_WS_URL-}" | jq -R .)
base_path_json=$(printf '%s' "${PUBLIC_BASE_PATH-}" | jq -R .)

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

cat <<RUNTIME_EOF > "$tmpfile"
window.__RUNTIME_CONFIG__ = {
  PUBLIC_BASE_PATH: ${base_path_json},
  PUBLIC_API_BASE_URL: ${api_json},
  PUBLIC_WS_URL: ${ws_json}
};
RUNTIME_EOF

cp "$tmpfile" "$OUTPUT"

if [ -n "$BASE_PATH" ]; then
  cp "$tmpfile" "$LEGACY_OUTPUT"
fi

rm -f "$tmpfile"

exec "$@"
