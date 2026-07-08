# Production Readiness

Index of operational primitives added during the production-readiness pass on branch `claude/production-ready-ZAAam`. This page is the entry point for operators, on-call engineers, and release managers.

## Status

| Area | Doc | State |
|------|-----|-------|
| Go-live checklist (infra + CI verification) | [`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) | live |
| Audit debt (deferred) | [`AUDIT_DEBT.md`](./AUDIT_DEBT.md) | tracked |
| Healthchecks (liveness / readiness) | [`HEALTHCHECKS.md`](./HEALTHCHECKS.md) | live |
| Observability (OTel, Sentry, log format) | [`OBSERVABILITY.md`](./OBSERVABILITY.md) | live |
| Deployment runbook | [`runbooks/DEPLOYMENT.md`](./runbooks/DEPLOYMENT.md) | live |
| Incident response | [`runbooks/INCIDENT_RESPONSE.md`](./runbooks/INCIDENT_RESPONSE.md) | live |
| Backup & restore | [`runbooks/BACKUP_RESTORE.md`](./runbooks/BACKUP_RESTORE.md) | live |
| On-call rotation | [`runbooks/ON_CALL.md`](./runbooks/ON_CALL.md) | live |
| Disaster recovery | [`runbooks/DR.md`](./runbooks/DR.md) | live |
| Release process | [`runbooks/RELEASE.md`](./runbooks/RELEASE.md) | live |
| Release validation | [`RELEASE_VALIDATION_PLAYBOOK.md`](./RELEASE_VALIDATION_PLAYBOOK.md) | existing |
| Single points of failure map | [`operations/SPOF_MAP.md`](./operations/SPOF_MAP.md) | foundation-milestone |
| Co-maintainer onboarding | [`operations/CO_MAINTAINER_ONBOARDING.md`](./operations/CO_MAINTAINER_ONBOARDING.md) | foundation-milestone |
| Bus-factor drill cadence | [`operations/BUS_FACTOR_DRILL_CADENCE.md`](./operations/BUS_FACTOR_DRILL_CADENCE.md) | foundation-milestone |
| Upstream advisories feed | [`operations/UPSTREAM_ADVISORIES.md`](./operations/UPSTREAM_ADVISORIES.md) | foundation-milestone |
| AI-driven security workflow | [`operations/AI_SECURITY_WORKFLOW.md`](./operations/AI_SECURITY_WORKFLOW.md) | foundation-milestone |
| FBM migration to primary server | [`runbooks/FBM_MIGRATION_TO_PRIMARY_SERVER.md`](./runbooks/FBM_MIGRATION_TO_PRIMARY_SERVER.md) | foundation-milestone |
| Secrets manager migration | [`runbooks/SECRETS_MANAGER_MIGRATION.md`](./runbooks/SECRETS_MANAGER_MIGRATION.md) | foundation-milestone |
| Entitlements service contract (OpenAPI) | [`contracts/entitlements.yaml`](./contracts/entitlements.yaml) | foundation-milestone |

## Quality gates

Every PR must pass these gates before merge:

| Gate | Mechanism |
|------|-----------|
| Lint (4 apps + backend) | `.github/workflows/ci.yml` |
| Typecheck (4 apps) | `.github/workflows/ci.yml` |
| Unit + integration tests | `.github/workflows/ci.yml` |
| Translation contract validation | `.github/workflows/ci.yml` |
| Vendor/module completeness | `.github/workflows/ci.yml` |
| Secret scanning (gitleaks) | `.github/workflows/security.yml` |
| Dependency review | `.github/workflows/security.yml` |
| SAST (CodeQL) | `.github/workflows/security.yml` |
| Filesystem & image vuln scan (Trivy) | `.github/workflows/security.yml` |
| SBOM (CycloneDX) | `.github/workflows/security.yml` |
| Docker image build (4 apps) | `.github/workflows/docker-build.yml` |
| End-to-end (Playwright) | `.github/workflows/e2e.yml` |
| Performance gate (k6) — release branches only | `.github/workflows/load-perf.yml` |
| Release validation script | `.github/workflows/ci.yml` (`release/*` branches) |

## Deploy targets

The platform supports two deploy paths simultaneously:

1. **Generic Docker / Kubernetes** — primary. Images are published to GHCR by `docker-build.yml`; environments deploy via `staging-deploy.yml` and `prod-deploy.yml` (both `workflow_dispatch` with GitHub environment approvals).
2. **Railway** — legacy. The existing Railway auto-deploy from `main` is preserved; both paths read the same env contract.

## Local full-stack run

```bash
docker compose up --build
```

Brings up `postgres`, `redis`, `minio` (with bucket initialised), `backend`, `storefront`, `admin-panel`, `vendor-panel`. Healthchecks gate startup ordering; see `HEALTHCHECKS.md`.

## Before you ship

1. Read `runbooks/RELEASE.md`.
2. Confirm all gates green on the release branch.
3. Run `scripts/release_validation.sh` (also runs in CI on `release/*`).
4. Tag with the next semver; deploy via `prod-deploy.yml`.
