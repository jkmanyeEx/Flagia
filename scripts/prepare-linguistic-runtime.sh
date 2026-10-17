#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?release directory required}"
APP_HOME="${FLAGIA_HOME:-/home/ubuntu/Flagia}"
backend="$release_dir/flagia-backend"
test -f "$backend/.linguistic-local/model/manifest.json"
test -f "$backend/linguistic/runtime-lock.txt"

if ! python3 -m venv --help >/dev/null 2>&1 || ! dpkg-query -W -f='${Status}' python3-venv 2>/dev/null | grep -q 'install ok installed'; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv
fi

lock_id="$(sha256sum "$backend/linguistic/runtime-lock.txt" | cut -c1-16)"
venv="$APP_HOME/shared/linguistic-venvs/$lock_id"
mkdir -p "$(dirname "$venv")"
if [[ ! -f "$venv/.ready" ]]; then
  python3 -m venv "$venv"
  "$venv/bin/python" -m pip install --no-cache-dir -r "$backend/linguistic/runtime-lock.txt" \
    --extra-index-url https://download.pytorch.org/whl/cpu
  touch "$venv/.ready"
fi
ln -sfn "$venv" "$backend/.venv-linguistic"

echo "[deploy] Verifying model integrity and offline inference before activation"
(
  cd "$backend"
  /usr/local/bin/node dist/linguistic/runtime_test.js
)
