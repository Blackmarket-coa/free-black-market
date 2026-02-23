# Feature Build Plan: Farm Commerce Service Gaps

_Last updated: 2026-02-23_

This plan covers the missing capabilities identified in repository review and proposes an implementation sequence across backend (Medusa modules/APIs), vendor/admin panels, storefront, and operations tooling.

> **Companion document:** See `WORK_ORDER.md` for the executable, dependency-ordered task list derived from this plan.

---

## Current State Summary

The platform is a Medusa 2.x monorepo with 4 surfaces (backend, admin-panel, vendor-panel, storefront) and 40 custom backend modules spanning marketplace, commerce, agriculture, community economy, and Hawala finance domains. Key status as of 2026-02-23:

| Area | Status |
|---|---|
| Backend compilation | Green |
| Backend unit tests + coverage gate | Green |
| Admin panel lint + tests | Green (staged baseline; `lint:strict` debt remains) |
| Vendor panel lint + typecheck + tests | Green (staged baseline; route-level type debt remains) |
| Storefront lint | Green (informational warnings only) |
| Phase 0 foundations | Complete (ADRs, contracts, feature flags, queue topics, observability baseline) |
| Phase 1 runtime wiring | Started (module gates, queue handlers, route-boundary schema validation) |
| Open-source enablement | Complete (CONTRIBUTING, CODE_OF_CONDUCT, issue templates, CI, labels, governance, funding) |
| Release validation | Automated (script + CI gate on `release/*` branches) |

### What Exists vs. What's Missing

| Capability | Backend Module | Vendor/Admin UI | Storefront UI | Status |
|---|---|---|---|---|
| Vendor onboarding / `/sell` route | `seller-extension`, `vendor-verification` | Basic signup | `/sell` route exists | Partial — no TTFLL wizard |
| Product listing (standard) | Core Medusa + `product-archetype` | Product CRUD exists | Product pages exist | Functional |
| Digital products | `digital-product`, `digital-product-fulfillment` | Workflows exist | Routes exist | Functional |
| Hawala finance | `hawala-ledger`, `payout-breakdown` | Vendor/admin dashboards | Wallet routes | Functional |
| POS | — | — | — | Not started |
| Weight pricing | — | — | — | Not started |
| Channel sync | — | — | — | Not started |
| Pick/pack | — | — | — | Not started |
| Invoicing | — | — | — | Not started |
| Merchant support | — | — | — | Not started |
| Fraud/risk monitoring | — | — | — | Not started |
| Managed onboarding program | — | — | — | Not started |
| Marketing guidance | — | — | — | Not started |
| Academy/training | — | — | — | Not started |
| Website build services | — | — | — | Not started |
| Promotional tools suite | — | — | — | Not started |
| E-book/webinar resources | — | — | — | Not started |
| CSV product import | `woocommerce-import` (WooCommerce only) | — | — | Partial — no generic CSV |

---

## Goals

1. Close commerce-operational gaps (POS, weight pricing, pick/pack, invoicing, sync).
2. Add service-layer capabilities (merchant support, managed onboarding, training/resources).
3. Add trust and risk controls (fraud monitoring).
4. Turn ad-hoc marketing/support content into productized programs.

## Delivery Principles

- **Module-first backend design**: each major domain gets a dedicated module with workflows, events, and APIs.
- **Operational visibility**: every feature ships with dashboard views, audit logs, and metrics.
- **Phased rollout**: start with MVP + feature flags, then automate.
- **Multi-channel by default**: storefront, mobile web/PWA, social integrations, and POS sync on a shared product/order/inventory event model.
- **Tech debt hygiene**: no new `any` types, no new lint violations against the strict ruleset, tests required for new modules.

---

## Priority Override: Vendor Activation Fast-Track (TTFLL)

The immediate business priority is **"get vendors signed up and get at least 1 product/service live as fast as possible."** The north-star metric is:

> **Time to First Live Listing (TTFLL)**

This track runs before and in parallel with larger platform modules.

### What Already Exists

- `/sell` storefront route is present and renders.
- `seller-extension` and `vendor-verification` backend modules are functional.
- Vendor panel has basic product CRUD.
- Payout infrastructure (Hawala + Stripe) is operational.

### What's Missing for TTFLL

