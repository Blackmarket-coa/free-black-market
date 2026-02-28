# Free Black Market Vendor Portal Improvement Plan

## Product Positioning (Canonical)

**FreeBlackMarket.com is the production commerce layer for resilient, sovereign, low-capital marketplace operations.**

This plan treats Free Black Market as core infrastructure, not an experiment.

### Core identity

Free Black Market should be:
- Vendor-first
- Low-overhead
- Dropship-compatible
- Donation-enabled
- Multi-store capable
- Automation-ready
- Eventually mesh-compatible via Blackout

### Strategic differentiation

Mainstream platforms optimize for broad retail convenience.
Free Black Market should optimize for **economic resilience**, **operator safety**, and **logistics adaptability**.

---

## Build Priorities (Free Black Market Specific)

## 1) Vendor Infrastructure (Non-negotiable)

### Must-have dashboard capabilities
- Product management
- Fulfillment type selection:
  - Dropship
  - Self-ship
  - Local
- Supplier attachment to products
- Basic inventory tracking
- Sales reporting (date range)
- CSV export

### Why this is first
Without this baseline, serious vendors cannot launch or sustain operations.

### Acceptance criteria
- New vendor can publish at least one product and process at least one order end-to-end.
- Vendor can export date-range sales CSV without support intervention.

## 2) Dropship Engine (Phase 1.5)

### MVP behavior (do not overengineer)
- Order created.
- System forwards order to supplier via:
  - templated email **or**
  - API call.
- Fulfillment status updated either manually or by webhook.

### Supplier support tiers
- Manual suppliers
- Spreadsheet-based suppliers
- API suppliers

### Acceptance criteria
- A supplier with no API can still receive and fulfill orders through standardized email/CSV workflow.
- At least one API supplier flow is operational for parity testing.

## 3) Financial Event Ledger (Critical trust layer)

### Requirement
All commerce transactions should be recorded as immutable event objects.

### Event outputs
Generate vendor-facing and ops-facing reporting from the ledger:
- Vendor payout reports
- Donation totals
- Platform fee summaries
- Tax export CSV

### Why this matters
This reduces reconciliation failures and prevents accounting sync pain by making ledger events the source of truth.

### Acceptance criteria
- Payout, fee, donation, and tax exports reconcile to ledger totals for the same date range.

---

## Signature Capability: Donation Routing Engine

## Checkout donation options
At checkout, buyer can:
- Add donation by percentage
- Select a beneficiary organization from approved list
- Round up order total

## Settlement models
- **Option 1 (preferred):** processor-level split payments where available.
- **Option 2 (fallback):** platform donation bucket in ledger + scheduled batch disbursement.

## Transparency requirement
- Donation line visible in receipt and order timeline.
- Beneficiary-level disbursement reporting.
- Public donation transparency page (phase rollout) for legitimacy/trust.

### Acceptance criteria
- Donation funds are auditable end-to-end and separable from vendor sales reporting.

---

## Multi-Store Architecture

## Tenancy model
`User -> Organization -> Storefront(s)`

## Example storefront set
- Survival supplies
- Artisan goods
- Bulk B2B

## Per-store controls
- Separate branding and catalog
- Separate reporting views
- Shared login at org level

## Required governance controls
- Role-based permissions per storefront
- Billing scope by storefront with optional org roll-up invoice
- Explicit context-switch UX to prevent cross-store mistakes

### Acceptance criteria
- One user can manage multiple storefronts without data leakage across store boundaries.

---

## Inventory Automation (After Stability)

After baseline dropship reliability is proven, implement:
- Supplier inventory polling
- Auto-disable out-of-stock SKUs
- Threshold and exception alerts
- Backup supplier logic

Longer-term extensions:
- Regional supplier routing
- Crisis mode catalog substitution for constrained logistics windows

### Acceptance criteria
- Inventory sync latency and failure rates are observable and within SLA.

---

## Onboarding System (Adoption Multiplier)

## Required onboarding assets
- CSV importer
- Storefront starter templates
- Sandbox test mode
- Migration helper with Shopify CSV compatibility

### UX principle
If onboarding is difficult, adoption fails regardless of feature depth.

