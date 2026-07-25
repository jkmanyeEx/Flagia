# Workspace guide: production operations

The production application runs on AWS EC2 and is deployed from a GitHub-hosted
Actions runner over SSH. There is no self-hosted runner on the server.

For the complete deployment and operations reference, see
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Runtime layout

```text
/home/ubuntu/Flagia/
├── current -> releases/<commit-or-release-id>
├── releases/             # three newest releases retained
├── incoming/             # temporary upload location
├── shared/.env           # server-only runtime secrets, mode 0600
└── backups/mysql/        # seven days, maximum 2 GiB
```

Local services:

- Frontend: `127.0.0.1:5173`
- Backend and WebSocket: `127.0.0.1:3000`
- MySQL: `127.0.0.1:3306`
- Public ingress: Cloudflare Tunnel

## Routine diagnostics

Connect using the EC2 SSH key and inspect:

```bash
pm2 status
pm2 logs --lines 100 --nostream
curl http://127.0.0.1:3000/api/health
systemctl status mysql cloudflared pm2-ubuntu
systemctl list-timers --all | grep flagia
journalctl -u flagia-health.service --since today
ls -lh /home/ubuntu/Flagia/backups/mysql
```

The systemd health timer runs every two minutes and verifies the frontend,
backend, MySQL, PM2 processes, disk space, and available memory. Failures are
written to the journal with the `flagia-monitor` tag:

```bash
journalctl -t flagia-monitor
```

## Database access

Database credentials are deliberately not stored in GitHub or the repository.
They remain in `/home/ubuntu/Flagia/shared/.env`. To use the MySQL client
interactively without printing the password:

```bash
set -a
. /home/ubuntu/Flagia/shared/.env
set +a
mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME"
```

Daily compressed dumps are created by `flagia-backup.timer`. Run an immediate
backup with:

```bash
sudo systemctl start flagia-backup.service
sudo systemctl status flagia-backup.service
```