- No 4-step listing wizard in vendor panel.
- No minimal-fields signup flow (current flow includes non-essential fields).
- No auto-redirect from signup completion to first-listing wizard.
- No wizard autosave/resume.
- No step-level analytics/funnel tracking.
- No CSV import path (only WooCommerce-specific import exists).
- No pre-filled listing templates.
- No 48-hour follow-up automation.
- No payout-deferral logic (payout setup is not gated, but also not explicitly deferred).

### Activation Sprint A: Launch-First Onboarding

**Priority: P0 — Execute immediately**

| ID | Task | Depends On | Surface |
|---|---|---|---|
| A1 | Reduce signup to required fields only (`email`, `password/magic-link`, `store_name`) | — | vendor-panel |
| A2 | Auto-redirect new vendors into First Listing wizard after signup | A1 | vendor-panel |
| A3 | Step 1: selling-type selector (`physical`, `digital`, `service`, `event/class`) | A2 | vendor-panel |
| A4 | Step 2: minimal product form (title, price, description, one image) | A3 | vendor-panel, backend |
| A5 | Step 3: delivery setup by selling type (simple defaults) | A4 | vendor-panel, backend |
| A6 | Step 4: publish screen with celebration, storefront URL, copy-link, share CTAs | A5 | vendor-panel |
| A7 | Advanced accordion for optional fields (SKU, variants, SEO, inventory) | A4 | vendor-panel |
| A8 | Persistent reassurance copy: "You can edit this anytime" | A3 | vendor-panel |
| A9 | Wizard autosave + resume support | A3 | vendor-panel |
| A10 | Step analytics events and funnel dashboard | A3 | vendor-panel, backend |

**Release gates (ship blockers):**
- Median TTFLL <= 5 minutes in staging test cohort.
- >= 40% test cohort conversion from signup to first live listing in-session.
- Step-level telemetry visible in analytics for all four wizard steps.

### Activation Sprint B: Scale Listing Velocity

**Priority: P1 — Start after Sprint A ships**

| ID | Task | Depends On | Surface |
|---|---|---|---|
| B1 | Generic CSV import path with downloadable template and error report | A4 | vendor-panel, backend |
| B2 | Pre-filled listing templates (produce, handmade, digital, service) | A3 | vendor-panel |
| B3 | Launch Assist Mode (concierge intake flow) | B1 | vendor-panel, backend |
| B4 | Auto-good storefront baseline (default banner, starter theme) | A6 | storefront |
| B5 | Payout barrier removal (defer payout setup until first sale) | — | backend, vendor-panel |

**Exit criteria:**
- >= 25% reduction in signup drop-off before first publish.
- >= 30% of new vendors publish 3+ listings in first 14 days.

### Activation Sprint C: Retention Automation

**Priority: P1 — Start after Sprint B ships**

| ID | Task | Depends On | Surface |
|---|---|---|---|
| C1 | 48-hour follow-up automation (Branch A: no listing; Branch B: 1 listing) | A10 | backend |
| C2 | Dashboard micro-coaching cards tied to activation state | A10 | vendor-panel |
| C3 | Early-vendor incentives framework (badge, reduced fee, spotlight) | — | backend, vendor-panel, storefront |
| C4 | Movement-first onboarding narrative (mission + earnings copy) | A6 | vendor-panel |

**Exit criteria:**
- Re-engagement rate improves for vendors inactive after signup.
- Email-to-action conversion measurable for both 48-hour branches.

### TTFLL Measurement Pack (ships with Sprint A)

- Signup -> first listing publish conversion rate.
- Average and median TTFLL.
- Drop-off rate at each wizard step.
- % vendors publishing 3+ listings within 14 days.

---

## Phase 0: Foundations & Architecture — COMPLETE

All Phase 0 deliverables have been implemented:

- Domain model contracts and JSON schemas: `docs/contracts/phase0/domain-contracts.schema.json`
- ADRs: `docs/adr/ADR-0001-event-driven-sync.md`, `docs/adr/ADR-0002-idempotency-and-consistency-windows.md`
- Feature flag registry: `backend/src/shared/feature-flags.ts`
- Queue topics + DLQ policies: `backend/src/shared/queue-topics.ts`
- Observability baseline and SLO targets: `docs/observability/PHASE1_SLO_DASHBOARDS.md`

