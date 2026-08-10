# Documentation Index

This index organizes project docs by purpose. Start with the repo-root
`README.md` for the platform overview and quick start.

## Platform Architecture & Economy

- `docs/COMPOSITION_LAYER.md` — how playbooks, listing-types, hawala ledger,
  Refrain, Threshold, and Blackstar share infrastructure and present distinct
  surfaces
- `docs/MODULE_CATALOG.md` — one-line inventory of every backend module
  (purpose, key routes/jobs, doc links)
- `docs/PLAYBOOK_SYSTEM.md` — the vendor playbooks, mapping from legacy
  vendor-type, 3-question picker decision tree
- `docs/LISTING_TYPES.md` — v1 listing-type ship list, v2/v3 deferrals,
  workflow validation
- `docs/ASSET_GRAPH.md` — declarative asset/manifest intake layer (declare
  assets → match manifests → project instances → settlement records)
- `docs/manifests/` — reference asset-graph manifests (yard-scrap nursery,
  tool library, repair café, childcare co-op, creator bounty pool, courier
  collective)
- `docs/VENDOR_QUEST_ENGINE.md` — vendor quest/gamification engine
- `docs/PHASE_0_FOUNDATIONS.md`
- `docs/contracts/phase0/domain-contracts.schema.json`

## Compliance & Money Movement

- `docs/POSTURE_A_COMPLIANCE.md` — FinCEN payment-facilitator frame; the
  lines that cannot be crossed under v1. Required reading before touching
  money-moving code.
- `docs/FISCAL_SPONSOR_DECISION.md` — fiscal sponsor evaluation and the open
  items before donation disbursement goes live
- `docs/runbooks/STELLAR_USDC_BRIDGE.md` — Stellar/USDC treasury operations

## Design & Behavioral System

- `docs/BMC_UNIFIED_DESIGN_BEHAVIORAL_SPEC.md` — the canonical, research-grounded
  spec for the unified FBM × Blackout experience (XP/reputation, onboarding,
  solarpunk visuals, calm audio, cooperative gamification). Maps the brief to
  repo evidence (Present/Partial/Missing) and indexes the remaining gaps.
- `docs/SOLARPUNK_MMORPG_BLUEPRINT.md` — progression/stance/region/leveling model.
- `docs/BLACKOUT_EXPERIENCE_LAYER.md` — shipped earcons/bloom/onboarding + XP economy.

## Architecture Decision Records

- `docs/adr/ADR-0001-event-driven-sync.md`
- `docs/adr/ADR-0002-idempotency-and-consistency-windows.md`
- `docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md`
- `docs/adr/ADR-0004-cooperative-gamification-and-opt-in-leaderboards.md`

## Integrations & External Contracts

- `docs/integrations/fbm-connect.md` — the `connect.js` embed (Mode 1/2/3)
  that powers vendor sites and the vertical portals
- `docs/integrations/n8n/README.md` — n8n automation integration
- `docs/contracts/marketplace-layer.md` — BMC marketplace-layer API contracts
  (entitlements, affiliate attribution, group commerce, plugin/theme listings,
  Blackout / Blackstar integration endpoints)
- `docs/contracts/blackout-integration.md` — Blackout (Matrix) integration
  contract

## AI (Hermes) Orchestration

- `services/ai-orchestrator/README.md` (repo path) — service overview
- `docs/AI_INTEGRATION_CLOSURE_CHECKLIST.md`
- `docs/operations/AI_SECURITY_WORKFLOW.md` — AI-driven security/dependency
  update workflow for the maintained forks
- `docs/work-orders/` — Hermes prompt, validation, wiring, and vendor-runtime
  integration work orders

## Planning & Strategy

- `FEATURE_BUILD_PLAN.md` (repo root)
- `ROADMAP.md` (repo root)
- `docs/CREATOR_COMMERCE_ROADMAP.md`
- `docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md` — collective-campaign /
  micro-investment spec
- `docs/PRODUCT_LISTING_UNIFICATION_PLAN.md`
- `docs/VENDOR_PORTAL_IMPROVEMENT_PLAN.md`
- `docs/VENDOR_PORTAL_PROJECT_TRACKER.md`
- `docs/WEBSITE_POSITIONING_ALIGNMENT_PLAN.md`
- `docs/ENV_CONFIGURATION.md` — environment variable reference and validation

## Vendor Hype Operations Prediction (suite)

Start with the whitepaper; the rest are phase-specific deep dives.

- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md` — entry point
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_BACKEND_ARCHITECTURE.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_FRONTEND_UX_ARCHITECTURE.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_ALLOCATION_ENGINE_DESIGN.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_SETTLEMENT_WORKFLOWS.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_PHASE_A_B_PRODUCT_SPEC.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_GROWTH_LAUNCH_PLAN_PHASE_A_B.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_RELEASE_VALIDATION_PLAN_PHASE_A_B.md`
- `docs/VENDOR_HYPE_ORACLE_KEY_ROTATION_SOP.md`
- `docs/vendor-hype-prediction-operations-runbook.md`

## Operations & Runbooks

