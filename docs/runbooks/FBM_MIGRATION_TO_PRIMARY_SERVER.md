# FBM Migration to Primary Server

**Last validated:** _not yet executed; first run is the migration itself._

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.4 (unified deployment topology) and §7.2 (foundation milestone deliverable).

This runbook covers the foundation-milestone migration of FBM from Railway to the primary HP ProLiant DL360 Gen9 server. The DL360 has 384 GB RAM and 40 CPU threads with substantial unused capacity that comfortably accommodates FBM's Postgres workload alongside the co-located Synapse federation traffic, the ClickHouse analytics workload, and the future PostGIS spatial workload.

The migration is a one-time event but the runbook is written so it can be re-run on a fresh primary server (e.g. after hardware replacement) without modification.

## Prerequisites

Before starting, confirm:

- [ ] Primary DL360 is provisioned with the OS, Docker, and the operator's SSH key.
- [ ] Cloudflare Tunnel is installed on the primary server and reachable from Cloudflare. The tunnel token is held in the secrets manager per [`SECRETS_MANAGER_MIGRATION.md`](./SECRETS_MANAGER_MIGRATION.md).
- [ ] DNS is hosted on Cloudflare and the records to be cut over are identified (storefront, vendor panel, admin panel, backend API, MinIO public endpoint if exposed).
- [ ] Postgres on the primary server is sized for the consolidated workload per the §4.1 watch-items.
- [ ] MinIO is running on the primary server with the production bucket created.
- [ ] Backups of the existing Railway deployment are current per [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).
- [ ] A maintenance window has been announced to coalition partners.
- [ ] Secrets-manager migration ([`SECRETS_MANAGER_MIGRATION.md`](./SECRETS_MANAGER_MIGRATION.md)) has been completed or is being executed in the same window.
- [ ] Stripe webhook URLs and Stellar callback URLs are listed for re-pointing (Step 6).

## Inventory

Items to migrate from Railway to primary server. Each row records the source, the destination on the primary server, and the migration mechanism.

| Item | Source (Railway) | Destination (primary) | Mechanism |
|------|------------------|------------------------|-----------|
| Postgres database | Railway managed Postgres | DL360 Postgres instance | `pg_dump` → restore |
| MinIO objects (vendor uploads, listing media, digital products) | Railway-attached object store | DL360 MinIO bucket | `mc mirror` |
| Backend env vars | Railway dashboard | secrets manager | manual via [`SECRETS_MANAGER_MIGRATION.md`](./SECRETS_MANAGER_MIGRATION.md) |
| Backend, storefront, admin-panel, vendor-panel images | GHCR (already shared) | DL360 Docker | `docker pull` (no migration needed) |
| Cloudflare DNS records | Cloudflare (already correct) | Cloudflare | DNS cutover (Step 5) |
| Stripe webhook URLs | Stripe dashboard | n/a | re-point (Step 6) |
| Stellar callback URLs (testnet first, mainnet later) | Stellar Anchor configuration | n/a | re-point (Step 6) |
| GitHub Actions deploy targets | `.github/workflows/*-deploy.yml` | DL360 | update workflow secrets / kubeconfig |

## Migration steps

### 1. Pre-cutover validation (T-24h)

```bash
# On primary server: confirm services are up and pointing at the right Postgres/MinIO.
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec backend pnpm exec medusa --version

# Confirm Cloudflare Tunnel is healthy.
systemctl status cloudflared

# Confirm secrets manager is populated (do NOT print values).
# See SECRETS_MANAGER_MIGRATION.md "Validation" section.
```

The primary server should be running an idle copy of the FBM stack pointing at an empty Postgres database and an empty MinIO bucket. This is the warm target for the cutover.

### 2. Take final Railway backups (T-1h)

```bash
# Postgres dump from Railway.
RAILWAY_DB_URL="postgres://..." # from Railway dashboard, do not commit
pg_dump --format=custom --no-owner --no-privileges "$RAILWAY_DB_URL" \
  > /tmp/fbm-railway-final-$(date +%Y%m%d-%H%M).dump

# Verify dump integrity.
pg_restore --list /tmp/fbm-railway-final-*.dump | head -50
```

Upload the dump to offsite storage (Backblaze B2 per [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md)) before proceeding.

### 3. Enter maintenance mode (T-0)

```bash
# On Railway: set MAINTENANCE_MODE=true on the backend service env.
# This causes the backend to return 503 with a coalition-friendly message
# on every non-healthcheck route.
```

Confirm the storefront and vendor panel display the maintenance page.

### 4. Migrate data

```bash
# Restore Postgres on primary.
PRIMARY_DB_URL="postgres://..." # held in secrets manager
pg_restore \
  --no-owner --no-privileges \
  --dbname="$PRIMARY_DB_URL" \
  --jobs=4 \
  /tmp/fbm-railway-final-*.dump

# Sync MinIO objects from Railway object store to primary MinIO.
mc alias set railway-src   "$RAILWAY_S3_ENDPOINT"  "$RAILWAY_S3_KEY"  "$RAILWAY_S3_SECRET"
mc alias set primary-dest  "$PRIMARY_MINIO_ENDPOINT" "$PRIMARY_MINIO_KEY" "$PRIMARY_MINIO_SECRET"

mc mirror --watch=false railway-src/fbm-prod primary-dest/fbm-prod

# Verify object count and total size match.
mc du railway-src/fbm-prod
mc du primary-dest/fbm-prod
```

### 5. DNS cutover

Update the following Cloudflare DNS records to point at the primary server's tunnel:

