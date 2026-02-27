# Vendor Portal Improvement Plan (Research-Driven)

## Context

This plan translates recent user research into actionable improvements for the vendor portal. The core user need is to run a low-overhead, mostly dropship business with stronger logistics visibility, simpler supplier onboarding (including small independent suppliers), and practical compliance/finance tooling.

The portal should prioritize:

1. Fast go-live for small operators.
2. Low-cost operations and automation.
3. Clear tax/reporting workflows.
4. Flexible catalog sourcing (plugin-based + manual import).
5. Multi-store management with strict permissions.
6. Optional donation/tip checkout flows with transparent fund routing.

---

## Research Themes Mapped to Product Needs

### Theme A: Logistics fragility and fulfillment uncertainty

**Observed pain**
- Vendors worry about limited stock availability and disruptions.
- They need alternatives to holding large inventory for long windows.

**Portal implication**
- Prioritize dropship + hybrid fulfillment flows.
- Make supplier lead-times and inventory freshness visible.
- Add low-stock and delayed-shipment alerts.

### Theme B: Low finances and startup constraints

**Observed pain**
- Small operators cannot carry large upfront costs.
- They need bulk/B2B access without expensive tooling.

**Portal implication**
- Keep onboarding cost low.
- Support free/low-cost integrations first.
- Ship manual CSV + API import options before premium connectors.

### Theme C: Non-technical operator workflows

**Observed pain**
- Vendor succeeded before with plugin ecosystems and “good enough” imports.
- Manual data import is acceptable if guided.

**Portal implication**
- Build no-code onboarding playbooks.
- Add mapping templates and import validations.
- Provide migration wizard from prior platforms.

### Theme D: Trust/compliance and bookkeeping anxiety

**Observed pain**
- Tax state, legal status, and reporting are high stress.

**Portal implication**
- Provide ready-to-export sales/tax reports.
- Offer integrations with bookkeeping tools.
- Surface compliance checklist in onboarding.

---

## Capability Plan by User Questions

## 1) Dropship model compatibility on platform

### Goal
Enable a first-class dropship business model in vendor portal.

### Plan
- Add fulfillment profile templates:
  - `Dropship only`
  - `Hybrid (local + dropship)`
  - `Local inventory`
- Add supplier-level SLA fields:
  - handling time, ship regions, backorder policy, return policy.
- Add order routing engine:
  - auto-route order lines to supplier fulfillment endpoint/email workflow.
- Add fallback mode:
  - manual PO export when supplier has no integration.

### Success metric
- Vendor can publish and fulfill a dropship SKU without custom development.

## 2) Supplier plugins + independent supplier support

### Goal
Support both plugin suppliers and “mom-and-pop” suppliers with no APIs.

### Plan
- Connector framework (tiered):
  - Tier 1: native connectors for common catalog/fulfillment providers.
  - Tier 2: CSV import/export with scheduled sync.
  - Tier 3: email/portal automation templates for manual suppliers.
- Supplier onboarding wizard:
  - map SKU, price, inventory, lead-time, shipping class.
- Import assistant:
  - preview diff before publish and show validation warnings.

### Success metric
- Independent suppliers can be onboarded in under 30 minutes with template + validation.

## 3) Taxes, date-range sales reporting, bookkeeping integrations

### Goal
Reduce compliance overhead for non-accountant operators.

### Plan
- Reporting module:
  - date-range sales, refunds, tax collected, discounts, shipping revenue.
  - export CSV + PDF summary packets.
- Bookkeeping integrations:
  - start with webhook + CSV bridge pattern.
  - then direct integrations for popular SMB tools.
- Finance dashboard:
  - payout reconciliation and invoice status.
- Compliance center:
  - annual/quarterly filing reminder checklist.

### Success metric
- Vendor can produce monthly reconciliation package in <10 minutes.

## 4) Checkout tip/donation option to third-party organizations

### Goal
Support optional tip/donation line item that routes outside merchant revenue.

### Plan
- Checkout donation widget:
  - fixed amount and percentage options.
  - buyer-selectable beneficiary from vetted organization list.
- Settlement routing:
  - split-payment flow where supported.
  - fallback ledger model for periodic disbursement with audit log.
