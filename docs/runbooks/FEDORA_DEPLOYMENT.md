# Fedora single-host deployment runbook

This runbook describes how to deploy FreeBlackMarket to a single Fedora 40+
server using Docker Compose, nginx + certbot, and either a manual deploy
script or the `Deploy to Fedora` GitHub Actions workflow.

It also describes how to migrate **all** existing data (Postgres + MinIO)
out of Railway and onto the new server.

> Railway remains configured as a fallback. Nothing in `backend/railway.json`,
> `backend/railway.staging.json`, or `backend/scripts/railway-start.js` is
> changed by this runbook.

---

## 0. What you'll set up

```
                ┌─────────────────────────────────────────────────┐
                │  Fedora 40+ server                              │
   Public DNS   │                                                  │
   ───────────► │  nginx :443 (TLS via certbot) ──► loopback ports │
                │       │                                          │
                │       ├─► storefront  127.0.0.1:3000             │
                │       ├─► backend     127.0.0.1:9000             │
                │       ├─► admin       127.0.0.1:7000             │
                │       └─► vendor      127.0.0.1:7001             │
                │                                                  │
                │  Compose services (all loopback-only):           │
                │   postgres:5432  redis:6379  minio:9100/9101     │
                └─────────────────────────────────────────────────┘
```

Hostnames mirror `infrastructure/k8s/production/30-ingress.yaml`:

- `freeblackmarket.com` → storefront
- `api.freeblackmarket.com` → backend (Medusa)
- `admin.freeblackmarket.com` → admin panel
- `vendor.freeblackmarket.com` → vendor panel

---

## 1. Server prerequisites

- **OS**: Fedora 40 or 41 (other distros work but `setup.sh` uses `dnf`).
- **Resources**: 4 vCPU, 8 GB RAM, ≥ 40 GB disk minimum (Postgres + MinIO
  grow over time; size for at least 1 year of media).
- **Network**: public IPv4 (and ideally IPv6); ports 22 / 80 / 443 reachable.
- **DNS**: 4 × A records pointing at the server IP for the four hostnames
  above. Lower TTL to 60 s **at least 24 hours before** your planned cutover.

---

## 2. First-time bootstrap

SSH to the server as a sudo-capable user, then:

```bash
# 1. Get the repo (anywhere you like - it gets cloned again as the deploy user later).
sudo dnf install -y git
sudo git clone https://github.com/blackmarket-coa/free-black-market.git /tmp/fbm-bootstrap

# 2. Run the bootstrap script. Installs Docker, nginx, certbot, firewalld,
#    creates the 'fbm' deploy user, prepares /opt/fbm.
sudo bash /tmp/fbm-bootstrap/infrastructure/fedora/setup.sh
```

What `setup.sh` does:
- `dnf install` Docker CE + compose plugin, nginx, certbot, postgresql client,
  jq, rsync, firewalld, SELinux helpers.
- Enables + starts `docker`, `nginx`, `firewalld`.
- Opens 22 / 80 / 443 in firewalld; everything else stays closed.
- Creates the `fbm` user, adds it to the `docker` group.
- Creates `/opt/fbm` owned by `fbm:fbm`.
- Sets `httpd_can_network_connect` SELinux boolean (so nginx can proxy to
  loopback ports).

When it finishes, follow the on-screen "Next steps" output (also reproduced
below).

### 2.1 Authorize SSH for the deploy user

```bash
sudo -u fbm mkdir -p /home/fbm/.ssh
echo 'ssh-ed25519 AAAA…your-deploy-key…' | sudo tee -a /home/fbm/.ssh/authorized_keys
sudo chmod 700 /home/fbm/.ssh
sudo chmod 600 /home/fbm/.ssh/authorized_keys
sudo chown -R fbm:fbm /home/fbm/.ssh
```

The same key (private half) is what you'll set as the GitHub Actions
`FEDORA_SSH_KEY` secret.

### 2.2 Clone the repo into /opt/fbm