- `storefront.<apex>` → primary tunnel
- `vendor.<apex>` → primary tunnel
- `admin.<apex>` → primary tunnel
- `api.<apex>` → primary tunnel
- `media.<apex>` (MinIO public, if exposed) → primary tunnel

Cloudflare's TTL on tunnel-routed records is short, so propagation completes within minutes. Use `dig +short <name>` from a third-party resolver to confirm cutover.

### 6. Re-point external integrations

- **Stripe**: in the Stripe dashboard, update each webhook URL from `https://<railway-host>/...` to `https://api.<apex>/...`. Test each webhook with the dashboard's "Send test webhook" button and confirm a 200 response.
- **Stellar**: update the Anchor callback URLs (testnet first, mainnet later) to the primary `api.<apex>` host.
- **GitHub OAuth applications**: update the callback URLs to point at the primary host.
- **Any other OAuth providers** (Google, Discord, Patreon, Streamlabs): update redirect URIs.

### 7. Bring up FBM on primary

```bash
# On primary: take the stack out of idle and run a real boot.
docker compose -f docker-compose.prod.yml up -d backend storefront admin-panel vendor-panel

# Run the env validator (it runs at startup but verify no banned values).
docker compose -f docker-compose.prod.yml exec backend node scripts/assert-env.mjs

# Confirm migrations have been applied (the dump was a snapshot of the
# Railway schema; the primary should not need additional migrations).
docker compose -f docker-compose.prod.yml exec backend pnpm exec medusa db:migrate --dry-run
```

### 8. Smoke-test the primary

Run the smoke tests from [`DEPLOYMENT.md`](./DEPLOYMENT.md) Step 5/8 against the cut-over hostnames:

- Storefront browse and product detail page render.
- Vendor login → list orders.
- Admin login → list users.
- `GET /api/health`, `/healthz`, `/health/ready` all return 200.
- One test order placed end-to-end (against Stripe test mode if mainnet is not yet active).

### 9. Exit maintenance mode

```bash
# On Railway: set MAINTENANCE_MODE=false (or shut down the Railway service entirely
# if the cutover has been validated; see Decommission below).
```

### 10. Hold Railway in warm fallback for 7 days

Do **not** decommission Railway immediately. Keep the Railway deployment running but pointed at its Postgres snapshot from Step 2 (read-only). The DNS records are now on the primary, so Railway is no longer in the user path; it serves as a 7-day warm fallback in case a regression surfaces.

After 7 days of clean operation on the primary with no rollback events, proceed to Decommission.

## Validation checklist

A migration is **complete** when all of the following hold:

- [ ] DNS for all five hostnames resolves to the primary server's tunnel.
- [ ] Storefront, vendor panel, admin panel, backend API all return 200 on healthchecks.
- [ ] At least one test order has been placed end-to-end through the primary.
- [ ] Stripe webhook test fires return 200.
- [ ] At least one Stellar testnet settlement has cleared end-to-end.
- [ ] Postgres row counts on key tables (`order`, `customer`, `vendor`, `entitlement`, `payout_breakdown`) match the Railway dump within zero rows.
- [ ] MinIO object count on the primary matches Railway within zero objects.
- [ ] Observability dashboards show normal traffic patterns within 24 hours of cutover.
- [ ] Backup job on the primary has run at least once and the dump is in offsite storage per [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).

## Rollback procedure

If a regression is identified within the 7-day warm-fallback window:

### Same-day rollback (DNS only)

If the issue is identified within the first hour and no significant write traffic has flowed to the primary's Postgres, the cleanest rollback is DNS-only:

1. Re-point all five DNS records back at Railway.
2. Take Railway out of `MAINTENANCE_MODE`.
3. Investigate the regression on the primary in parallel.

The data on the primary is the Railway snapshot, so no data reconciliation is needed.

### Multi-day rollback (with data reconciliation)

If significant writes have occurred on the primary (more than ~1 hour of normal traffic), DNS-only rollback would lose those writes. Instead:

1. Re-enter maintenance mode on the primary.
2. Take a fresh `pg_dump` of the primary's Postgres.
3. Restore to a fresh Railway database.
4. Re-sync MinIO from primary back to Railway.
5. DNS cutover back to Railway.
6. Exit maintenance mode.

This is essentially the migration in reverse and should only be needed if a structural regression is discovered after substantial production traffic.

## Decommission (T+7 days minimum)

Once the warm-fallback window has elapsed without rollback:

1. Snapshot the Railway Postgres one final time and store it in long-term offsite storage (separate from the rolling backup bucket).
2. Snapshot the Railway MinIO bucket the same way.
3. Stop Railway services.
4. Remove Railway dashboard URLs from `runbooks/DEPLOYMENT.md` Path B (or mark Path B as historical).
5. Revoke the Railway-side service tokens at the secrets manager.
6. Update [`SPOF_MAP.md`](../operations/SPOF_MAP.md) — Railway is no longer a relevant component.

## Cross-references

- [`SECRETS_MANAGER_MIGRATION.md`](./SECRETS_MANAGER_MIGRATION.md) — should be completed before or in the same window.
- [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — provides the dump and bucket-sync mechanics referenced above.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — defines the smoke-test checklist used in Step 8.
- [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — invoked if anything regresses during cutover.
- [`SPOF_MAP.md`](../operations/SPOF_MAP.md) — SPOF-01 (the primary server) and SPOF-02 (Cloudflare Tunnel) are exercised by this migration.
- [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.4, §4.1, §7.2.