Phase 1 runtime wiring has started (module gates, queue contract-based job handlers, route-boundary schema validation).

---

## Phase 1: Core Commerce Operations

### 1) POS for In-Person Market/Pickup Sales

**Status: Not started | Priority: P1 | Depends on: Phase 0 (complete)**

#### Scope
- Vendor-facing POS app mode (tablet-friendly in vendor panel).
- Offline-tolerant cart capture and queued sync.
- Cash/card split tenders, receipt generation, pickup tags.

#### Backend
- New `pos` module:
  - Models: `pos_session`, `pos_device`, `pos_transaction`, `cash_drawer_count`.
  - APIs: open/close session, ring sale, void/refund, end-of-day report.
- Integrate with existing order pipeline as `sales_channel = POS`.
- Wire to feature flag `FF_POS_ENABLED`.

#### Frontend
- Vendor panel POS route (`/pos`) with quick product search, weighted item entry, discount buttons.
- Printable receipt template + QR order lookup.

#### Ops
- Device setup guide and market-day checklist.

#### Acceptance Criteria
- Complete sale in < 20s median.
- End-of-day reconciliation report generated.
- POS transactions visible in admin order list with `POS` channel tag.
- Offline cart capture syncs correctly when connectivity resumes.

### 2) Sell-by-Weight Pricing

**Status: Not started | Priority: P1 | Depends on: Phase 0 (complete)**

#### Scope
- Price-per-unit-weight products (lb/kg), tare support, min increment rules.
- Optional estimated-at-checkout, final-at-fulfillment adjustment flow.

#### Backend
- Extend product/pricing schema:
  - `pricing_mode = fixed | weight`
  - Fields: `weight_unit`, `price_per_unit`, `min_weight`, `step_weight`, `average_weight`.
- Add workflow for capture/finalization delta charge or adjustment.
- Wire to feature flag `FF_WEIGHT_PRICING_ENABLED`.

#### Frontend
- Vendor product editor for weight rules.
- Storefront UI for "estimated total" and post-fulfillment final total.
- POS support for direct scale/weight input (couples with POS feature).

#### Acceptance Criteria
- Weight product can be listed, sold, fulfilled, and invoiced correctly.
- Storefront displays "estimated" label for weight-priced items.
- Final charge adjustment workflow fires on fulfillment completion.

### 3) Real-Time Inventory/Order Sync Across Channels

**Status: Not started | Priority: P1 | Depends on: Phase 0 (complete), benefits from POS**

#### Scope
- Explicit event-driven sync and channel state visibility.

#### Backend
- `channel-sync` module:
  - Event bus consumers for order placement/cancellation/return and inventory adjustments.
  - Conflict resolution: last-write with vector/version + retry queue.
  - Channel health state and lag metrics.
- Wire to feature flag `FF_CHANNEL_SYNC_ENABLED`.

#### Frontend
- Vendor/admin sync dashboard with lag, errors, and replay controls.
- Product-level "channel sync status" indicator.

#### Acceptance Criteria
- Inventory update reflected across enabled channels within SLA (< 5s target, < 60s fallback).
- Retry + dead-letter replay workflow available.
- Sync lag visible in dashboard with alerting.

---

## Phase 2: Fulfillment & Financial Operations

### 4) Pick-and-Pack Lists

**Status: Not started | Priority: P2 | Depends on: Phase 1 (channel sync for multi-channel batching)**

#### Scope
- Batch generation by delivery date/zone/order cycle.
- Pick list, pack slip, substitution and short-pick handling.

#### Backend
- New `fulfillment-ops` module:
  - Models: `pick_pack_batch`, `pick_item`, `pack_confirmation`, `substitution_log`.
  - APIs for create/assign/complete batches.

#### Frontend
- Vendor tablet-optimized pick workflow (barcode optional).
- Print/export CSV/PDF for labels and slips.

#### Acceptance Criteria
- Batch can be generated, picked, packed, and completion updates order state.
- Substitution logs are recorded and visible to customer.
- PDF export works for all batch sizes tested.

### 5) Invoicing

**Status: Not started | Priority: P2 | Depends on: Hawala/Stripe integration (exists)**

#### Scope
- Draft/final invoices, tax breakdown, payment terms, partial payments, credits.

