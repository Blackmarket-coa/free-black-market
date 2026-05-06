# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project loosely follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Production-readiness documentation index (`docs/PRODUCTION_READINESS.md`) and deferred audit-debt tracker (`docs/AUDIT_DEBT.md`).
- Healthcheck contract documented in `docs/HEALTHCHECKS.md`; new `GET /api/health` route in the storefront alongside the legacy `GET /api/healthcheck`.
- Per-app Dockerfiles for storefront (Next.js standalone), admin-panel (nginx), and vendor-panel (nginx). Backend `Dockerfile` rewritten as multi-stage with a non-root runtime user and a `HEALTHCHECK` directive.
- Repo-root `docker-compose.yml` orchestrating Postgres, Redis, MinIO, all four apps with healthcheck-gated startup ordering. Companion `.dockerignore` and `docker-compose.override.yml.example`.
- Shared environment validator at `scripts/assert-env.mjs`; storefront-side mirror at `storefront/src/lib/config/assertEnv.ts` invoked from `storefront/instrumentation.ts`.
- Observability primitives: storefront `instrumentation.ts` now initialises Sentry server runtime when `SENTRY_DSN` is set; `sentry.{client,server}.config.ts` plus `admin-panel`/`vendor-panel` `src/lib/telemetry.ts` for browser Sentry init. All initialisers are no-ops without their respective DSN. `docs/OBSERVABILITY.md` documents the env contract.
- New CI workflows: `docker-build.yml` (per-app GHCR images with provenance + SBOM), `security.yml` (gitleaks, dependency review, Trivy fs + image, CodeQL extended, CycloneDX SBOMs), `e2e.yml` (Playwright against the compose stack), `load-perf.yml` (k6 with P95/error-rate thresholds), `staging-deploy.yml` and `prod-deploy.yml` (`workflow_dispatch` with GitHub environment approvals). Existing `ci.yml` extended with admin-panel and storefront test jobs and concurrency cancellation.
- Operational runbooks under `docs/runbooks/`: `DEPLOYMENT.md`, `INCIDENT_RESPONSE.md`, `BACKUP_RESTORE.md`, `ON_CALL.md`, `DR.md`, `RELEASE.md`.
- Per-app script parity: `lint` and `typecheck` scripts added to `backend/package.json` (lint aliased to `tsc --noEmit` until ESLint is introduced — tracked as `LR-4`); `typecheck` script added to `admin-panel/package.json`; `typecheck`, `test`, `assert-env` scripts added to `storefront/package.json`.
- Storefront test harness (`vitest.config.ts`) and initial suite covering `assertEnv`, the `/api/health` route, and a smoke test (9 tests).
- E2E scaffolding under `e2e/` (Playwright, healthchecks + storefront-browse smoke specs).
- Performance scaffolding under `perf/k6/` (`storefront-browse.js` with P95 < 800 ms / error < 1 % thresholds).
- Gitleaks configuration at `.gitleaks.toml` allowlisting documented placeholders and template files.

### Changed
- `backend/.env.template` and `backend/.env.staging.template`: replaced `dev-only-secret-change-in-production-32chars` and `supersecret` literals with explicit `CHANGE_ME_*` placeholders. Empty `MEDUSA_ADMIN_PASSWORD` so production boot fails closed if the operator forgets to set one.
- `storefront/.env.template`: removed `supersecret` defaults for `NEXT_PUBLIC_STRIPE_KEY` and `REVALIDATE_SECRET`; replaced with `pk_test_replace_with_real_stripe_publishable_key` and a `CHANGE_ME_*` placeholder respectively.
- `backend/medusa-config.ts`: production startup now refuses banned placeholder literals, requires `JWT_SECRET`/`COOKIE_SECRET` ≥ 32 chars, and asserts `MEDUSA_ADMIN_PASSWORD` is present and ≥ 12 chars.
- `storefront/next.config.ts`: enabled `output: 'standalone'` so the storefront Dockerfile can ship a slim runtime layer.
- `.github/workflows/ci.yml`: added `storefront-test` and `admin-panel` jobs; storefront `typecheck` is now part of the lint job; vendor-panel typecheck and build are now blocking; integration tests run on every PR (previously only on `main`); added `concurrency:` to cancel superseded runs; replaced the Railway-specific deploy-notify message with a generic image-publish summary.
- `.github/workflows/ci.yml` integration-test step now uses `ci-jwt-secret-…` / `ci-cookie-secret-…` literals so the production secret-validator does not flag the test fixture.

### Security
- Fail-closed env validators block startup with empty, banned, or under-length secrets in production. Banned set: `supersecret`, `changeme`, `change-me`, `change_me`, `dev-only-secret-change-in-production-32chars`, `test`, `secret`, `password`, anything starting with `CHANGE_ME`.
- `security.yml` workflow adds gitleaks, dependency review, Trivy filesystem + image scanning, CodeQL `security-extended` queries, and CycloneDX SBOM generation per app.
- `dependency-review-action` blocks any PR introducing a dependency with a HIGH+ vulnerability.

### Notes
- Audit backlog (`docs/AUDIT_DEBT.md`) — admin-panel `any` (671), storefront `any` (158), repo-wide `console.log` (~250), admin lint baseline ratchet (currently `--max-warnings 7000`), translation-contract drift, vendor-panel typecheck failures — is **deferred** with named owners and milestones. None of those are addressed in this changeset.
- `infrastructure/k8s/{staging,production}/` directories are intentionally empty in this changeset; the deploy workflows tolerate empty dirs and will warn-and-skip until the platform team commits manifests.
- Railway auto-deploy from `main` is preserved alongside the new K8s deploy path.
