# Secrets Manager Migration

**Last validated:** _not yet executed; first run is the migration itself._

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.3 (consolidated secrets management) and §7.2 (foundation milestone deliverable).

This runbook covers consolidating secrets from their current distributed state into a single chosen secrets manager. Today secrets are spread across `backend/.env*`, docker-compose env files, the Railway dashboard, and GitHub Actions repository secrets; the consolidation moves all production and staging secrets to one place with documented rotation.

## Decision: which manager?

Per §2.3 the choice is between three options. This runbook does **not** force a choice — it documents the criteria and steps for each so the maintainer can pick at execution time.

| Option | Strengths | Tradeoffs | When to choose |
|--------|-----------|-----------|----------------|
| **HashiCorp Vault** (self-hosted) | Strongest access control, full audit log, rich policy language, dynamic secrets | Highest operational overhead; running Vault in HA is a non-trivial workstream of its own | The maintainer has bandwidth to run Vault as a service alongside FBM; long-term scaling is the primary concern |
| **Infisical** (managed) | Managed UX, free tier sufficient for current scale, GitHub-style workflow | Self-hosted control traded for reduced operational burden; vendor dependency | The maintainer wants to minimize ops overhead and the free tier covers current scale |
| **SOPS-encrypted directory** in `infrastructure/` (lightweight) | Zero new infrastructure, per-file encryption, GPG/age key model, git-tracked rotation history | No central audit log of reads; rotation requires re-encryption of every consumer | Smallest deployment footprint; acceptable as a foundation-milestone bridge before adopting Vault or Infisical |

**Default recommendation for foundation milestone:** SOPS-encrypted directory if the maintainer wants the smallest possible new infrastructure surface; Infisical if managed-service overhead is acceptable. Vault is right but heavy; defer until differentiation milestone unless there's a specific reason to land it now.

The remainder of this runbook assumes one of the three has been chosen. Steps that differ by manager are flagged with a header (`[Vault]`, `[Infisical]`, `[SOPS]`).

## Inventory: what gets migrated

Every secret currently held outside a single manager is in scope. The categories below are exhaustive at foundation milestone; new categories are added as new external integrations are introduced.

| Category | Current location(s) | Examples |
|----------|---------------------|----------|
| Postgres credentials | `backend/.env`, Railway dashboard, GitHub Actions secret `DATABASE_URL` | `DATABASE_URL`, `POSTGRES_PASSWORD` |
| MinIO admin | `backend/.env`, docker-compose env | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` |
| Cloudflare Tunnel | systemd unit on primary, GitHub Actions secret | `CLOUDFLARE_TUNNEL_TOKEN` |
| Synapse signing keys | Synapse data dir on primary (Blackout repo concern; documented here for completeness) | `signing.key` files |
| Stellar API keys | `backend/.env`, Railway dashboard | `STELLAR_HORIZON_URL` (not secret), `STELLAR_ISSUER_SECRET` (testnet + mainnet), `STELLAR_DISTRIBUTION_SECRET` |
| Stripe keys | `backend/.env`, Railway dashboard | `STRIPE_API_KEY` (test + live), `STRIPE_WEBHOOK_SECRET` |
| OAuth provider secrets | `backend/.env`, Railway dashboard | `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET`, `PATREON_CLIENT_SECRET`, `STREAMLABS_CLIENT_SECRET` |
| SMTP / Resend | `backend/.env` | `SMTP_PASSWORD`, `RESEND_API_KEY` |
| Apprise / notification | `backend/.env` | `APPRISE_*` |
| Session / JWT | `backend/.env` | `JWT_SECRET`, `COOKIE_SECRET` |
| GitHub Actions deploy | repo secrets | `STAGING_KUBE_CONFIG_DATA`, `PRODUCTION_KUBE_CONFIG_DATA`, GHCR PAT |

## Migration steps

### 1. Stand up the chosen manager

#### [Vault]

```bash
# On primary server, run Vault in dev mode for the migration window only.
# Production Vault HA setup is a separate workstream.
docker run -d --name vault-foundation \
  --cap-add IPC_LOCK \
  -p 8200:8200 \
  -e VAULT_DEV_ROOT_TOKEN_ID=<generated> \
  hashicorp/vault:latest
```

After migration, replace dev mode with a sealed-mode deployment using auto-unseal (cloud KMS or a hardware key). That deployment is out of scope for this runbook; track as a follow-up.

#### [Infisical]

Sign up at infisical.com, create a project for `fbm-production` and a project for `fbm-staging`. Generate a service token per environment. Install the Infisical CLI on the primary server.

#### [SOPS]

```bash
# Generate an age key and store it in the maintainer's passphrase manager.
age-keygen -o ~/.config/sops/age/keys.txt
# Public key goes into .sops.yaml; private key stays in passphrase manager.