#### Backend
- `invoicing` module:
  - Models: `invoice`, `invoice_line`, `credit_note`, `payment_application`.
  - Number sequencing, PDF rendering, email dispatch.
  - Hooks to Hawala/Stripe records.
- Wire to feature flag `FF_INVOICING_ENABLED`.

#### Frontend
- Vendor: create/send invoice, mark paid, issue credit.
- Admin: invoice oversight and aging report.
- Customer: invoice history and downloads via storefront.

#### Acceptance Criteria
- Invoice lifecycle end-to-end with email + PDF + payment reconciliation.
- Sequential invoice numbering is gap-free.
- Audit log captures all invoice state transitions.

### 6) Merchant Support

**Status: Not started | Priority: P2 | Depends on: None (can start independently)**

#### Scope
- Support case management + SLAs + escalation.

#### Backend
- `merchant-support` module:
  - Models: `merchant_case`, `case_note`, `case_tag`, `sla_timer`, `case_event`.
- Integrate with Rocket.Chat/email for threaded communication (Rocket.Chat integration partially exists in storefront messaging).

#### Frontend
- Vendor "Support" center (open case, attach files, track status).
- Admin support console with queues and assignment.

#### Acceptance Criteria
- Case intake to resolution flow with SLA breach alerts.
- Cases are searchable and filterable by status/tag.
- Email notifications fire on case state changes.

### 7) Fraud Monitoring

**Status: Not started | Priority: P2 | Depends on: Hawala system (exists), Order pipeline (exists)**

#### Scope
- Rules engine + risk scoring + review queue.

#### Backend
- `risk` module:
  - Real-time checks on order/payment/account events.
  - Rules: velocity, mismatched geo, unusual amount, repeated payment failure.
  - Models: `risk_alert` and decision outcomes.
- Wire to feature flag `FF_FRAUD_MONITORING_ENABLED`.

#### Frontend
- Admin risk dashboard with approve/hold/reject actions.
- Explainability panel per alert.

#### Acceptance Criteria
- Risk alerts generated in real-time and tied to operational actions (hold order, flag account).
- False-positive rate trackable via dashboard.
- Alert resolution audit trail is immutable.

---

## Phase 3: Service Programs & Enablement

### 8) Managed Onboarding Team Workflow

**Status: Not started | Priority: P3 | Depends on: Sprint A TTFLL wizard (as foundation)**

#### Backend
- `onboarding-success` module: `onboarding_cohort`, `onboarding_task`, `owner_assignment`, `milestone`.
- Auto-task templates by seller type.

#### Frontend
- Vendor: progress tracker, scheduled calls, required docs checklist.
- Admin: onboarding manager board, workload balancing.

#### Acceptance Criteria
- Every new merchant gets assigned onboarding plan + owner + milestone tracking.

### 9) Marketing Guidance / Social Best-Practice Program

**Status: Not started | Priority: P3 | Depends on: None**

#### Backend
- `marketing-guidance` module: `playbook`, `checklist`, `campaign_recommendation`, `content_template`.

#### Frontend
- Vendor Marketing Hub with channel-specific checklists.
- KPI cards: post cadence, CTR proxy, conversion uplift.

#### Acceptance Criteria
- Vendor can follow guided checklist and launch first campaign.

### 10) Academy Training/Workshops Program

**Status: Not started | Priority: P3 | Depends on: None**

#### Backend
- `academy` module: `course`, `lesson`, `workshop_event`, `attendance`, `certificate`.
- Webinar provider integration (Zoom/Jitsi) and recording links.

#### Frontend
- Vendor learning portal + workshop calendar + progress tracking.

#### Acceptance Criteria
- Publish course, run workshop, issue completion certificate.

### 11) Custom Farm Website Build (Service Productization)

**Status: Not started | Priority: P3 | Depends on: None**

#### Backend
- `website-services` module: `website_package`, `brief_form`, `milestone`, `handoff`.

#### Frontend
- Vendor onboarding add-on selection + project status page.
- Admin project operations board.

#### Acceptance Criteria
- Website build request can be scoped, tracked, and delivered.

### 12) Promotional Tools Suite

**Status: Not started | Priority: P3 | Depends on: Product listing (exists), Analytics baseline**

#### Backend
- Extend promotions domain with campaign orchestration and audience segments.
- Attribution fields for campaign performance.

