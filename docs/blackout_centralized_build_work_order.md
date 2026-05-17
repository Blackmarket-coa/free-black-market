# Work Order: Blackout Centralized Build

- **Work Order ID:** WO-2026-03-BLACKOUT-CENTRALIZED-BUILD
- **Status:** In Progress (Task 1 inventory complete)
- **Priority:** P1 (release control + operational consistency)
- **Owner:** Platform Engineering
- **Requested By:** Operations / Release Management
- **Target Window:** 2026-Q2

## Objective

Design and implement a centralized build-and-release orchestration path for blackout-sensitive changes so deployment eligibility, freeze policy, approvals, and release evidence are enforced in one place.

## Problem Statement

Current build activities can be initiated from multiple execution paths with inconsistent visibility into blackout windows and release-policy exceptions. This creates avoidable risk for:

1. Unauthorized deploy attempts during blackout windows.
2. Policy drift between teams and services.
3. Fragmented audit evidence for release readiness and compliance review.

## Scope

### In Scope

1. Introduce a centralized build coordinator that evaluates blackout policy before release promotion.
2. Define a single policy source (config + metadata) for blackout windows, exceptions, and owner approvals.
3. Require standardized release evidence artifacts (test status, diff scope, approver identity, timestamp).
4. Add observability for blocked/rejected/promoted builds.
5. Publish operator runbook and escalation path for time-sensitive exceptions.

### Out of Scope

1. Re-architecting service-specific CI pipelines unrelated to release gating.
2. Changing product-level freeze policy itself (governance-owned).
3. Replacing existing artifact storage providers.

## Deliverables

1. **Centralized gate service/module** integrated with current release workflow.
2. **Blackout policy contract** (schema + examples) stored in `docs/contracts/blackout-policy.schema.json` and `docs/contracts/examples/blackout-policy.example.json`.
3. **Approval workflow** that captures decision evidence and actor identity.
4. **Monitoring dashboard + alerts** for blackout violations and override usage.
5. **Documentation package**: implementation note, operational runbook, and rollback playbook.


## Progress Update

- ✅ Task 1 complete: baseline release-path audit and gap map documented in `docs/blackout_release_path_audit.md`.
- ✅ Task 2 complete: blackout policy schema and example versioned in `docs/contracts/blackout-policy.schema.json` and `docs/contracts/examples/blackout-policy.example.json`.
- ✅ Task 3 complete: centralized gate checks wired into promotion flow via `.github/workflows/ci.yml` + `scripts/blackout-gate-check.mjs` with policy at `config/release/blackout-policy.json`.
- ✅ Task 4 complete: exception/override approval capture added via blackout decision records (`blackout-gate/decision-record.json`) including approver roles/count, ticket, reason, actor, and commit/run context.
- ▶️ Next task: emit structured audit events + metrics.

## Implementation Tasks

| Task | Owner | Estimate | Dependencies | Exit Criteria |
| --- | --- | ---: | --- | --- |
| Baseline release-path audit and gap map | Platform Eng + SRE | 1d | Access to CI/CD configs | Approved inventory of all release entrypoints |
| Define blackout policy schema and storage location | Platform Eng | 0.5d | Gap map complete | Policy schema versioned and reviewed |
| Implement centralized gate checks in promotion flow | Platform Eng | 2d | Policy schema merged | Promotion blocked when blackout policy fails |
| Add exception/override approval capture | Platform Eng + Security | 1d | Gate checks in place | Override requires authenticated approver + reason |
| Emit structured audit events + metrics | SRE | 1d | Gate + approvals wired | Dashboard shows pass/block/override trends |
| Write runbook + rollback instructions | Ops + Platform PM | 0.5d | Flow stabilized | Docs published and linked in release checklist |

## Acceptance Criteria

1. Any release promotion must pass through centralized blackout evaluation.
2. Builds during active blackout windows are blocked by default.
3. Overrides require explicit approval and persist auditable metadata.
4. Operators can view real-time gate outcomes and recent override events.
5. Runbook includes clear operational and emergency-exception procedure.

## Validation Plan

- Unit tests for policy parsing, window evaluation, and override rules.
- Integration tests for promotion pipeline gating behavior.
- Failure-mode tests for stale policy data and unavailable approval backend.
- Dry-run simulation during a scheduled blackout rehearsal.
- Post-implementation review with Release Management + Security.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Misconfigured blackout policy blocks critical release | High | Add preflight validation and emergency override with dual approval |
| Centralized gate becomes single point of failure | High | Deploy HA instance + safe degraded mode (read-only policy cache) |
| Override abuse weakens policy controls | Medium | Alerting + weekly override audit and least-privilege approver roles |
| Team adoption lag due to workflow change | Medium | Migration guide, office hours, and phased rollout by service tier |

## Rollout Plan

1. **Phase 1 (Shadow Mode):** Evaluate policies and emit warnings without blocking.
2. **Phase 2 (Soft Enforcement):** Block non-production promotions; record exception behavior.
3. **Phase 3 (Full Enforcement):** Block production promotions during blackout windows by default.
4. **Phase 4 (Operational Hardening):** Tune alerts, SLOs, and runbook quality from real incidents.

## Definition of Done

- Centralized gate is active for all production promotion paths.
- Blackout policy is versioned, documented, and governed by named owners.
- Auditable evidence exists for approvals and overrides.
- Monitoring + alerts are reviewed and accepted by SRE.
- Release and operations docs are complete and discoverable in `docs/`.
