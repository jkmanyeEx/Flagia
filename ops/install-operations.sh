#!/usr/bin/env bash
set -euo pipefail

APP_HOME="${FLAGIA_HOME:-/home/ubuntu/Flagia}"
APP_USER="${FLAGIA_USER:-ubuntu}"

pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 set pm2-logrotate:max_size 10M >/dev/null
pm2 set pm2-logrotate:retain 7 >/dev/null
pm2 set pm2-logrotate:compress true >/dev/null
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss >/dev/null

sudo tee /etc/systemd/system/flagia-health.service >/dev/null <<EOF
[Unit]
Description=Flagia local health check
After=network-online.target mysql.service pm2-${APP_USER}.service

[Service]
Type=oneshot
User=${APP_USER}
Environment=FLAGIA_HOME=${APP_HOME}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=${APP_HOME}/current/ops/health-check.sh
EOF

sudo tee /etc/systemd/system/flagia-health.timer >/dev/null <<'EOF'
[Unit]
Description=Run the Flagia health check every two minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo tee /etc/systemd/system/flagia-backup.service >/dev/null <<EOF
[Unit]
Description=Flagia MySQL backup
After=mysql.service

[Service]
Type=oneshot
User=${APP_USER}
Environment=FLAGIA_HOME=${APP_HOME}
ExecStart=${APP_HOME}/current/ops/backup-mysql.sh
EOF

sudo tee /etc/systemd/system/flagia-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Run the Flagia MySQL backup daily

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now flagia-health.timer flagia-backup.timer
