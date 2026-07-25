#!/usr/bin/env bash
set -euo pipefail

APP_HOME="${FLAGIA_HOME:-$HOME/Flagia}"
ENV_FILE="$APP_HOME/shared/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production environment file: $ENV_FILE" >&2
  exit 1
fi

cd "$APP_HOME/current"
env -i \
  HOME="$HOME" \
  USER="${USER:-ubuntu}" \
  LOGNAME="${LOGNAME:-ubuntu}" \
  PATH="/usr/local/bin:/usr/bin:/bin" \
  PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
  FLAGIA_ROOT="$APP_HOME/current" \
  /usr/local/bin/pm2 delete flagia-frontend flagia-backend >/dev/null 2>&1 || true
env -i \
  HOME="$HOME" \
  USER="${USER:-ubuntu}" \
  LOGNAME="${LOGNAME:-ubuntu}" \
  PATH="/usr/local/bin:/usr/bin:/bin" \
  PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
  FLAGIA_ROOT="$APP_HOME/current" \
  /usr/local/bin/pm2 start ecosystem.config.cjs
/usr/local/bin/pm2 save
