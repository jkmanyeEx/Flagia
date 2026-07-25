#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?usage: receive-deploy.sh RELEASE_ID}"
APP_HOME="${FLAGIA_HOME:-/home/ubuntu/Flagia}"

if [[ ! "$release_id" =~ ^[A-Fa-f0-9]{7,64}$ ]]; then
  echo "Invalid release ID." >&2
  exit 1
fi

archive="$APP_HOME/incoming/$release_id.tar.gz"
release_dir="$APP_HOME/releases/$release_id"

if [[ ! -f "$archive" ]]; then
  echo "Missing release archive: $archive" >&2
  exit 1
fi

mkdir -p "$release_dir"
tar -xzf "$archive" -C "$release_dir"
rm -f "$archive"

"$release_dir/scripts/activate-release.sh" "$release_dir"
