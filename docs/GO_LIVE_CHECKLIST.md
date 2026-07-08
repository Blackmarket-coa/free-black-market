# Go-Live Checklist

**Purpose.** A single, honest list of everything that stands between the current
codebase and a live production cutover. The FBM code itself passes every
automated gate (see `docs/PRODUCTION_READINESS.md`); what remains is **(A)**
off-repo infrastructure only the operator can provision, and **(B)** live-infra
verification that runs in CI (Postgres/Docker), not in a code-review sandbox.

Use this alongside `runbooks/DEPLOYMENT.md` (which has the authoritative
cluster-external table) and `runbooks/RELEASE.md` (go/no-go recording).

---

## Code-side status (verified in-repo)

All locally-runnable gates are green on the working branch:

- Backend: `pnpm --dir backend typecheck && pnpm --dir backend lint && pnpm --dir backend test`
- Storefront: `pnpm --dir storefront typecheck`
- Vendor-panel / Admin-panel: `pnpm --dir <app> typecheck && pnpm --dir <app> lint`
- Portals: `pnpm portals:typecheck && pnpm portals:lint && pnpm portals:test`
- Repo guards: `pnpm check:no-console && pnpm check:vendor-completeness && pnpm validate:hermes-prompt`

Money-path integrity fixes landed this pass:

- Customer withdrawals fail closed and never debit the ledger without an
  executed Stripe payout (`ACH_PAYOUTS_ENABLED` gate; payout-first ordering).
- ACH deposit mandate records the real client IP (NACHA).
- Stellar settlement refuses to start in production if enabled against testnet.
- Embed auth bootstrap is disabled by default and fails closed.

---

## (A) Off-repo infrastructure — operator-only (cannot be done from the repo)

These are the **BLOCKER** rows from `runbooks/DEPLOYMENT.md` §"Cluster-external
setup". Each must read confirmed before production cutover. Mark done inline in
that table (`confirmed YYYY-MM-DD — <operator>`).

| # | Item | Verify |
|---|------|--------|
| 1 | PagerDuty rotation "Free Black Market" wired to the prod alert sink | trigger a test alert, confirm page |
| 2 | Status page `status.freeblackmarket.com` reachable; incident webhook documented | `curl -sI https://status.freeblackmarket.com` |
| 3 | Sentry projects per app (backend/storefront/admin/vendor); DSNs in the four `*-env` secrets | DSNs present; test event visible in Sentry |
| 4 | DB managed-snapshot policy (daily, 30d retention, off-cluster) | provider console shows successful snapshot |
| 5 | DNS for the 4 prod hostnames → prod LB | `dig +short freeblackmarket.com admin. vendor. api.` |
| 6 | cert-manager + `letsencrypt-prod` ClusterIssuer reachable from prod cluster | `kubectl get clusterissuer letsencrypt-prod -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'` → `True` |
| 7 | GHCR image repos visible (Internal); prod cluster can pull without per-pod auth | `docker buildx imagetools inspect ghcr.io/<org>/free-black-market-backend:<tag>` |
| 8 | External Secrets Operator installed; `cluster-secret-store` resolves; four `*-env` secrets sync | `kubectl -n freeblackmarket-production get externalsecrets` → all `SecretSynced/True` |
| 18 | First green `staging-deploy.yml` against a real cluster | Actions run green + smoke checks pass |
| 19 | First green `prod-deploy.yml` rollout + healthcheck round trip (no-op tag) | Actions run green |

REQUIRED (before staging) and RECOMMENDED (within 30 days) rows 9–17 are tracked
in the same DEPLOYMENT.md table (Slack channels, staging DNS/certs/ESO, Grafana
dashboards, MinIO replication, failover records).

### Production secret values the operator must set

Provision per `runbooks/DEPLOYMENT.md` and the app `.env.template` files. New /
notable flags this pass (all default to the safe value):

- `ACH_PAYOUTS_ENABLED=false` — keep false until Stripe Connect payout
  destinations exist; the withdraw route stays disabled (503) while false.
- `ENABLE_STELLAR_SETTLEMENT=false` — if ever set true in prod, `STELLAR_NETWORK`
  MUST be `mainnet` and `STELLAR_USDC_ISSUER` MUST be set or the backend refuses
  to boot.
- `BLACKOUT_EMBED_ENABLED=false` — leave false unless the embedded webview
  auth flow is in use.
- Fail-closed required secrets (backend refuses to boot without them):
  `JWT_SECRET`, `COOKIE_SECRET`, `FREEBLACKMARKET_WEBHOOK_SECRET`,
  `FREEBLACKMARKET_API_KEY` (see `scripts/assert-env.mjs`).

---

## (B) Live-infra verification — runs in CI, not in a sandbox

These require Postgres/Redis/Docker and are wired as **fail-fast** CI gates.
They cannot be exercised in an environment without those services; confirm them
green on the runner before cutover.

| Verification | CI job (`.github/workflows/…`) | How to confirm |
|---|---|---|
| Unit + integration (`test:integration:http` against live Postgres) | `ci.yml` → `test-integration` | job green on the release commit |
| Money-path concurrency soak (no overdraw / value conservation / exact pool totals) | `ci.yml` → `test-soak` | job green on the release commit |
| End-to-end (Playwright against the compose stack) | `e2e.yml` | job green |
| Docker image build (4 apps) | `docker-build.yml` | images published to GHCR |
| DB migrate + seed on a real image (TI-4) | run compose `db:migrate` / `seed` on a runner | migrations + seed complete (no `EACCES`/`TableNotFound`) |
| Security: gitleaks, Trivy FS+image, CodeQL, SBOM | `security.yml` | jobs green |
| Performance gate (k6) — release branches | `load-perf.yml` | thresholds pass |
| Release validation script | `ci.yml` on `release/*` | `scripts/release_validation.sh` green |

To run the soak locally in a DB-equipped env:

```bash
cd backend && TEST_TYPE=integration:modules NODE_OPTIONS=--experimental-vm-modules \
  npx jest --runInBand --forceExit \
  src/modules/hawala-ledger/__tests__/concurrency-soak.integration.spec.ts
```

---

## Cutover sequence (summary)

1. All code-side gates green on `release/vX.Y.Z` (above).
2. All **(B)** CI jobs green on the release commit.
3. All **(A)** BLOCKER rows in DEPLOYMENT.md read `confirmed`.
4. Deploy to staging, smoke-test ≥15 min, tag `vX.Y.Z`.
5. Record go/no-go in `runbooks/RELEASE.md`; run **Deploy → Production**.
6. Post-cutover: confirm RECOMMENDED rows within 30 days.
