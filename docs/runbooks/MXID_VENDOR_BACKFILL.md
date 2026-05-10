# MXID Vendor Backfill

**Last validated:** _not yet executed; first run is the migration itself._

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.1 (unified identity model) and §5.1 (foundation milestone exit criterion).

This runbook covers backfilling Matrix MXIDs onto existing FBM vendors so the entitlements service can answer governance-role and economic-standing queries by MXID per the §2.5 contract. The backfill is **idempotent and non-destructive**: rows that already have an MXID are left untouched, and a partial unique index prevents two vendors from sharing the same MXID.

## When to run

- After deploying the migration `Migration202607AddMxidToSellerMetadata` to add the `mxid` column to `seller_metadata`.
- Whenever a batch of vendors is onboarded outside the standard signup flow (e.g. CSV imports, partner cohorts).
- As the recurring step in the foundation-milestone bus-factor drill (§7.4).

## Resolution order

The backfill script tries three sources in order, taking the first hit:

1. **Manual override CSV** — `MXID_BACKFILL_CSV` env var pointing to a file with `email,mxid` pairs (one per line, `#` for comments). This is the source of truth for vendors whose MXID we know but who never appeared in the Synapse user directory.
2. **Synapse user-directory lookup** via `matrix-js-sdk` (Apache-2.0). Requires `MATRIX_HOMESERVER_URL` and an admin-scoped `MATRIX_BACKFILL_TOKEN`. The script searches by email (the directory is configured server-side to index `m.id_msisdn` / `m.id_email` 3PIDs).
3. **Best-effort synthesis** from the email localpart against `MXID_BACKFILL_DEFAULT_HOMESERVER`, e.g. `alice@example.com → @alice:bmc.example` when the env var is `bmc.example`. Skipped when the env var is unset.

If nothing resolves, the row is left as-is and reported as `Unresolved`. Operators should add the MXID to the override CSV and re-run.

## Pre-flight checklist

1. Confirm the migration is applied:
   ```sh
   pnpm --filter backend medusa db:status
   ```
   `Migration202607AddMxidToSellerMetadata` should show as **executed**.
2. Snapshot the current state for rollback:
   ```sh
   psql "$DATABASE_URL" -c "SELECT id, seller_id, mxid FROM seller_metadata WHERE deleted_at IS NULL" \
     > "/tmp/seller_metadata_pre_backfill_$(date -u +%Y%m%dT%H%M%SZ).csv"
   ```
3. If using the Synapse path, validate token has user-directory search scope:
   ```sh
   curl -sH "Authorization: Bearer $MATRIX_BACKFILL_TOKEN" \
     "$MATRIX_HOMESERVER_URL/_matrix/client/v3/user_directory/search" \
     -d '{"search_term": "test", "limit": 1}' | jq '.results | length'
   ```
4. If using the override CSV, validate it parses:
   ```sh
   head -5 "$MXID_BACKFILL_CSV"
   ```
   Comments (`#`) and blank lines are ignored.

## Dry run (always do this first)

```sh
MXID_BACKFILL_DRY_RUN=1 \
MXID_BACKFILL_CSV=/path/to/overrides.csv \
MATRIX_HOMESERVER_URL=https://matrix.bmc.example \
MATRIX_BACKFILL_TOKEN=... \
MXID_BACKFILL_DEFAULT_HOMESERVER=bmc.example \
  pnpm --filter backend medusa exec ./src/scripts/backfill-mxid.ts
```

The script prints one line per seller showing what would happen. Confirm the totals at the end (Updated / Already set / Conflicts / Unresolved / Errors) match expectations before the live run.

## Live run

Drop `MXID_BACKFILL_DRY_RUN=1` and re-run:

```sh
MXID_BACKFILL_CSV=/path/to/overrides.csv \
MATRIX_HOMESERVER_URL=https://matrix.bmc.example \
MATRIX_BACKFILL_TOKEN=... \
MXID_BACKFILL_DEFAULT_HOMESERVER=bmc.example \
  pnpm --filter backend medusa exec ./src/scripts/backfill-mxid.ts
```

## Verification queries

After the live run, confirm:

```sql
-- How many vendors now have an MXID:
SELECT COUNT(*) FILTER (WHERE mxid IS NOT NULL) AS with_mxid,
       COUNT(*) FILTER (WHERE mxid IS NULL)     AS without_mxid
FROM seller_metadata WHERE deleted_at IS NULL;

-- Spot any duplicates the partial unique index missed (should be 0):
SELECT mxid, COUNT(*) FROM seller_metadata
 WHERE mxid IS NOT NULL AND deleted_at IS NULL
 GROUP BY mxid HAVING COUNT(*) > 1;
```

Smoke-test the entitlements surface:

```sh
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"client_id":"...","client_secret":"..."}' \
  "$FBM_API/v1/integrations/blackout/oauth/token" | jq -r .access_token)

curl -sH "Authorization: Bearer $TOKEN" \
  "$FBM_API/v1/integrations/blackout/entitlements/governance-roles?mxid=@alice:bmc.example" | jq .
```

A vendor backfilled into seller_metadata with appropriate `governance.role.*` grants should return a populated `roles[]` array. A vendor with no governance role grants returns `roles: []` — that's expected, not a failure.

## Rollback

Two reversal paths:

1. **Per-row** (preferred): use the pre-backfill snapshot CSV from step 2 above. Replay it with:
   ```sh
   psql "$DATABASE_URL" -c "
     CREATE TEMP TABLE pre_backfill (id TEXT, seller_id TEXT, mxid TEXT);
     COPY pre_backfill FROM '/tmp/seller_metadata_pre_backfill_<TIMESTAMP>.csv' CSV;
     UPDATE seller_metadata sm
        SET mxid = pb.mxid
       FROM pre_backfill pb
      WHERE sm.id = pb.id;
   "
   ```
2. **Schema-level** (last resort): roll back the migration. This drops the column and all backfilled values.
   ```sh
   pnpm --filter backend medusa db:rollback Migration202607AddMxidToSellerMetadata
   ```

Schema rollback is destructive; use the per-row path unless the column itself is the problem.

## Known limitations (foundation milestone)

- The script does not deduplicate across the `member` table for sellers with multiple member rows; only the joined row is considered. This is deliberate — multi-member sellers in the foundation milestone are an outlier and should be handled by the override CSV.
- The Synapse path requires the user directory to index 3PID emails. If the homeserver is configured with `user_directory.search_all_users: false` and the vendor email is not present as a 3PID, the lookup returns no result and the script falls through to synthesis (or skips if synthesis is disabled).
- MXID format is validated against the §2.5 contract regex `^@[A-Za-z0-9._=/-]+:[A-Za-z0-9.-]+$`. Invalid override entries are logged and skipped.

## Bus-factor notes

- The script is safe to re-run; subsequent runs only touch new sellers.
- Every line of output is structured enough that a co-maintainer can paste it into the incident channel without redaction (no MXIDs are secrets; emails appear in plain text and should be treated per the project privacy policy).
- If the script aborts mid-run, no partial state is committed beyond the rows already updated; re-running picks up where it stopped.
