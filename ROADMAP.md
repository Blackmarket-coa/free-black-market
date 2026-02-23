# Roadmap

_Last updated: 2026-02-23_

This roadmap provides directional planning for the Free Black Market platform.

> **Execution details:** See `FEATURE_BUILD_PLAN.md` for feature specifications and `WORK_ORDER.md` for the task-level breakdown.

## Completed

- ~~QA remediation and route-contract consistency for admin/vendor/storefront surfaces.~~ All release gates green.
- ~~Open-source readiness package (contribution templates, governance, funding metadata).~~ Complete.
- ~~Validation automation rollout (`scripts/release_validation.sh`) on release branches.~~ CI gate active.
- ~~Phase 0 foundations (domain contracts, ADRs, feature flags, queue policies, observability baseline).~~ Complete.

## Near-term (0–3 months)

- **Vendor Activation Fast-Track (TTFLL)** — P0 priority:
  - Sprint A: 4-step listing wizard, minimal signup, step analytics.
  - Sprint B: CSV import, listing templates, payout deferral, auto-good storefront.
  - Sprint C: 48-hour follow-up automation, micro-coaching, incentives.
- **Core Commerce Operations** — Phase 1, parallel with TTFLL:
  - POS module for in-person market/pickup sales.
  - Weight-based pricing rules and estimated/final total flow.
  - Channel sync module with event-driven inventory/order sync.
- Tech debt burn-down: admin `lint:strict` violations, vendor route typecheck cleanup.

## Mid-term (3–9 months)

- **Fulfillment & Financial Operations** — Phase 2:
  - Pick-and-pack batching with tablet-optimized workflow.
  - Full invoicing lifecycle (draft/final, PDF, email, credits, Hawala/Stripe hooks).
  - Merchant support case management with SLAs.
  - Fraud monitoring rules engine and admin review dashboard.
- Integration reliability improvements (retry policies, idempotent workflows).
- Expanded E2E coverage for cross-module user journeys.

## Long-term (9+ months)

- **Service Programs & Enablement** — Phase 3:
  - Managed onboarding team workflow and cohort tracking.
  - Marketing guidance hub and social best-practice playbooks.
  - Academy training/workshops with certifications.
  - Custom farm website build as productized service.
  - Promotional tools suite (coupons, bundles, referral codes, campaigns).
  - E-book/webinar resource library.
- Multi-channel marketplace sync maturity across storefront/POS/social channels.
- Governance and community economy feature depth.

## Success Signals

- Median TTFLL <= 5 minutes; >= 40% first-session publish rate.
- POS checkout < 20s median; inventory sync p95 < 5s.
- Stable CI with repeatable release validation gates.
- Low critical regression counts across release cycles.
- Healthy contributor pipeline and issue/PR throughput.
