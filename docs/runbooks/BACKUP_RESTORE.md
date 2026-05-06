# Backup & Restore

**Last validated:** 2026-05-06

## What we back up

| Asset | Storage | Frequency | Retention | Owner |
|-------|---------|-----------|-----------|-------|
| Postgres (managed DB) | provider-managed daily snapshots + on-demand `pg_dump` | daily | 30 days rolling, 12 monthly | DB admin |
| Postgres (logical) | `scripts/backup-db.sh` → object storage | daily 02:00 UTC | 14 days | infra on-call |
| MinIO / S3 media bucket | provider versioning + cross-region replication | continuous | 90 days versioned | infra on-call |
| Redis | none (cache/event-bus only — rebuildable) | n/a | n/a | n/a |
| Application config | git (`infrastructure/k8s/**`) | per commit | indefinite | platform team |

## How to take a manual Postgres backup

```bash
# From a machine with kubectl & psql installed.
kubectl -n freeblackmarket-production exec deploy/backend -- \
  bash -c 'pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"' \
  > /tmp/freeblackmarket-$(date +%Y%m%d-%H%M).dump
```

Upload to your secure backup bucket (`s3://freeblackmarket-backups/manual/`).

## How to restore

### 1. From provider snapshot (preferred for full DR)

1. In the managed-DB console, restore the most recent point-in-time snapshot to a **new** instance.
2. Update the cluster's `DATABASE_URL` secret to point at the restored instance.
3. Trigger a rolling restart of the backend deployment.
4. Run the smoke tests in `DEPLOYMENT.md` step 8.

### 2. From `pg_dump` (preferred for partial / table-level)

```bash
# Validate the dump is intact first.
pg_restore --list /tmp/freeblackmarket-YYYYMMDD-HHMM.dump | head

# Restore into a NEW database, never directly into prod.
createdb freeblackmarket_restore
pg_restore --dbname=freeblackmarket_restore --no-owner --no-privileges \
  /tmp/freeblackmarket-YYYYMMDD-HHMM.dump
```

After validating the restored data, swap `DATABASE_URL` to the restored DB or `pg_dump` specific tables back into prod.

## Restore drill cadence

- Quarterly: full restore drill into a staging DB. Document RTO observed.
- Yearly: full DR exercise in the secondary region.

Drill outcomes go into `docs/runbooks/DR.md` under "Drill log".

## Encryption at rest

- Provider DB: enabled via the managed service.
- Media bucket: SSE-S3 (default) or SSE-KMS if compliance requires.
- Backup dumps: encrypted with the team's GPG key before upload (`gpg --encrypt --recipient backups@freeblackmarket.com`).

## Access control

Only the infra on-call rotation, the DB admin, and the security lead can decrypt dumps. Rotate the backup-bucket IAM role keys whenever a member of that group changes.