### Acceptance criteria
- Vendor can import catalog from template and publish first listing in first session.

---

## What Not To Build Yet

Defer until core commerce stability is proven:
- Crypto payments
- Full mesh integration
- Complex governance voting systems
- Heavy automation orchestration before demand validation

First prove vendors can:
- List
- Sell
- Get paid
- Route donations
- Dropship reliably

---

## Strategic Outcome

If executed in this order, Free Black Market becomes:
- A low-cost launchpad for small vendors
- Resilience-oriented commerce infrastructure
- A donation-enabled economic layer
- A logistics-aware marketplace backbone

This aligns with:
- Automation ambitions
- Mesh ambitions (later-stage)
- Economic autonomy goals

---

## Realistic Build Order

## Phase 1 (0-3 months)
- Vendor dashboard baseline
- Product and fulfillment type system
- Manual dropship forwarding
- Event ledger + core reporting

## Phase 2 (3-6 months)
- Donation routing engine
- Multi-store architecture
- CSV import/export hardening

## Phase 3 (6-12 months)
- Inventory automation
- Public API hardening
- Supplier redundancy logic

---

## Marketplace Model (Selected)

**Selected operating model: D) Hybrid (public entry + curated tiers).**

This selection is now the default for roadmap execution because it:
- Preserves growth potential from public onboarding.
- Enables trust controls and OPSEC protections through tiered access.
- Supports mission-aligned organizations without blocking independent vendors.
- Allows compliance controls to scale by tier/risk profile.

## Tier structure (initial)
- **Tier 0 (Public):** limited catalog + standard payment/risk controls.
- **Tier 1 (Verified Vendor):** expanded limits, advanced fulfillment, donation routing.
- **Tier 2 (Aligned Org/Network):** priority support, advanced automation, resilience tooling.

## Execution implications of Hybrid model
- Onboarding: public signup with progressive verification gates by tier.
- Trust & compliance: risk controls, limits, and reporting requirements increase by tier.
- OPSEC: sensitive operational capabilities restricted to verified tiers.
- Feature rollout: donation settlement controls and automation permissions enabled per tier policy.

---

## Actionable Execution Plan (Build-Out)

This section converts strategy into immediately executable work with owners, deliverables, and Definition of Done.

## Program setup (Week 0)

- [ ] Appoint directly responsible owners (DROs):
  - Product Lead
  - Engineering Lead
  - Backend Lead
  - Vendor Panel Lead
  - Data/Reporting Lead
  - Compliance/Ops Lead
- [ ] Create a single project board with columns: `Backlog`, `Ready`, `In Progress`, `Blocked`, `QA`, `Done`.
- [ ] Define weekly operating cadence:
  - 30-min roadmap sync
  - 30-min risk/compliance sync
  - Demo every Friday
- [ ] Create baseline KPI dashboard for:
  - Time to first live listing
  - Order-forwarding success rate
  - Payout reconciliation pass rate
  - Donation settlement latency

**Definition of done (Program setup):**
- Named owner for each workstream.
- Board live with initial tickets.
- KPI baseline visible to team.

## Workstream A — Vendor dashboard baseline (Weeks 1-4)

### Build tasks
- [x] Add product CRUD screens with draft/publish state.
- [x] Add fulfillment type selector (`dropship`, `self_ship`, `local`).
- [x] Add supplier attachment UI on product form.
- [x] Add inventory quantity + low-stock threshold fields.
- [x] Add sales report page with date filters.
- [x] Add CSV export action for filtered report data.

### QA/UAT tasks
- [ ] UAT script: vendor creates product, sets fulfillment, publishes listing.
- [ ] UAT script: vendor exports date-range sales CSV.
- [ ] Verify role permissions for vendor/admin data scope.

**Definition of done (Workstream A):**
- 5 pilot vendors can complete product publish flow and export sales CSV without support.

## Workstream B — Dropship engine MVP (Weeks 2-6)

### Build tasks
- [x] Create supplier profile model with contact method (`email`, `api`, `manual`).
- [x] Implement order forwarding worker for supplier email template.
- [x] Implement API forwarding adapter interface (v1 supports one adapter).
- [x] Add manual fulfillment update UI with status transitions.
- [x] Add webhook endpoint for supplier status updates.
- [x] Add retry + dead-letter handling for forwarding failures.

