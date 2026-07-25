#!/usr/bin/env bash
set -euo pipefail

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Run scripts/bootstrap-ec2.sh first." >&2
  exit 1
fi

echo "Paste the newly rotated Cloudflare tunnel token."
echo "Input is hidden and the token is not written to this repository."
read -r -s -p "Tunnel token: " tunnel_token
echo

if [[ -z "$tunnel_token" ]]; then
  echo "No token supplied." >&2
  exit 1
fi

sudo cloudflared service uninstall >/dev/null 2>&1 || true
sudo cloudflared service install "$tunnel_token"
unset tunnel_token
sudo systemctl enable --now cloudflared
sudo systemctl --no-pager --full status cloudflared