- Transparency layer:
  - receipt line item, settlement status, beneficiary reports.
- Governance:
  - beneficiary verification workflow and anti-fraud controls.

### Success metric
- Donation funds can be tracked end-to-end and excluded from merchant taxable revenue reports where appropriate.

## 5) Automation and API inventory management

### Goal
Provide reliable automation for inventory/price updates.

### Plan
- Vendor API keys scoped by store and role.
- Inventory endpoints + webhooks:
  - stock updated, product updated, order placed, return created.
- Sync policies:
  - conflict resolution modes (`source of truth`, `last write wins`, `manual review`).
- Observability:
  - sync logs, retry queue, dead-letter UI.

### Success metric
- 95%+ inventory updates processed within SLA window and visible in sync logs.

## 6) One account managing multiple storefronts/businesses

### Goal
Enable agency/owner workflows with strong boundaries between entities.

### Plan
- Org model:
  - `User -> Organization -> Storefronts` hierarchy.
- Role-based access:
  - org owner, finance admin, operations manager, catalog editor, read-only analyst.
- Billing model:
  - per-store subscription ledger + consolidated invoice option.
- Reporting scope:
  - store-level P&L + org roll-up dashboard.
- Context switching:
  - clear store selector and session scoping to prevent mistakes.

### Success metric
- Single login can safely operate multiple storefronts with no data leakage.

## 7) Onboarding support (sandbox, SDK, migration assistance)

### Goal
Decrease time-to-first-live-listing for technical and non-technical vendors.

### Plan
- Guided onboarding tracks:
  - `No-code` (UI-only)
  - `Technical` (API/SDK)
- Sandbox mode:
  - test checkout, fake payments, sample data seeds.
- Migration toolkit:
  - import templates, field mappers, post-import QA checklist.
- Learning resources:
  - quickstart docs, short videos, office hours/support queue.

### Success metric
- New vendor reaches first live product in under 1 business day.

---

## Phased Delivery Roadmap

## Phase 1 (0-6 weeks): Foundation for operator confidence

- Dropship/hybrid fulfillment profiles.
- CSV supplier import with mapping validation.
- Basic sales/tax date-range reports.
- MVP onboarding wizard + migration templates.

## Phase 2 (6-12 weeks): Automation and extensibility

- Inventory/order webhooks + API key scopes.
- Connector framework with first native supplier adapters.
- Multi-store org hierarchy and role permissions.
- Donation/tip widget MVP with internal ledger tracking.

## Phase 3 (12-20 weeks): Scale and trust

- Advanced reporting packs and bookkeeping connectors.
- Donation split-settlement + beneficiary verification.
- Sync observability dashboard and SLA analytics.
- Formal partner onboarding for independent suppliers.

---

## UX and Product Requirements (Cross-Cutting)

- Keep setup progressive: basic mode first, advanced controls hidden.
- Always include manual fallback paths (CSV/email) when APIs are unavailable.
- Show plain-language guidance for taxes, filings, and reporting.
- Expose reliability cues: sync status, last update time, and incident banners.

---

## Risks and Mitigations

- **Risk:** Regulatory differences for donations and tax treatment.
  - **Mitigation:** Region-aware tax flags, legal review, auditable ledgers.
- **Risk:** Supplier data quality issues (SKU mismatch, stale inventory).
  - **Mitigation:** validation rules, scheduled reconciliation jobs, exception queue.
- **Risk:** Multi-store role confusion.
  - **Mitigation:** explicit permission matrix + visible store context indicator.

---

## KPI Scorecard

- Time to first live listing.
- Supplier onboarding completion rate.
- % orders auto-routed to supplier without manual intervention.
- Monthly report export completion rate.
- Inventory sync success rate and mean processing latency.
- Donation settlement accuracy and reconciliation time.
- Multi-store admin task completion time.

---

## Immediate Next Actions

1. Confirm baseline platform support for dropship routing and multi-store tenancy.
2. Define data contracts for supplier profile, donation ledger, and org/store RBAC.
3. Ship Phase 1 as a pilot with 5-10 vendors representing mixed technical maturity.
4. Measure KPI baseline and tune onboarding friction before Phase 2 connector expansion.
