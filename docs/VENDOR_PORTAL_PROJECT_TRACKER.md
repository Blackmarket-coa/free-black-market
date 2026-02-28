# Vendor Portal Program Tracker

This tracker finalizes Week 0 program setup for the Hybrid vendor portal rollout and converts the seed backlog into sprint-ready execution stories.

## 1) DRO Owner Map (Published)

| Workstream | DRO | Supporting Team | Accountability Scope |
| --- | --- | --- | --- |
| Program / Product | Product Lead (Nadia Rahman) | UX, Support Ops | Prioritization, pilot readiness, release sign-off |
| Architecture / Delivery | Engineering Lead (Marcus Lee) | Backend + Frontend Leads | Cross-workstream sequencing, delivery risk burn-down |
| Dropship + Integrations | Backend Lead (Ibrahim Qureshi) | Platform API, Queue Ops | Supplier forwarding, retries, event emitters |
| Vendor Experience | Vendor Panel Lead (Elena Petrova) | Frontend Platform, Design QA | Dashboard flows, RBAC UX, onboarding experience |
| Financial Data + Reporting | Data/Reporting Lead (Jules Bennett) | Analytics Eng, Finance Ops | Ledger correctness, reconciliations, reporting exports |
| Compliance + Disbursements | Compliance/Ops Lead (Samir Haddad) | Risk, Audit, Legal Ops | Donation controls, verification, auditability |

### Project Board Configuration

- Board: `Vendor Portal Hybrid Rollout`
- Columns: `Backlog`, `Ready`, `In Progress`, `Blocked`, `QA`, `Done`
- Cadence:
  - Monday: 30-minute roadmap sync
  - Wednesday: 30-minute risk/compliance sync
  - Friday: pilot demo + KPI review

## 2) Sprint-Sized Story Breakdown (from Ticket Seed List)

Sprint length: **2 weeks**. Story points intentionally omitted pending first velocity baseline.

### Sprint 1 — Vendor Flow + Dropship Reliability Foundation

#### Story `FBM-VENDOR-001-A`: Product draft/publish happy path hardening
- **Parent:** `FBM-VENDOR-001`
- **Owner:** Vendor Panel Lead
- **Acceptance tests:**
  1. Vendor can create draft product with required fields and save without publish.
  2. Vendor can publish from draft; listing appears in vendor catalog index with publish badge.
  3. Validation errors are inline and actionable for missing required fields.

#### Story `FBM-VENDOR-002-A`: Fulfillment + supplier attachment validation rules
- **Parent:** `FBM-VENDOR-002`
- **Owner:** Vendor Panel Lead
- **Acceptance tests:**
  1. Vendor can select exactly one fulfillment type (`dropship`, `self_ship`, `local`).
  2. `dropship` selection requires a supplier attachment before publish action succeeds.
  3. Editing fulfillment type preserves existing inventory values unless explicitly changed.

#### Story `FBM-DROP-002-A`: Email forwarding reliability under retry conditions
- **Parent:** `FBM-DROP-002`
- **Owner:** Backend Lead
- **Acceptance tests:**
  1. Simulated SMTP transient failure triggers retry according to queue policy.
  2. Retries are visible in admin diagnostics with attempt count and last error.
  3. Jobs that exceed retry threshold land in dead-letter queue with replay option.

### Sprint 2 — Ledger Baseline + Pilot KPI Instrumentation

#### Story `FBM-LEDGER-001-A`: Immutable financial event contract + emitters
- **Parent:** `FBM-LEDGER-001`
- **Owner:** Data/Reporting Lead
- **Acceptance tests:**
  1. Events emitted for `order_captured`, `platform_fee_assessed`, `vendor_payout_accrued`, `donation_accrued`, `refund_issued`, `payout_released`.
  2. Event records are append-only and include canonical IDs (`orderId`, `storefrontId`, `eventId`, timestamp).
  3. Replay job over golden dataset yields deterministic event totals.

