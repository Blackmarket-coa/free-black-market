# Blackout Centralized Build: Baseline Release-Path Audit and Gap Map

- **Work Order Link:** `WO-2026-03-BLACKOUT-CENTRALIZED-BUILD`
- **Task:** Baseline release-path audit and gap map
- **Status:** Completed (inventory captured)
- **Owners:** Platform Engineering + SRE
- **Date:** 2026-03-14

## Objective

Create an approved baseline inventory of release/deploy entrypoints so centralized blackout gating can be inserted at every promotion path.

## Current Release Entrypoint Inventory

| # | Entrypoint | Trigger | Current Guardrails | Blackout Awareness Today | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `notify-deploy` workflow job (`.github/workflows/ci.yml`) | Push to `main` | Requires `build`, `test-unit`, `security`, `vendor-panel`, `i18n-contracts` jobs before notification | **No** explicit blackout window check before signaling deploy readiness | `.github/workflows/ci.yml` (`notify-deploy`) |
| 2 | `release-validation` workflow job (`.github/workflows/ci.yml`) | Push to `release/*` | Blocking validation script + required upstream jobs; uploads `release-validation.log` artifact | **No** explicit blackout policy evaluation; eligibility is quality-focused only | `.github/workflows/ci.yml` (`release-validation`) |
| 3 | Manual/local execution of `./scripts/release_validation.sh` | Operator invocation (CLI / local / CI shell) | Script executes tests/smoke checks and fails on validation failures | **No** blackout policy input/decision points in script contract | `scripts/release_validation.sh`; `docs/RELEASE_VALIDATION_PLAYBOOK.md` |
| 4 | Railway production service deployment (`backend/railway.json`) | Platform deploy event (main-linked deploy flow per CI notification) | Dockerfile build, healthcheck, restart policy | **No** native blackout policy metadata in Railway config | `backend/railway.json`; `.github/workflows/ci.yml` (`notify-deploy`) |
| 5 | Railway staging service deployment (`backend/railway.staging.json`) | Platform deploy event for staging environment | Dockerfile build, healthcheck, restart policy | **No** native blackout policy metadata in Railway config | `backend/railway.staging.json` |

## Gap Map

| Gap ID | Gap | Risk | Recommended Closure |
| --- | --- | --- | --- |
| G1 | Blackout evaluation is absent from all release/deploy entrypoints. | Deploys can proceed during freeze windows. | Introduce centralized gate decision call that is mandatory for all promotion paths. |
| G2 | No single canonical release decision record spans CI + platform deploy + manual overrides. | Audit evidence is fragmented and hard to reconstruct. | Emit a unified release-decision artifact (decision, policy snapshot, actor, reason, timestamp, commit SHA). |
| G3 | Manual script invocation path can be used without centralized policy checks. | Side-door promotions bypass blackout controls. | Extend script contract to request gate decision token before declaring release eligible. |
| G4 | Release-branch validation is quality-centric but not policy-centric. | False sense of safety; quality pass != policy pass. | Add blackout policy pass/fail as a blocking criterion in release gate job. |
| G5 | Deployment platform config has no concept of approved exception context. | Emergency overrides may happen without durable approval evidence. | Require an override approval ID and reason in deployment metadata/logs. |

## Proposed Control Points for Centralized Gate Insertion

1. **Release branch pushes (`release/*`)**: call centralized gate before running release validation script.
2. **Main deploy readiness (`main`)**: require centralized gate pass before deploy-ready notification.
3. **Manual release validation script**: require centralized gate token/decision for `eligible` outcome.
4. **Deploy handoff to Railway**: attach gate decision ID + policy version as deploy metadata.

## Approval Checklist (Inventory Acceptance)

- [x] All known CI release/promotion workflow entrypoints listed.
- [x] Manual operator release entrypoint listed.
- [x] Deployment platform entrypoints listed for production and staging.
- [x] Gap map includes missing blackout enforcement and audit weaknesses.
- [ ] Final sign-off from Platform Engineering lead.
- [ ] Final sign-off from SRE lead.

## Next Task

Per work-order sequence, the next task is:

> ✅ **Define blackout policy schema and storage location** — completed with versioned contract files at `docs/contracts/blackout-policy.schema.json` and `docs/contracts/examples/blackout-policy.example.json`.

> ✅ **Implement centralized gate checks in promotion flow** — completed by adding `blackout-gate` as a blocking CI job and wiring it into `release-validation` and `notify-deploy` dependencies, backed by `scripts/blackout-gate-check.mjs` and `config/release/blackout-policy.json`.

> ▶️ **Next:** add exception/override approval capture.
