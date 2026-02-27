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

## Marketplace Model Decision (Critical)

A single decision should now be made because it changes trust, compliance, OPSEC, and roadmap sequencing:

- A) Public open marketplace
- B) Curated vendor network
- C) Backbone for specific aligned organizations
- D) Hybrid (public entry + curated tiers)

## Recommended default: D (Hybrid)

Reasoning:
- Preserves growth potential from public onboarding.
- Enables trust controls and OPSEC protections through tiered access.
- Supports mission-aligned organizations without blocking independent vendors.
- Allows compliance controls to scale by tier/risk profile.

## Proposed tier structure (initial)
- **Tier 0 (Public):** limited catalog + standard payment/risk controls.
- **Tier 1 (Verified Vendor):** expanded limits, advanced fulfillment, donation routing.
- **Tier 2 (Aligned Org/Network):** priority support, advanced automation, resilience tooling.

## Immediate decision checkpoint
- Confirm target model (A/B/C/D) before implementing donation settlement, onboarding verification depth, and permission defaults.
