#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?usage: activate-release.sh RELEASE_DIRECTORY}"
APP_HOME="${FLAGIA_HOME:-/home/ubuntu/Flagia}"
ENV_FILE="$APP_HOME/shared/.env"

release_dir="$(readlink -f "$release_dir")"
case "$release_dir" in
  "$APP_HOME"/releases/*) ;;
  *)
    echo "Release must be inside $APP_HOME/releases" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Run scripts/bootstrap-ec2.sh first." >&2
  exit 1
fi

echo "[deploy] Installing production backend dependencies"
(
  cd "$release_dir/flagia-backend"
  npm ci --omit=dev --no-audit --no-fund
)

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

run_pm2() {
  env -i \
    HOME="$HOME" \
    USER="${USER:-ubuntu}" \
    LOGNAME="${LOGNAME:-ubuntu}" \
    PATH="/usr/local/bin:/usr/bin:/bin" \
    PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
    FLAGIA_ROOT="$APP_HOME/current" \
    /usr/local/bin/pm2 "$@"
}

mysql_defaults="$(mktemp)"
trap 'rm -f "$mysql_defaults"' EXIT
chmod 0600 "$mysql_defaults"
cat > "$mysql_defaults" <<EOF
[client]
host=$DB_HOST
port=$DB_PORT
user=$DB_USER
password=$DB_PASSWORD
default-character-set=utf8mb4
EOF

echo "[deploy] Initializing and migrating the database"
table_count="$(mysql --defaults-extra-file="$mysql_defaults" "$DB_NAME" --batch --skip-column-names \
  -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users';")"
if [[ "$table_count" == "0" ]]; then
  # mysql_dump.sql creates the complete initial schema. The database/user were
  # already provisioned by bootstrap-ec2.sh.
  mysql --defaults-extra-file="$mysql_defaults" < "$release_dir/flagia-backend/mysql_dump.sql"
fi

shopt -s nullglob
for migration in "$release_dir"/flagia-backend/migrations/*.sql; do
  echo "[deploy] Applying $(basename "$migration")"
  mysql --defaults-extra-file="$mysql_defaults" "$DB_NAME" < "$migration"
done

# PM2 does not need application secrets in its own saved environment. The
# backend loads them directly from ENV_FILE through Node's --env-file option.
unset DB_PASSWORD JWT_SECRET

previous_release=""
if [[ -L "$APP_HOME/current" ]]; then
  previous_release="$(readlink -f "$APP_HOME/current")"
fi

next_link="$APP_HOME/.current-next"
ln -sfn "$release_dir" "$next_link"
mv -Tf "$next_link" "$APP_HOME/current"

echo "[deploy] Activating PM2 processes"
(
  cd "$APP_HOME/current"
  run_pm2 delete flagia-frontend flagia-backend >/dev/null 2>&1 || true
  run_pm2 start ecosystem.config.cjs
  run_pm2 save
)

healthy=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null \
    && curl -fsS --max-time 3 http://127.0.0.1:5173/ >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != "true" ]]; then
  echo "[deploy] Health check failed; restoring the previous release." >&2
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$next_link"
    mv -Tf "$next_link" "$APP_HOME/current"
    (
      cd "$APP_HOME/current"
      run_pm2 delete flagia-frontend flagia-backend >/dev/null 2>&1 || true
      run_pm2 start ecosystem.config.cjs
      run_pm2 save
    )
  fi
  run_pm2 logs --lines 80 --nostream
  exit 1
fi

echo "[deploy] Installing backup and monitoring timers"
"$APP_HOME/current/ops/install-operations.sh"

echo "[deploy] Regrading completed submissions with the current engine"
(
  cd "$APP_HOME/current/flagia-backend"
  /usr/local/bin/node --env-file="$ENV_FILE" dist/regrade.js
) || echo "[deploy] Regrade failed; application remains online."

echo "[deploy] Keeping the three newest releases"
mapfile -t old_releases < <(
  find "$APP_HOME/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr | awk 'NR > 3 { sub(/^[^ ]+ /, ""); print }'
)
for old_release in "${old_releases[@]}"; do
  if [[ "$old_release" != "$(readlink -f "$APP_HOME/current")" ]]; then
    rm -rf -- "$old_release"
  fi
done

echo "[deploy] Release active: $(basename "$release_dir")"