# Create the encrypted directory.
mkdir -p infrastructure/secrets/{production,staging}
# Add .sops.yaml at repo root with the age recipient.
```

### 2. For each secret category, migrate values

For each row in the **Inventory** table:

1. Read the current value from its current location. Do not log the value.
2. Write the value to the chosen manager under a stable key (e.g. `fbm/production/postgres/DATABASE_URL`).
3. Record the destination key in the per-category migration log (Step 5).
4. **Do not yet remove** the value from its source location — Step 4 validates the new source first.

### 3. Wire consumers to read from the manager

#### [Vault]

Update `docker-compose.prod.yml` and the systemd unit on the primary to fetch secrets at boot via `vault-agent` rendering env files, or via the Vault API at runtime for long-running services.

#### [Infisical]

Update startup scripts to invoke `infisical run --token <service-token> -- <command>` so the process inherits secrets from the manager rather than the host env.

#### [SOPS]

Update startup scripts to invoke `sops exec-env infrastructure/secrets/production/backend.enc.yaml '<command>'` for each service.

For all three options, the GitHub Actions workflows are updated to fetch secrets from the manager during deploy, replacing the existing repo secrets with a single token per environment.

### 4. Validate end-to-end

For each service (backend, storefront, admin-panel, vendor-panel) on staging first:

```bash
# Restart the service so it re-reads from the new source.
docker compose -f docker-compose.staging.yml restart <service>

# Confirm the service comes up healthy.
curl -fsS https://<staging-host>/healthz

# Confirm the env validator passes.
docker compose -f docker-compose.staging.yml exec <service> node scripts/assert-env.mjs
```

Then exercise one operation per category that requires the secret:

- Postgres → list one row from a small table.
- MinIO → upload a 1KB test object and delete it.
- Stellar → query account balance against testnet.
- Stripe → trigger a test webhook from the dashboard.
- Each OAuth provider → walk one OAuth flow on staging.
- SMTP/Resend → send one test email.

A category is **validated** when its operation succeeds reading from the new source.

### 5. Remove duplicates

Only after a category is validated:

1. Remove the value from `backend/.env*` files (replace with the placeholder the env validator expects).
2. Remove the value from the Railway dashboard.
3. Remove the value from GitHub Actions repo secrets (if applicable).
4. Record the removal in the per-category migration log:

```
docs/operations/secrets_migration_log.md (created on first migration)

| Category | Old location(s) removed | New manager key | Validated on | By |
|----------|--------------------------|------------------|---------------|-----|
| Postgres | backend/.env (line 4); Railway DATABASE_URL; Actions DATABASE_URL | fbm/production/postgres/DATABASE_URL | 2026-MM-DD staging; 2026-MM-DD prod | <maintainer> |
```

### 6. Production cutover

After every category has been validated on staging, repeat Step 4 against production. The cutover is per-service (backend, then storefront, then admin-panel, then vendor-panel), with a smoke test between each.

## Validation

The migration is **complete** when:

- [ ] Every category in the **Inventory** table has a row in `docs/operations/secrets_migration_log.md` showing both staging and production validation dates.
- [ ] `grep -rE '^[A-Z_]+=[^$]' backend/.env* docker-compose*.yml` returns only placeholders, no real values.
- [ ] No secret in the inventory is referenced from more than one source (the manager and the consuming service's startup invocation only).
- [ ] A `terraform plan` (or equivalent for the chosen manager's provisioning approach) is committed under `infrastructure/secrets/` so the manager state is reproducible.
- [ ] [`SPOF_MAP.md`](../operations/SPOF_MAP.md) row SPOF-04 is updated with the chosen manager.
- [ ] A rotation cadence baseline is written into this runbook (Step below) and at least one secret has been rotated end-to-end via the new flow.

## Rotation cadence baseline

After migration, rotation cadence per category:

| Category | Cadence | Mechanism |
|----------|---------|-----------|
| Postgres app passwords | every 90 days | new password via manager → rolling restart of consumers |
| MinIO admin | every 90 days | new admin key via manager → rolling restart |
| Cloudflare Tunnel | every 90 days | regenerate token in Cloudflare → update manager → restart cloudflared |
| Stellar mainnet keys | every 180 days, or after any suspected compromise | new keypair, fund, swap atomically |
| Stripe keys | every 180 days, or after staff change | rotate in Stripe → update manager → smoke test webhooks |
| OAuth provider secrets | every 180 days, or per provider's rotation policy | rotate at provider → update manager → restart auth-consuming services |
| SMTP/Resend | every 180 days | new key at provider → update manager |
| JWT/Cookie secrets | annually, with a 24h dual-validation window | dual-key rollover; old keys validate, new keys sign |

## Rollback

If a service fails to start after migration:

1. Read the validation step that failed; identify the missing or wrong secret.
2. The old source location is **not yet removed** until validation passes (per Step 5), so the immediate rollback is to revert the consumer's startup script to read from the old source.
3. Investigate and fix in the manager.
4. Re-run validation.

If a secret was committed to git in error during the migration (e.g. a real value pasted into `.sops.yaml` instead of an encrypted blob), treat it as a leak: rotate the secret immediately at its provider, force-push is **not** appropriate (the value is in history); the canonical response is to rotate everywhere it was used and document the leak in the security log.

## Cross-references

- [`FBM_MIGRATION_TO_PRIMARY_SERVER.md`](./FBM_MIGRATION_TO_PRIMARY_SERVER.md) — the FBM migration runbook depends on this one.
- [`SPOF_MAP.md`](../operations/SPOF_MAP.md) — row SPOF-04 (secrets manager).
- [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.3 (decision criteria), §7.2 (foundation deliverable).
- [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — invoked if a leak is discovered.