```bash
sudo -u fbm git clone https://github.com/blackmarket-coa/free-black-market.git /opt/fbm
```

### 2.3 Write `.env.production`

```bash
sudo -u fbm cp /opt/fbm/.env.production.example /opt/fbm/.env.production
sudo -u fbm $EDITOR /opt/fbm/.env.production
```

Fill in **every** key the example flags as required. In particular:
- `IMAGE_TAG`, `GHCR_OWNER`, `GHCR_USERNAME`, `GHCR_TOKEN`
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `COOKIE_SECRET`,
  `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD`
- `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PUBLIC_URL`
- All `*_CORS` lists with the production hostnames
- `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `ALGOLIA_*`, `SENTRY_DSN`, etc.

The backend's `scripts/assert-env.mjs` runs at startup and refuses to boot
with placeholder values - the example file marks every value that has a
banned default.

### 2.4 Install nginx vhost + obtain TLS certs

```bash
sudo bash /opt/fbm/infrastructure/fedora/nginx/install.sh
sudo bash /opt/fbm/infrastructure/fedora/certbot/issue-certs.sh you@example.com
```

certbot's nginx plugin will inject TLS server blocks and the HTTP→HTTPS
redirect into `/etc/nginx/conf.d/freeblackmarket.conf` automatically.

For dry runs against Let's Encrypt staging (no rate-limit risk):
```bash
sudo bash /opt/fbm/infrastructure/fedora/certbot/issue-certs.sh you@example.com --staging
```

Verify auto-renewal:
```bash
sudo certbot renew --dry-run
```

### 2.5 First deploy

```bash
sudo -u fbm bash -c 'cd /opt/fbm && bash scripts/deploy-fedora.sh latest'
```

The script:
1. `docker login ghcr.io` using the `.env.production` PAT.
2. `docker compose pull` for the four app images.
3. Starts data services (postgres, redis, minio) and waits for postgres health.
4. Runs `medusa db:migrate` in a one-shot container.
5. `docker compose up -d` for the four app services.
6. Polls each app's local `/health` (90 s budget). On failure, prints the
   last 50 log lines from each failing container and exits non-zero.

### 2.6 Enable boot-time start

```bash
sudo cp /opt/fbm/infrastructure/fedora/systemd/fbm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fbm.service
sudo systemctl status fbm.service
```

After this, the stack comes up automatically on host reboot.

---

## 3. Ongoing deploys (CI)

Use the **Deploy to Fedora** workflow in GitHub Actions
(`.github/workflows/fedora-deploy.yml`). Inputs:

| Input         | Example          | Notes |
| ------------- | ---------------- | ----- |
| `image_tag`   | `sha-abc1234`    | Built by `docker-build.yml` and pushed to GHCR. |
| `environment` | `production`     | Selects post-deploy hostnames + GH Environment for approvals. |
| `git_ref`     | `main`           | The ref to checkout on the server (so compose/scripts match). |

Required repository secrets:

| Secret                          | Purpose |
| ------------------------------- | ------- |
| `FEDORA_HOST`                   | Hostname or IP of the server. |
| `FEDORA_USER`                   | Deploy user (`fbm`). |
| `FEDORA_SSH_KEY`                | Private SSH key authorized for `fbm@FEDORA_HOST`. |
| `FEDORA_SSH_PORT`               | (Optional) Custom SSH port. Defaults to 22. |

Optional secrets / environment variables (override default smoke-test hostnames):

| Secret                            | Default                          |
| --------------------------------- | -------------------------------- |
| `FBM_PROD_API_HOST`               | `api.freeblackmarket.com`        |
| `FBM_PROD_STOREFRONT_HOST`        | `freeblackmarket.com`            |
| `FBM_STAGING_API_HOST`            | `staging-api.freeblackmarket.com`|
| `FBM_STAGING_STOREFRONT_HOST`     | `staging.freeblackmarket.com`    |

Trigger via the Actions UI ("Run workflow") or the `gh` CLI from your laptop.

### Manual deploy (no workflow)

```bash
ssh fbm@<server>
cd /opt/fbm
git fetch && git checkout main && git pull --ff-only
bash scripts/deploy-fedora.sh sha-abc1234
```

### Rollback

Re-run the workflow with the previous known-good `image_tag`. There is no
schema downgrade - migrations are forward-only - but Medusa migrations are
small, additive, and tolerant of older app versions for one or two releases.
For breaking schema changes, restore from the most recent Postgres backup
(see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)).

---

## 4. Backup & restore

### Postgres
Reuse the existing helper:
```bash
sudo -u fbm bash /opt/fbm/scripts/backup-db.sh
```
Schedule it with `cron` or a `systemd` timer. Off-site copies recommended
(e.g. `rclone` to S3 or another box).

### MinIO
Bucket-to-bucket copy with `mc`:
```bash
mc mirror --overwrite fbm-fedora/medusa-media s3-offsite/fbm-media-$(date +%Y%m%d)
```

See [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) for the full restore procedure.

---

## 5. Railway → Fedora data migration

This section is the heart of the cutover. Two stateful systems live on
Railway: **Postgres** and **MinIO**. Redis holds only cache and sessions
and is intentionally **not** migrated.

### 5.1 Capture Railway state

On your laptop, with the [Railway CLI](https://docs.railway.app/develop/cli)
logged in to the FBM project:

```bash
railway link                                              # confirm project
railway variables --service backend  --kv > railway.env
railway variables --service postgres --kv >> railway.env
railway variables --service minio    --kv >> railway.env  # if MinIO is a Railway service
```

From `railway.env` you get the source `DATABASE_URL`,
`MINIO_ENDPOINT/_ACCESS_KEY/_SECRET_KEY/_BUCKET`, plus all third-party
secrets (Stripe, Resend, Algolia, JWT/cookie, Sentry). Map every
non-data secret into your new `.env.production` on the Fedora box.

### 5.2 Prepare the migration script

```bash
cp scripts/migrate-railway-to-fedora.sh.env.example railway-migration.env  # if you make a copy
# or just create railway-migration.env with these keys:
cat > railway-migration.env <<'EOF'
SOURCE_DATABASE_URL=postgres://USER:PASS@containers-us-west-XX.railway.app:7777/railway
TARGET_DATABASE_URL=postgres://medusa:STRONG_PW@127.0.0.1:5432/medusa