### QA/UAT tasks
- [ ] Simulate 20 order forwards for each supplier type.
- [ ] Verify retry behavior and dead-letter visibility.
- [ ] Validate status timeline accuracy in order detail.

**Definition of done (Workstream B):**
- >=95% forwarding success in pilot; failed forwards are recoverable via retry/manual path.

## Workstream C — Financial event ledger + reporting (Weeks 3-8)

### Build tasks
- [ ] Define immutable ledger event schema:
  - `order_captured`
  - `platform_fee_assessed`
  - `vendor_payout_accrued`
  - `donation_accrued`
  - `refund_issued`
  - `payout_released`
- [ ] Emit ledger events from checkout, refunds, payouts.
- [ ] Build reconciliation job by date range + storefront.
- [ ] Add exports: payout report, fee report, donation report, tax CSV.
- [ ] Add discrepancy alerts for reconciliation failures.

### QA/UAT tasks
- [ ] Golden dataset test: known orders/refunds/payouts reconcile exactly.
- [ ] Validate CSV export format against bookkeeping import expectations.
- [ ] Validate donation amounts are excluded from vendor gross sales outputs.

**Definition of done (Workstream C):**
- Reconciliation job passes for pilot storefronts for 4 consecutive weekly runs.

## Workstream D — Donation routing engine (Weeks 6-10)

### Build tasks
- [ ] Add checkout donation UI (percentage + round-up + beneficiary selector).
- [ ] Add beneficiary management list with verification status.
- [ ] Implement settlement mode toggle:
  - `split_processor`
  - `ledger_batch`
- [ ] Add scheduled batch disbursement flow for ledger mode.
- [ ] Add donation transparency data endpoint and internal report page.

### QA/UAT tasks
- [ ] Test mixed carts with and without donations.
- [ ] Verify receipts show donation line item clearly.
- [ ] Verify weekly donation disbursement report totals match ledger.

**Definition of done (Workstream D):**
- Donation funds fully auditable and disbursement report generated without manual spreadsheet corrections.

## Workstream E — Multi-store hybrid tier controls (Weeks 8-12)

### Build tasks
- [x] Implement `User -> Organization -> Storefront` relationships.
- [x] Add storefront switcher with hard context boundary.
- [x] Add role matrix by tier/storefront:
  - org_owner
  - storefront_admin
  - catalog_manager
  - finance_viewer
- [x] Add tier flags (`tier0_public`, `tier1_verified`, `tier2_aligned_org`).
- [x] Apply feature gates by tier for donation routing and advanced automation.

### QA/UAT tasks
- [ ] Permission boundary test across two storefronts under one org.
- [ ] Tier-upgrade test from Tier 0 to Tier 1 with verification checklist.
- [ ] Ensure no cross-store data appears in reporting pages.

**Definition of done (Workstream E):**
- Multi-store users can operate multiple storefronts safely with zero cross-tenant leakage in QA.

## Workstream F — Onboarding & migration (Weeks 10-14)

### Build tasks
- [x] Ship CSV importer with field mapping + validation errors.
- [x] Add starter storefront templates (3 vertical presets).
- [x] Add sandbox mode with test payments/order simulation.
- [x] Add Shopify CSV-compatible import preset.
- [x] Add “first listing” onboarding checklist in dashboard.

### QA/UAT tasks
- [ ] Migration dry run with two historical Shopify-format exports.
- [ ] First-session activation test with new pilot vendors.
- [ ] Verify import error messages are actionable/non-technical.

**Definition of done (Workstream F):**
- Median time to first live listing <= 1 business day for pilot cohort.

---

## 30/60/90-Day Action Checklist

## Day 0-30
- [ ] Ship Workstream A baseline.
- [ ] Complete Dropship Workstream B email/manual paths.
- [ ] Publish pilot runbook for vendor support and incident handling.

## Day 31-60
- [ ] Complete Ledger Workstream C and initial reconciliation automation.
- [ ] Ship Donation Workstream D in ledger batch mode.
- [ ] Launch first hybrid tier verification workflow (Tier 0 -> Tier 1).