#### Story `FBM-LEDGER-002-A`: Pilot reporting exports for payout/fee/donation/tax
- **Parent:** `FBM-LEDGER-002`
- **Owner:** Data/Reporting Lead
- **Acceptance tests:**
  1. CSV exports generated for payout, fee, donation, and tax by date range.
  2. Export schemas match documented column contract.
  3. Donation totals excluded from vendor gross sales output.

#### Story `FBM-KPI-001`: Baseline instrumentation for pilot vendors
- **Parent:** Program setup KPI baseline
- **Owner:** Engineering Lead
- **Acceptance tests:**
  1. Events emitted for `first_listing_published`, `order_forward_attempted`, `order_forward_succeeded`, `reconciliation_run_completed`, `donation_disbursement_completed`.
  2. Events include `vendorId`, `storefrontId`, and environment tag for pilot filtering.
  3. Metric pipeline latency <15 minutes from event emit to dashboard visualization.

### Sprint 3 — Donation Routing + Multi-store Pilot Safety

#### Story `FBM-DONATE-001-A`: Checkout donation selector + beneficiary validation
- **Parent:** `FBM-DONATE-001`
- **Owner:** Compliance/Ops Lead
- **Acceptance tests:**
  1. Buyer can choose percentage or round-up donation mode at checkout.
  2. Only verified beneficiaries are selectable in production mode.
  3. Receipt includes donation line item and beneficiary name.

#### Story `FBM-MULTI-002-A`: Tier gate enforcement regression suite
- **Parent:** `FBM-MULTI-002`
- **Owner:** Vendor Panel Lead
- **Acceptance tests:**
  1. Tier 0 users cannot access donation routing admin features.
  2. Tier 1 users can access verified vendor capabilities after checklist approval.
  3. Tier transitions are logged with actor, timestamp, and reason code.

#### Story `FBM-ONBOARD-002-A`: First-session activation pilot validation
- **Parent:** `FBM-ONBOARD-002`
- **Owner:** Product Lead
- **Acceptance tests:**
  1. New pilot vendor can import catalog, publish first listing, and view sales report in first session.
  2. Median completion time for script target is <= 1 business day.
  3. Top 5 friction points recorded and fed into backlog within 48 hours.

## 3) KPI Dashboard Baseline (Pilot Vendors)

Dashboard: `Pilot Vendor Operations Baseline`

### Baseline KPIs and metrics wiring

| KPI | Metric Definition | Event/Source | Baseline Window | Owner |
| --- | --- | --- | --- | --- |
| Time to first live listing | Median time from `vendor_account_approved` to `first_listing_published` | Vendor panel analytics event stream | Rolling 7 days | Product Lead |
| Order-forwarding success rate | `order_forward_succeeded / order_forward_attempted` | Dropship worker events + queue outcomes | Rolling 7 days | Backend Lead |
| Payout reconciliation pass rate | `% reconciliation runs with zero discrepancy` | Ledger reconciliation job summary table | Weekly close | Data/Reporting Lead |
| Donation settlement latency | Median elapsed time from `donation_accrued` to `donation_disbursement_completed` | Ledger + settlement jobs | Rolling 14 days | Compliance/Ops Lead |

### Instrumentation implementation checklist

- [x] Define canonical event names and required dimensions (`vendorId`, `storefrontId`, `tier`, `pilotCohort`).
- [x] Add event emission points to vendor publish flow, forwarding worker, reconciliation job, and donation disbursement job.
- [x] Add pilot cohort filter in dashboard to isolate launch vendors.
- [x] Set baseline alerts:
  - forwarding success rate < 95% (warning)
  - reconciliation pass rate < 100% (critical)
  - donation settlement latency > 7 days (warning)
- [x] Publish dashboard review ritual in Friday demo agenda.

## 4) Tracker Publication Notes

- This document is the canonical owner map + sprint story breakdown reference for the vendor portal pilot.
- Keep story status transitions in the project board; keep ownership, acceptance criteria, and KPI definitions here.