SOURCE_MINIO_ENDPOINT=https://bucket-production-XXXX.up.railway.app
SOURCE_MINIO_ACCESS_KEY=...
SOURCE_MINIO_SECRET_KEY=...
SOURCE_MINIO_BUCKET=medusa-media

TARGET_MINIO_ENDPOINT=http://127.0.0.1:9100
TARGET_MINIO_ACCESS_KEY=...
TARGET_MINIO_SECRET_KEY=...
TARGET_MINIO_BUCKET=medusa-media

FEDORA_HOST=your-server.example.com
FEDORA_USER=fbm
EOF

chmod 600 railway-migration.env
```

The script also reads these from the environment if you prefer not to use
the file. **Keep this file out of git** (the `.env*` rule covers it).

### 5.3 Dry run

```bash
bash scripts/migrate-railway-to-fedora.sh --phase pg    --dry-run
bash scripts/migrate-railway-to-fedora.sh --phase minio --dry-run
```

A dry run prints what would happen and verifies tooling is present
(`pg_dump`, `pg_restore`, `psql`, `mc`).

### 5.4 Run for real

```bash
# Postgres only
bash scripts/migrate-railway-to-fedora.sh --phase pg

# MinIO only
bash scripts/migrate-railway-to-fedora.sh --phase minio

