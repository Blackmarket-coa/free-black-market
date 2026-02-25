# Phase 2 Release Validation Playbook

This playbook operationalizes the completion tracker's Phase 2 requirements into a repeatable command flow.

## 1) Run backend and storefront validation first

```bash
./scripts/release_validation.sh
```

What this runs by default:

- Backend: `test:unit`, `test:integration:http`, `test:integration:modules`
- Storefront: `pnpm test` when available, otherwise falls back to `pnpm run lint`

## 2) Run Hawala-first smoke checks (highest-risk financial flows)

Set environment variables and rerun the script:

```bash
export BACKEND_URL="https://your-backend.example.com"
export STORE_TOKEN="..."
export VENDOR_TOKEN="..."
export ADMIN_TOKEN="..."

./scripts/release_validation.sh
```

Included Hawala checks:

- Store wallet + transactions (valid token)
- Store deposit invalid-token failure-path
- Vendor dashboard (valid token)
- Admin summary (valid token + invalid-token failure-path)

## 3) Expand to integration contract/failure-path checks

Provide endpoints as a comma-separated list:

```bash
export INTEGRATION_ENDPOINTS="/admin/printful/health,/admin/woocommerce-import/status"
./scripts/release_validation.sh
```

For each integration endpoint:

- Contract check accepts `2xx` or expected client-side `4xx` (never `5xx`)
- Failure-path check with invalid token expects `401` or `403`

## 4) Gate release on 4-part exit criteria

A release is _eligible_ only if all four are satisfied:

1. **Structure pass**: modules/workflows/routes exist.
2. **Test pass**: backend/storefront validation is green.
3. **Health pass**: smoke checks return expected auth + payload behavior.
4. **Regression pass**: no unresolved critical/high issues in release window.

## 5) Cross-module E2E matrix (education/mutual-aid/IPFS)

Minimum E2E checks to run before production rollout:

- **Education + mutual-aid taxonomy surface**
  - `GET /store/cms-taxonomy` returns active types/categories including education/community classifications.
  - Storefront `/[locale]/vendor-types` and `/[locale]/vendors` render without hard failures.
- **Collective deliberation surface**
  - `GET /store/proposals?limit=25&offset=0` returns bounded pagination metadata.
  - Invalid pagination (`limit>100`, negative `offset`) is rejected with `400`.
- **IPFS/chat room-event UX surface**
  - User messages screen displays connection status transitions (`idle` → `connecting` → `connected`) when Rocket.Chat is configured.
  - Room/event diagnostics (`activeRoom`, `lastRoomEvent`) update when channel navigation occurs.

## 6) Final rollout hardening checks (policy/localization)

Add these checks to release sign-off:

1. **Policy tuning:** validate pagination and list-filter limits on store/admin endpoints remain bounded (default + max guardrails).
2. **Localization:** ensure translated pagination/table copy still renders across admin-panel and vendor-panel routes after release candidate build.
3. **Runbook discipline:** capture command outputs from `./scripts/release_validation.sh` and attach to release artifacts.

## 7) Refresh tracker metadata after successful verification

When a validation run passes and you want to keep tracker timestamps/evidence current in one step:

```bash
./scripts/release_validation.sh --refresh-trackers --refresh-note "weekly readiness run"
```

This updates:

- `docs/COMPLETION_TRACKER.md` last-updated date
- `docs/QA_WORK_TRACKER.md` last-updated date
- QA evidence log with the provided note

## 8) Hermes vendor runtime validation (WO-2026-02-HERMES-VENDOR-RUNTIME)

Run the Hermes vendor runtime suite to verify the vendor tool registry contract and LangGraph guardrails before release:

```bash
pnpm -s test:hermes-vendor-suite
```

This command gates:

- Canonical Hermes LangGraph prompt/runtime wiring regressions (`test:hermes-langgraph`)
- Vendor runtime contract coverage for `create_vendor`, `create_product`, and destructive confirmation behavior (`test:hermes-vendor-runtime`)

## Suggested CI usage

```bash
BACKEND_URL="$BACKEND_URL" \
STORE_TOKEN="$STORE_TOKEN" \
VENDOR_TOKEN="$VENDOR_TOKEN" \
ADMIN_TOKEN="$ADMIN_TOKEN" \
INTEGRATION_ENDPOINTS="$INTEGRATION_ENDPOINTS" \
./scripts/release_validation.sh
```

## Release branch checklist (enforceable gate)

For each `release/*` branch push, require all of the following before merge/deploy:

1. **Release validation script succeeded (blocking):**
   - Workflow job: `Release Validation Gate`
   - Command: `./scripts/release_validation.sh`
   - Failure behavior: non-zero exit fails the job.
2. **Artifacts uploaded:**
   - `release-validation-<run_id>` artifact must contain `release-validation.log`.
3. **Security + quality checks passed:**
   - CI jobs `Lint & Type Check`, `Translation Contract Validation`, `Vendor Panel Checks`, `Unit Tests`, and `Security Audit` must be green.

### Required CI secrets/variables

- Secrets:
  - `BACKEND_URL`
  - `STORE_TOKEN`
  - `VENDOR_TOKEN`
  - `ADMIN_TOKEN`
- Optional repository/environment variable:
  - `INTEGRATION_ENDPOINTS` (comma-separated path list, e.g. `/admin/printful/health,/admin/woocommerce-import/status`)

### Branch protection recommendation

- In GitHub branch protection for `release/*`, set the above jobs as **required status checks**.
- Do not allow bypassing required checks for standard release workflow users.
