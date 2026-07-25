#!/usr/bin/env bash
set -euo pipefail

failures=()

curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null \
  || failures+=("backend health endpoint")
curl -fsS --max-time 5 http://127.0.0.1:5173/ >/dev/null \
  || failures+=("frontend static server")
systemctl is-active --quiet mysql || failures+=("mysql service")
pm2 pid flagia-backend | grep -Eq '^[1-9][0-9]*$' || failures+=("flagia-backend PM2 process")
pm2 pid flagia-frontend | grep -Eq '^[1-9][0-9]*$' || failures+=("flagia-frontend PM2 process")

disk_percent="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if [[ -n "$disk_percent" ]] && (( disk_percent >= 85 )); then
  failures+=("root disk usage ${disk_percent}%")
fi

available_kb="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo)"
if [[ -n "$available_kb" ]] && (( available_kb < 153600 )); then
  failures+=("available memory below 150 MiB")
fi

if (( ${#failures[@]} > 0 )); then
  message="Flagia health check failed: $(IFS=', '; echo "${failures[*]}")"
  logger -p user.err -t flagia-monitor "$message"
  echo "$message" >&2
  exit 1
fi

echo "Flagia health check passed"