## Day 61-90
- [ ] Ship Multi-store Workstream E.
- [ ] Ship Onboarding Workstream F importer/templates.
- [ ] Run post-launch KPI review and reprioritize backlog for Phase 2.

---

## Ticket Seed List (Ready to copy into tracker)

- [x] `FBM-VENDOR-001` Product CRUD + draft/publish workflow
- [x] `FBM-VENDOR-002` Fulfillment type selector + supplier attachment
- [x] `FBM-DROP-001` Supplier profile model + forwarding strategy
- [x] `FBM-DROP-002` Supplier email forwarding worker + retry queue
- [ ] `FBM-LEDGER-001` Immutable ledger event schema + emitter hooks
- [ ] `FBM-LEDGER-002` Payout/fee/donation/tax exports
- [ ] `FBM-DONATE-001` Checkout donation widget + beneficiary selector
- [ ] `FBM-DONATE-002` Donation batch disbursement job + report
- [x] `FBM-MULTI-001` Org/store tenancy model + context switcher
- [x] `FBM-MULTI-002` Tier-based feature gates + RBAC matrix
- [x] `FBM-ONBOARD-001` CSV importer + mapping/validation UI
- [x] `FBM-ONBOARD-002` Shopify CSV preset + first-listing checklist

---

## Release Gates (Must pass before broad rollout)

- [ ] Gate 1: Forwarding reliability >=95% over 2 weeks of pilot traffic.
- [ ] Gate 2: Financial reconciliation pass rate = 100% on weekly close for pilot cohort.
- [ ] Gate 3: Donation disbursement variance = 0 across ledger and report totals.
- [ ] Gate 4: No critical permission leakage findings in multi-store QA.
- [ ] Gate 5: Median time to first live listing <= 1 business day.

---

## Dependency Map (Execution-Critical)

- **Vendor dashboard (A)** depends on stable auth scopes and product schema finalization.
- **Dropship engine (B)** depends on order lifecycle events and supplier profile model.
- **Ledger/reporting (C)** depends on normalized event emission from checkout/refunds/payout paths.
- **Donation routing (D)** depends on ledger event completeness and beneficiary verification workflow.
- **Multi-store/tiering (E)** depends on org/store tenancy model and RBAC baseline.
- **Onboarding/migration (F)** depends on catalog schema stability and import validation rules.

**Sequencing rule:** do not start broad rollout of a downstream workstream until upstream dependencies have passed pilot gates.

## Risk Register (Initial)

| Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| Supplier forwarding failures from malformed templates | Medium | High | Template validation tests + retry/dead-letter queue + manual override workflow | Dropship Lead |
| Ledger/report mismatch during refunds/partial captures | Medium | High | Golden dataset reconciliation tests + weekly close checklist | Data/Reporting Lead |
| Donation fund commingling concerns | Low-Medium | High | Explicit ledger partitioning + disbursement controls + audit log exports | Compliance/Ops Lead |
| Cross-store data exposure in shared sessions | Low | Critical | Strict org/store context boundary + permission integration tests | Vendor Panel Lead |
| Slow vendor activation due to import friction | Medium | Medium | Preset mappings, inline validation, and first-session onboarding support | Product Lead |

## KPI Targets (Pilot -> Phase 2)

- **Time to first live listing:** <= 1 business day (pilot), <= 4 hours (Phase 2 target).
- **Order forwarding success rate:** >= 95% (pilot), >= 98% (Phase 2 target).
- **Reconciliation pass rate:** 100% weekly close for pilot and post-pilot.
- **Donation disbursement latency:** <= 7 days in ledger batch mode.
- **Cross-tenant leakage incidents:** 0 tolerated; any confirmed incident blocks rollout.

## Immediate Next Step (This Week)

1. Finalize DRO assignments and publish owner map in project tracker.
2. Convert Ticket Seed List into sprint-sized stories with acceptance tests.
3. Stand up KPI dashboard with baseline instrumentation for pilot vendors.
4. Run first end-to-end dry run: create product -> place order -> forward supplier -> record ledger events -> export reports.
