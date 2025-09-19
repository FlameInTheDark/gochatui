#!/bin/sh
set -eu

OUTPUT="/usr/share/nginx/html/runtime-env.js"

mkdir -p "$(dirname "$OUTPUT")"

api_json=$(printf '%s' "${PUBLIC_API_BASE_URL-}" | jq -R .)
ws_json=$(printf '%s' "${PUBLIC_WS_URL-}" | jq -R .)
base_path_json=$(printf '%s' "${PUBLIC_BASE_PATH-}" | jq -R .)

cat <<RUNTIME_EOF > "$OUTPUT"
window.__RUNTIME_CONFIG__ = {
  PUBLIC_BASE_PATH: ${base_path_json},
  PUBLIC_API_BASE_URL: ${api_json},
  PUBLIC_WS_URL: ${ws_json}
};
RUNTIME_EOF

exec "$@"
