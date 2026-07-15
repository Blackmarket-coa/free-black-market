# Documentation Index

This index organizes project docs by purpose.

## Planning & Strategy

- `FEATURE_BUILD_PLAN.md` (repo root)
- `docs/PHASE_0_FOUNDATIONS.md`
- `docs/adr/ADR-0001-event-driven-sync.md`
- `docs/adr/ADR-0002-idempotency-and-consistency-windows.md`
- `docs/contracts/phase0/domain-contracts.schema.json`
- `docs/contracts/marketplace-layer.md` — BMC marketplace-layer API contracts
  (entitlements, affiliate attribution, group commerce, plugin/theme listings,
  Blackout / Blackstar integration endpoints)
- `docs/ENV_CONFIGURATION.md` — environment variable reference and validation
- `docs/PRODUCT_LISTING_UNIFICATION_PLAN.md`
- `docs/VENDOR_PORTAL_IMPROVEMENT_PLAN.md`
- `docs/WEBSITE_POSITIONING_ALIGNMENT_PLAN.md`

## Design & Behavioral System

- `docs/BMC_UNIFIED_DESIGN_BEHAVIORAL_SPEC.md` — the canonical, research-grounded
  spec for the unified FBM × Blackout experience (XP/reputation, onboarding,
  solarpunk visuals, calm audio, cooperative gamification). Maps the brief to
  repo evidence (Present/Partial/Missing) and indexes the remaining gaps.
- `docs/SOLARPUNK_MMORPG_BLUEPRINT.md` — progression/stance/region/leveling model.
- `docs/BLACKOUT_EXPERIENCE_LAYER.md` — shipped earcons/bloom/onboarding + XP economy.
- `docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md`
- `docs/adr/ADR-0004-cooperative-gamification-and-opt-in-leaderboards.md`

## Composition Layer

- `docs/COMPOSITION_LAYER.md` — how playbooks, listing-types, hawala ledger,
  Refrain, Threshold, and Blackstar share infrastructure and present distinct
  surfaces
- `docs/POSTURE_A_COMPLIANCE.md` — FinCEN payment-facilitator frame; the
  lines that cannot be crossed under v1
- `docs/PLAYBOOK_SYSTEM.md` — ten playbooks, mapping from legacy
  vendor-type, 3-question picker decision tree
- `docs/LISTING_TYPES.md` — v1 listing-type ship list, v2/v3 deferrals,
  workflow validation

## Delivery Tracking & QA

- `docs/COMPLETION_TRACKER.md`
- `docs/QA_WORK_TRACKER.md`
- `docs/QA_REMEDIATION_PLAN.md`
- `docs/qa-release-readiness-evidence-2026-02-13.md`
- `docs/RELEASE_VALIDATION_PLAYBOOK.md`

## Surface Audits

- `docs/ADMIN_PRODUCTS_DISPLAY_REVIEW.md`
- `docs/VENDOR_PANEL_PRODUCTS_DISPLAY_REVIEW.md`
- `docs/STOREFRONT_PRODUCTS_DISPLAY_REVIEW.md`
- `docs/vendor-panel-workflow-audit.md`
- `docs/vendor-portal-links-pages-audit.md`

## Domain Analysis

- `docs/VENDOR_FEATURE_MATRIX.md`
- `docs/VENDOR_FEATURE_MATRIX_WORKPLAN.md`
- `docs/VENDOR_INVENTORY_MANAGEMENT_ANALYSIS.md`
- `docs/VENDOR_INVENTORY_ROUTE_CONTRACT.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`

## Governance

- `docs/GOVERNANCE.md`
- `docs/MAINTAINER_TRIAGE_SOP.md`
- `ROADMAP.md` (repo root)
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
- Repository overview and full layout: `README.md` (repo root).