# Or both back-to-back
bash scripts/migrate-railway-to-fedora.sh --phase all
```

What the script does, in order:

**Postgres phase**
1. Capture row counts on Railway for `product`, `customer`, `order`,
   `vendor`, `cart`. Saves `counts-railway-<TS>.tsv`.
2. `pg_dump --format=custom --compress=9` to `railway-fbm-<TS>.dump`.
3. **Prompts to confirm** before destructive steps.
4. SSH to Fedora, `docker compose stop backend`.
5. `psql … -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public'` on target.
6. `pg_restore --jobs=4` into target.
7. Capture target row counts → diff against the source. Aborts if mismatched.
8. SSH to Fedora, `docker compose up -d backend`.
   `railway-start.js` runs idempotent migrations on boot, so any newer
   schema in the deployed image gets applied automatically.

**MinIO phase**
1. Configure `mc` aliases for source (Railway) and target (Fedora).
2. `mc ls --recursive` source bucket → object list.
3. `mc mb` target bucket if missing; set anonymous read.
4. `mc mirror --overwrite --preserve` source → target.
5. `mc ls --recursive` target → diff object lists. Aborts on mismatch.

A timestamped `migration-<TS>.log` transcript is written for the audit trail.

### 5.5 Cutover sequence (production)

| When     | Action |
| -------- | ------ |
| **T-24 h** | Lower DNS TTL to 60 s on all four hostnames. |
| **T-2 h**  | Full Fedora deploy at empty DB; smoke test against staging hostnames. |
| **T-30 m** | First `mc mirror` pass (bulk of object data; can be slow). |
| **T-10 m** | Disable Railway storefront ingress (Railway dashboard → backend service → suspend, or scale replicas to 0). New writes stop. |
| **T-0**    | Final `pg_dump` from Railway → `pg_restore` to Fedora. |
| **T+5 m**  | Final `mc mirror --overwrite` (catches anything written in the last 30 m). |
| **T+10 m** | Flip DNS A records to Fedora IP. |
| **T+10 m – T+1 h** | Watch Sentry, container logs, `/health`, place test orders. |
| **T+24 h** | Raise DNS TTL back to a reasonable value (e.g. 1 h). |
| **T+7 d**  | Decommission Railway services. |

### 5.6 Rollback (within 1 h of cutover)

If issues surface within 1 h **and** no significant Fedora writes have
happened, flip DNS back to Railway and bring the Railway backend back online.

If writes did happen on Fedora, dump-back: same script, swapped vars
(make `SOURCE_DATABASE_URL` point at Fedora and `TARGET_DATABASE_URL` at
Railway). The transcript file is the source of truth.

---

## 6. Day-2 operations cheat sheet

```bash
# Tail one service
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend

# Tail every service
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=100

# Restart one service
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend

# Bring everything down (data volumes survive)
sudo systemctl stop fbm.service
# … or:
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Free up old image versions
docker image prune -a --filter "until=168h"

# Reload nginx after editing the vhost
sudo bash /opt/fbm/infrastructure/fedora/nginx/install.sh

# Renew TLS manually (cron handles this automatically)
sudo certbot renew

# Show stack status
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

---

## 7. Troubleshooting

| Symptom                                           | First thing to check |
| ------------------------------------------------- | -------------------- |
| `502 Bad Gateway` from nginx                      | Is the upstream container running? `docker compose ps`. SELinux: `getsebool httpd_can_network_connect` should be `on`. |
| Backend stuck in `unhealthy`                      | `docker compose logs backend` — usually a missing env var or the DB isn't ready. `assert-env.mjs` will name the failing key. |
| Storefront 500s for product images                | `MINIO_PUBLIC_URL` mismatch. Must be reachable from the browser **and** match the bucket on the Fedora MinIO. |
| `certbot --nginx` fails                           | DNS not pointing at the server yet, or :80 blocked by firewalld. |
| `pg_restore` complains about ownership            | The script passes `--no-owner --no-privileges` already; if you see this, you ran restore by hand. |
| `mc mirror` keeps timing out                      | Add `--retry 5 --part-size 16M`. For very large buckets, use `mc mirror --watch=false` in chunks per prefix. |
| GHCR pull says `unauthorized`                     | Refresh `GHCR_TOKEN` (PAT must have `read:packages`); re-run deploy script. |