#### Frontend
- Vendor campaign builder (templates + scheduling).
- Analytics dashboard for promo performance.

#### Acceptance Criteria
- Merchant can launch and measure a promo campaign end-to-end.

### 13) E-Books/Webinars Support Resources

**Status: Not started | Priority: P3 | Depends on: None**

#### Backend
- `resources` module: `resource_asset`, `resource_category`, `download_event`, `webinar_event`, `registration`.

#### Frontend
- Public resource center + merchant-only downloadable library.
- Registration and reminder flow for webinars.

#### Acceptance Criteria
- Upload e-book, host webinar registration, capture engagement analytics.

---

## Cross-Cutting Requirements

### Security & Compliance
- Role-based access controls for financial/support/risk actions.
- Immutable audit logs for invoice and risk decisions.
- PII minimization in support and analytics exports.

### Data & Analytics
- Event taxonomy for all new modules.
- Warehouse-ready data model for cohort and revenue analysis.
- Standard dashboards: activation, retention, order quality, fraud losses, support SLA.

### Documentation
- Update product docs and README feature matrix with explicit capability language.
- Add runbooks for support, fulfillment, and risk ops.

### Tech Debt (Ongoing)
- Admin panel: burn down `lint:strict` violations incrementally.
- Vendor panel: resolve remaining route-level typecheck mismatches.
- Backend: expand unit test coverage for new modules (enforce coverage threshold in CI).
- Storefront: address QA follow-up for static internal-link route validation.

---

## Open-Source Project Enablement Track — COMPLETE

All open-source readiness items have been implemented:

- CONTRIBUTING.md, CODE_OF_CONDUCT.md present.
- Issue templates (bug_report.yml, feature_request.yml) and PR template present.
- CI workflow with lint/test/security automation.
- Coverage artifact reporting.
- ROADMAP.md and docs/GOVERNANCE.md with roles and decision process.
- Label taxonomy in .github/labels.yml with sync workflow.
- .github/FUNDING.yml sponsorship metadata.
- Maintainer triage SOP.

### Remaining Improvement Opportunities
- Consolidate docs navigation under `docs/README.md` index.
- Add high-level architecture diagram and per-surface quickstart links.
- Add README badges (build status, license, coverage).

---

## Release Sequencing

### Activation Now (Weeks 1–2)
- Sprint A: TTFLL wizard + minimal signup + analytics pack

### Release A (Weeks 3–8)
- Sprint B: CSV import + templates + payout deferral
- POS MVP
- Weight pricing MVP

### Release B (Weeks 9–14)
- Sprint C: Retention automation
- Channel sync MVP
- Pick-and-pack MVP
- Invoicing MVP

### Release C (Weeks 15–20)
- Merchant support MVP
- Fraud monitoring MVP

### Release D (Weeks 21–28)
- Managed onboarding program
- Marketing guidance hub
- Academy/workshops
- Website build services workflow
- Promotional tools suite
- E-book/webinar resource center

---

## Resourcing (Suggested)

| Role | Count | Focus |
|---|---|---|
| Backend engineer | 3 | Module development, API design, workflow implementation |
| Frontend engineer | 2 | Vendor panel, admin panel, storefront changes |
| Data/Platform engineer | 1 | Analytics, sync infrastructure, observability |
| Designer | 1 | TTFLL wizard, POS interface, dashboard UX |
| Product manager | 1 | Prioritization, acceptance criteria, stakeholder alignment |
| Support/Ops lead | 1 | Process definition for merchant support + onboarding |

---

## Success Metrics

| Metric | Target | Phase |
|---|---|---|
| Median TTFLL | <= 5 minutes | Sprint A |
| First-session publish rate | >= 40% | Sprint A |
| 14-day multi-listing rate | >= 30% publish 3+ | Sprint B |
| POS checkout time | < 20s median | Phase 1 |
| Inventory sync latency | p95 < 5s | Phase 1 |
| Pick/pack accuracy | >= 99% | Phase 2 |
| Invoice payment cycle | Measurable baseline | Phase 2 |
| Support first-response SLA | Defined and tracked | Phase 2 |
| Fraud chargeback rate | Measurable baseline | Phase 2 |
| Training completion rate | >= 50% of active vendors | Phase 3 |
| Promo campaign GMV uplift | Measurable baseline | Phase 3 |
