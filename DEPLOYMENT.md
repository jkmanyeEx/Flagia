# Flagia production deployment

## Target

- Ubuntu 26.04 LTS x86_64 on AWS EC2
- Application home: `/home/ubuntu/Flagia`
- Frontend: PM2 static server on `127.0.0.1:5173`
- Backend/API/WebSocket: Node.js + PM2 on `127.0.0.1:3000`
- Database: MySQL on `127.0.0.1:3306`
- Public ingress: remotely managed Cloudflare Tunnel

Cloudflare public hostnames:

| Public hostname | Local origin |
| --- | --- |
| `flagia.kr` | `http://127.0.0.1:5173` |
| `api.flagia.kr` | `http://127.0.0.1:3000` |

Only SSH needs an inbound EC2 security-group rule. Restrict port 22 to the
administrator's source IP. Ports 5173, 3000, 3306, 80, and 443 remain closed.

## One-time EC2 bootstrap

Upload the repository's `scripts/bootstrap-ec2.sh`, then run it as the `ubuntu`
user:

```bash
bash scripts/bootstrap-ec2.sh
```

The script installs Node.js 24 LTS, MySQL, PM2, `cloudflared`, UFW, a 1 GiB
safety swap file, and creates `/home/ubuntu/Flagia/shared/.env` with random
database and JWT secrets. The environment file stays on EC2 and is mode `0600`.

The Cloudflare token is deliberately not automated. Rotate any token that has
been disclosed, then install the replacement interactively:

```bash
/home/ubuntu/Flagia/current/scripts/install-cloudflared-service.sh
```

## GitHub Actions secrets

The `production` environment needs:

- `EC2_HOST`: the EC2 public DNS name
- `EC2_USER`: `ubuntu` (optional; this is the default)
- `EC2_SSH_KEY`: the complete private key
- `EC2_KNOWN_HOSTS`: verified `known_hosts` line for the EC2 host

Database and JWT secrets are not copied through GitHub. They remain in
`/home/ubuntu/Flagia/shared/.env`.

Every push to `main` builds on a GitHub-hosted runner, uploads a minimal release,
applies schema migrations, atomically switches `/home/ubuntu/Flagia/current`,
restarts the two Flagia PM2 processes, runs local health checks, and retains the
three newest releases. A failed health check restores the previous symlink.

## Operations

- PM2 state is restored at boot by systemd.
- PM2 logs rotate at 10 MiB and retain seven archives.
- `flagia-health.timer` checks the application every two minutes.
- `flagia-backup.timer` creates a compressed MySQL dump daily.
- Backups retain seven days and are capped at 2 GiB total.

Useful commands:

```bash
pm2 status
pm2 logs --lines 100 --nostream
curl http://127.0.0.1:3000/api/health
systemctl status cloudflared mysql flagia-health.timer flagia-backup.timer
journalctl -u flagia-health.service --since today
ls -lh /home/ubuntu/Flagia/backups/mysql
```

Manual rollback:

```bash
ls -1dt /home/ubuntu/Flagia/releases/*
ln -sfn /home/ubuntu/Flagia/releases/RELEASE_ID /home/ubuntu/Flagia/.current-next
mv -Tf /home/ubuntu/Flagia/.current-next /home/ubuntu/Flagia/current
/home/ubuntu/Flagia/current/pm2_startup.sh
```
