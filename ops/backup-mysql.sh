#!/usr/bin/env bash
set -euo pipefail

APP_HOME="${FLAGIA_HOME:-/home/ubuntu/Flagia}"
ENV_FILE="$APP_HOME/shared/.env"
BACKUP_DIR="$APP_HOME/backups/mysql"
MAX_BACKUP_BYTES="${MAX_BACKUP_BYTES:-2147483648}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
chmod 0750 "$BACKUP_DIR"

mysql_defaults="$(mktemp)"
raw_dump="$(mktemp "$BACKUP_DIR/.flagia-dump.XXXXXX.sql")"
trap 'rm -f "$mysql_defaults" "$raw_dump"' EXIT
chmod 0600 "$mysql_defaults" "$raw_dump"
cat > "$mysql_defaults" <<EOF
[client]
host=$DB_HOST
port=$DB_PORT
user=$DB_USER
password=$DB_PASSWORD
default-character-set=utf8mb4
EOF

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_backup="$BACKUP_DIR/flagia-$timestamp.sql.gz"

mysqldump --defaults-extra-file="$mysql_defaults" \
  --single-transaction --quick --routines --triggers --events --no-tablespaces \
  "$DB_NAME" > "$raw_dump"
gzip -9c "$raw_dump" > "$final_backup"
chmod 0600 "$final_backup"

# Retention is bounded by both age and an absolute 2 GiB default quota.
find "$BACKUP_DIR" -type f -name 'flagia-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
while (( $(du -sb "$BACKUP_DIR" | awk '{print $1}') > MAX_BACKUP_BYTES )); do
  oldest="$(find "$BACKUP_DIR" -type f -name 'flagia-*.sql.gz' -printf '%T@ %p\n' \
    | sort -n | head -1 | cut -d' ' -f2-)"
  [[ -n "$oldest" ]] || break
  rm -f -- "$oldest"
done

echo "Backup complete: $final_backup"
