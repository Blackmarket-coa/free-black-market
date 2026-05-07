# Fedora single-host deployment

This directory contains everything needed to provision a fresh Fedora 40+
server to run the FreeBlackMarket Docker Compose stack behind nginx + TLS.

For the full step-by-step procedure (DNS, secrets, cutover, rollback,
backup/restore, Railway data migration), see
[`docs/runbooks/FEDORA_DEPLOYMENT.md`](../../docs/runbooks/FEDORA_DEPLOYMENT.md).

## Files

| Path                                   | Purpose |
| -------------------------------------- | ------- |
| `setup.sh`                             | One-shot host bootstrap (Docker, nginx, certbot, firewalld, deploy user). Idempotent. |
| `nginx/freeblackmarket.conf`           | nginx vhost: 4 server blocks reverse-proxying to `127.0.0.1:{3000,9000,7000,7001}`. |
| `nginx/install.sh`                     | Copy vhost into `/etc/nginx/conf.d/`, `nginx -t`, reload. |
| `certbot/issue-certs.sh`               | Run `certbot --nginx` for all four hostnames; enable renewal timer. |
| `systemd/fbm.service`                  | `Type=oneshot`, `RemainAfterExit=yes` unit that brings the stack up at boot. |

## Quick reference (after first run)

```bash
# Re-deploy with a specific image tag (run as the fbm user)
cd /opt/fbm && bash scripts/deploy-fedora.sh sha-abc1234

# Tail logs for one service
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend

# Reload nginx after editing the vhost
sudo bash /opt/fbm/infrastructure/fedora/nginx/install.sh

# Renew TLS manually
sudo certbot renew

# Restart stack via systemd
sudo systemctl restart fbm.service
```

## Expectations

- **Hostnames** match `infrastructure/k8s/production/30-ingress.yaml`:
  `freeblackmarket.com`, `api.freeblackmarket.com`,
  `admin.freeblackmarket.com`, `vendor.freeblackmarket.com`.
- **Images** are pulled from `ghcr.io/blackmarket-coa/free-black-market-*`
  (published by `.github/workflows/docker-build.yml`).
- **Postgres, Redis, MinIO** run on the same host with named Docker volumes.
- **TLS** is terminated by nginx; all app ports listen on `127.0.0.1` only.
- **Boot-time start** is handled by `fbm.service` once enabled.
