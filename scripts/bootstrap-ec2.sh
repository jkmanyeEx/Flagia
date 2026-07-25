#!/usr/bin/env bash
set -euo pipefail

APP_HOME="${FLAGIA_HOME:-/home/ubuntu/Flagia}"
APP_USER="${FLAGIA_USER:-ubuntu}"
NODE_VERSION="${NODE_VERSION:-v24.18.0}"
NODE_ARCHIVE="node-${NODE_VERSION}-linux-x64.tar.xz"

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This bootstrap currently targets x86_64 EC2 instances." >&2
  exit 1
fi

echo "[1/8] Installing operating-system packages"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl xz-utils openssl mysql-server ufw jq

echo "[2/8] Installing Node.js ${NODE_VERSION} from the official distribution"
if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != "$NODE_VERSION" ]]; then
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  curl -fsSLo "$work_dir/$NODE_ARCHIVE" \
    "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"
  curl -fsSLo "$work_dir/SHASUMS256.txt" \
    "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
  (
    cd "$work_dir"
    grep " ${NODE_ARCHIVE}\$" SHASUMS256.txt | sha256sum --check -
  )
  sudo mkdir -p "/opt/node-${NODE_VERSION}"
  sudo tar -xJf "$work_dir/$NODE_ARCHIVE" \
    -C "/opt/node-${NODE_VERSION}" --strip-components=1
  for binary in node npm npx corepack; do
    sudo ln -sfn "/opt/node-${NODE_VERSION}/bin/$binary" "/usr/local/bin/$binary"
  done
fi

echo "[3/8] Installing PM2 and log rotation"
sudo "/opt/node-${NODE_VERSION}/bin/npm" install -g pm2
sudo ln -sfn "/opt/node-${NODE_VERSION}/bin/pm2" /usr/local/bin/pm2
sudo ln -sfn "/opt/node-${NODE_VERSION}/bin/pm2-runtime" /usr/local/bin/pm2-runtime

echo "[4/8] Installing cloudflared (connector will be activated separately)"
if ! command -v cloudflared >/dev/null 2>&1; then
  cloudflared_deb="$(mktemp)"
  curl -fsSLo "$cloudflared_deb" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i "$cloudflared_deb"
  rm -f "$cloudflared_deb"
fi

echo "[5/8] Configuring MySQL for the 2 GiB prototype host"
sudo tee /etc/mysql/mysql.conf.d/99-flagia.cnf >/dev/null <<'EOF'
[mysqld]
bind-address = 127.0.0.1
mysqlx-bind-address = 127.0.0.1
max_connections = 60
innodb_buffer_pool_size = 256M
slow_query_log = ON
long_query_time = 2
EOF
sudo systemctl enable --now mysql
sudo systemctl restart mysql

echo "[6/8] Creating application directories and server-side secrets"
sudo install -d -o "$APP_USER" -g "$APP_USER" -m 0750 \
  "$APP_HOME" \
  "$APP_HOME/incoming" \
  "$APP_HOME/releases" \
  "$APP_HOME/shared" \
  "$APP_HOME/backups/mysql"

env_file="$APP_HOME/shared/.env"
if [[ ! -f "$env_file" ]]; then
  db_password="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 48)"
  umask 077
  {
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=3000"
    echo "CORS_ORIGINS=https://flagia.kr,https://www.flagia.kr"
    echo "DB_HOST=127.0.0.1"
    echo "DB_PORT=3306"
    echo "DB_NAME=flagia"
    echo "DB_USER=flagia"
    echo "DB_PASSWORD=$db_password"
    echo "JWT_SECRET=$jwt_secret"
  } > "$env_file"
fi
chmod 0600 "$env_file"

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || [[ ! "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DB_NAME and DB_USER may contain only letters, digits, and underscores." >&2
  exit 1
fi
escaped_db_password="${DB_PASSWORD//\'/\'\'}"
sudo mysql --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1'
  IDENTIFIED BY '$escaped_db_password';
ALTER USER '$DB_USER'@'127.0.0.1'
  IDENTIFIED BY '$escaped_db_password';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

echo "[7/8] Enabling the PM2 boot service and host firewall"
# PM2's generated Type=forking unit relies on a user-owned PID file. Newer
# systemd releases reject that PID-file ownership pattern during restart. A
# oneshot/resurrect unit avoids the incompatible PIDFile contract while PM2
# still supervises the actual Node processes.
sudo tee "/etc/systemd/system/pm2-${APP_USER}.service" >/dev/null <<EOF
[Unit]
Description=PM2 process manager for ${APP_USER}
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=oneshot
User=${APP_USER}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=PM2_HOME=/home/${APP_USER}/.pm2
RemainAfterExit=yes
ExecStart=/usr/local/bin/pm2 resurrect
ExecReload=/usr/local/bin/pm2 reload all
ExecStop=/usr/local/bin/pm2 kill
TimeoutStartSec=60
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "pm2-${APP_USER}.service"
sudo ufw allow OpenSSH
sudo ufw --force enable

echo "[8/8] Creating a small safety swap file"
if ! swapon --show=NAME --noheadings | grep -q .; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 0600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
fi

echo
echo "EC2 bootstrap complete."
echo "The Cloudflare package is installed but no tunnel token was used."