- `docs/PRODUCTION_READINESS.md` — production readiness index
- `docs/GO_LIVE_CHECKLIST.md`
- `docs/HEALTHCHECKS.md`
- `docs/OBSERVABILITY.md` and `docs/observability/PHASE1_SLO_DASHBOARDS.md`
- `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` — ecosystem-wide operations posture
  (fork maintenance, substrate layers)
- `docs/runbooks/` — deployment (`DEPLOYMENT.md`, `FEDORA_DEPLOYMENT.md`,
  `FBM_MIGRATION_TO_PRIMARY_SERVER.md`), release (`RELEASE.md`),
  backup/restore (`BACKUP_RESTORE.md`), disaster recovery (`DR.md`),
  incident response (`INCIDENT_RESPONSE.md`, `ON_CALL.md`,
  `POSTMORTEM_TEMPLATE.md`), plus `SECRETS_MANAGER_MIGRATION.md`,
  `MXID_VENDOR_BACKFILL.md`, `STELLAR_USDC_BRIDGE.md`,
  `STOREFRONT_CAPACITOR_EMBED.md`
- `docs/operations/` — `UPSTREAM_ADVISORIES.md` (security advisory feed),
  `AI_SECURITY_WORKFLOW.md`, `SPOF_MAP.md`, `BUS_FACTOR_DRILL_CADENCE.md`,
  `CO_MAINTAINER_ONBOARDING.md`
- `docs/VENDOR_PILOT_SUPPORT_RUNBOOK.md`
- `docs/blackout_centralized_build_work_order.md` and
  `docs/blackout_release_path_audit.md` — release blackout-window process
  (distinct from the external "Blackout Community" tester platform)

## Delivery Tracking & QA

- `docs/COMPLETION_TRACKER.md`
- `docs/AUDIT_DEBT.md` — deferred audit backlog
- `docs/RELEASE_NOTES.md`
- `docs/RELEASE_VALIDATION_PLAYBOOK.md`
- `docs/QA_WORK_TRACKER.md`
- `docs/QA_REMEDIATION_PLAN.md`
- `docs/qa-release-readiness-evidence-2026-02-13.md`
- `docs/qa-production-readiness-check-2026-05-13.md`

## Testing Program

- `docs/testing/README.md` — testing program index (see repo-root
  `TESTING.md` for tester onboarding)
- `docs/testing/manual-test-plan-storefront.md`
- `docs/testing/manual-test-plan-vendor-panel.md`
- `docs/testing/manual-test-plan-admin-panel.md`
- `docs/testing/production-readiness-checklist.md`
- `docs/testing/security-bounty-scope.md`

## Surface Audits

- `docs/TRUST_LANDSCAPE_AUDIT.md` — the 2026 marketplace-trust competitive
  analysis checked claim-by-claim against the codebase, plus the staged plan
  for the gaps it found (and the three it missed)
- `docs/ADMIN_PRODUCTS_DISPLAY_REVIEW.md`
- `docs/VENDOR_PANEL_PRODUCTS_DISPLAY_REVIEW.md`
- `docs/STOREFRONT_PRODUCTS_DISPLAY_REVIEW.md`
- `docs/vendor-panel-workflow-audit.md`
- `docs/vendor-portal-links-pages-audit.md`

## Domain Analysis

- `docs/VENDOR_FEATURE_MATRIX.md` — implemented-capability evidence matrix
- `docs/VENDOR_FEATURE_MATRIX_WORKPLAN.md`
- `docs/VENDOR_EXTENSION_DEFINITION_OF_DONE.md`
- `docs/VENDOR_INVENTORY_MANAGEMENT_ANALYSIS.md`
- `docs/VENDOR_INVENTORY_ROUTE_CONTRACT.md`

## Governance & Process

- `docs/GOVERNANCE.md` — maintainer governance (roles, decision process, PR
  and release gating)
- `docs/MEMBER_GOVERNANCE.md` — how members decide things: garden/project
  proposals and voting, cooperative self-declaration, patronage, and an
  explicit account of what platform-level governance does *not* do yet
- `docs/MAINTAINER_TRIAGE_SOP.md`
- `docs/PROJECT_OPERATING_SYSTEM.md` — project board, cadence, KPIs
- `CONTRIBUTING.md` (repo root)
- `CODE_OF_CONDUCT.md` (repo root)

## Quickstart by Surface

- Backend: `backend/README.md` and module/workflow code under `backend/src`.
- Admin Panel: `admin-panel/README.md` and application sources.
- Vendor Panel: `vendor-panel/README.md` and application sources.
- Storefront: `storefront/README.md` and application sources.
- Vertical portals (nursery, wellness, botanical, creator): `nursery-portal/`,
  `wellness-portal/`, `botanical-portal/`, `creator-portal/` — share the
  backend above plus the `packages/bmc-portal-kit` and `packages/bmc-ui`
  workspace packages.
- AI orchestrator: `services/ai-orchestrator/` — LangGraph supervisor agent
  and vendor tool registry.
- End-to-end tests: `e2e/README.md`.
- Repository overview and full layout: `README.md` (repo root).
