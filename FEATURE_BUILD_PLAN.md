# Feature Build Plan: Farm Commerce Service Gaps

This plan covers the missing capabilities identified in repository review and proposes an implementation sequence across backend (`Medusa` modules/APIs), vendor/admin panels, storefront, and operations tooling.

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

---

## Priority Override: Vendor Activation Fast-Track (TTFLL)

If the immediate business priority is **"get vendors signed up and get at least 1 product/service live as fast as possible,"** then the north-star metric for execution is:

- **Time to First Live Listing (TTFLL)**

This track should run before or in parallel with larger platform modules.

### Repository check snapshot (current)

- Managed onboarding appears in Phase 3, but there is no explicit **TTFLL-first 4-step launch wizard** spec in this plan.
- Existing docs reference vendor onboarding and payouts, but there is no explicit requirement here to **defer payout setup until first sale**.
- No explicit **48-hour activation follow-up automation** requirements are captured in this plan.
- No explicit **one-click import (CSV as v1)** requirement is captured in this plan.

### Activation Sprint A (1–2 weeks): launch-first onboarding

**Status: ACTIVE (immediate execution)**

#### Sprint A implementation board

- [ ] A1. Reduce signup to required fields only (`email`, `password/magic-link`, `store_name`).
- [ ] A2. Auto-redirect new vendors into `First Listing` wizard after signup completion.
- [ ] A3. Implement Step 1 selling-type selector (`physical`, `digital`, `service`, `event/class`).
- [ ] A4. Implement Step 2 minimal product form (title, price, description, one image).
- [ ] A5. Implement Step 3 delivery setup by selling type (simple defaults only).
- [ ] A6. Implement Step 4 publish screen with celebration, storefront URL, copy-link, share CTAs.
- [ ] A7. Add `Advanced` accordion for optional fields (SKU, variants, SEO, advanced inventory).
- [ ] A8. Add persistent reassurance copy: "You can edit this anytime."
- [ ] A9. Add wizard autosave + resume support.
- [ ] A10. Add step analytics events and funnel dashboard for drop-off tracking.

#### Sprint A release gates (ship blockers)

- [ ] G1. Median TTFLL <= 5 minutes in staging test cohort.
- [ ] G2. >= 40% test cohort conversion from signup to first live listing in-session.
- [ ] G3. Step-level telemetry visible in analytics for all four wizard steps.

1. **60-second signup (minimal fields only)**
   - Required: email, password/magic link, store name.
   - Defer tax/compliance/payout profile completion to post-listing milestones.

2. **Auto-redirect into a 4-step listing wizard**
   - Step 1: selling type selector (physical, digital, service, event/class).
   - Step 2: minimal product creation (title, price, description, one image).
   - Step 3: delivery setup simplified by listing type.
   - Step 4: publish + celebration state with storefront link and share actions.

3. **Friction controls (required for MVP)**
   - Hide advanced product fields (SKU, variants, SEO, complex inventory) under an expandable "Advanced" section.
   - Persistent reassurance copy: "You can edit this anytime."
   - Progress saved automatically between wizard steps.

4. **Immediate value reveal**
   - Post-publish screen includes copy-link CTA, share buttons, and simple earnings potential explainer.

**Activation Sprint A exit criteria**
- Median TTFLL <= 5 minutes for first-time vendors.
- >= 40% of new signups publish at least one listing within first session.
- Step-level funnel instrumentation available for all 4 wizard steps.

### Activation Sprint B (2–4 weeks): scale listing velocity

5. **One-click import path (v1 CSV)**
   - Add "Already selling elsewhere? Import your products" entry point.
   - CSV mapping flow with downloadable template and error report.
   - Backlog connectors: Shopify/Etsy/TikTok Shop exports.

6. **Pre-filled listing templates**
   - Farm produce, handmade goods, digital download, coaching service templates.
   - Template selector sits before Step 2 and auto-fills relevant fields.

7. **Launch Assist Mode**
   - Optional intake flow (website link, photos, description) to support concierge or semi-automated listing drafting.

8. **Auto-good storefront baseline**
   - Default banner, non-empty layout blocks, and starter theme applied automatically at first publish.

9. **Payout barrier removal**
   - Listing/publishing allowed without payout onboarding.
   - Enforce payout setup only when vendor reaches first sale/first payout threshold.

**Activation Sprint B exit criteria**
- >= 25% reduction in signup drop-off before first publish.
- >= 30% of new vendors publish 3+ listings in first 14 days.

### Activation Sprint C (2 weeks): retention automation and incentives

10. **48-hour follow-up automation**
   - Branch A: signed up but no listing -> help/tutorial/support CTA.
   - Branch B: one listing live -> nudge to add two more listings.

11. **Dashboard micro-coaching**
   - "Your next step to make money" cards tied to activation state.

12. **Early-vendor incentives framework**
   - Badge, reduced fee window, newsletter highlight, social spotlight toggles.

13. **Movement-first onboarding narrative**
   - Onboarding copy explicitly combines earnings value + community-powered commerce mission.

**Activation Sprint C exit criteria**
- Re-engagement rate improves for vendors inactive after signup.
- Email-to-action conversion measurable for both 48-hour branches.

### TTFLL measurement pack (must ship with Sprint A)

- Signup -> first listing publish conversion.
- Average and median TTFLL.
- Drop-off at each wizard step.
- % vendors publishing more than 3 listings.

---

## Open-Source Project Enablement Track (Repo Health)

### Repository check snapshot (current)

- ✅ `CONTRIBUTING.md` present at repository root.
- ✅ `CODE_OF_CONDUCT.md` present at repository root.
- ✅ `.github/ISSUE_TEMPLATE/` present (`bug_report.yml`, `feature_request.yml`).
- ✅ `.github/PULL_REQUEST_TEMPLATE.md` present.
- ✅ `ROADMAP.md` present.
- ✅ `.github/FUNDING.yml` sponsorship metadata present.
- ✅ CI workflow exists at `.github/workflows/ci.yml` with lint/test/security automation.
- ✅ Coverage artifact reporting enabled in CI (`backend-coverage` upload).
- ✅ Label taxonomy metadata is codified in `.github/labels.yml` and enforced by `.github/workflows/label-sync.yml`.

### Build-plan additions (if not yet implemented)

1. Add contributor docs bundle:
   - `CONTRIBUTING.md`
   - `CODE_OF_CONDUCT.md`
   - README updates for architecture/deploy/help pathways.

2. Add contribution workflow templates:
   - `.github/ISSUE_TEMPLATE/bug_report.yml`
   - `.github/ISSUE_TEMPLATE/feature_request.yml`
   - `.github/PULL_REQUEST_TEMPLATE.md`

3. Extend quality automation:
   - Keep CI lint/test gates on PRs.
   - Add dependency/security scanning and optional coverage reporting.

4. Publish roadmap + governance docs:
   - `ROADMAP.md` with short/mid/long horizon milestones.
   - `docs/GOVERNANCE.md` with roles and decision process.

5. Add contributor-growth mechanics:
   - Label taxonomy (`good first issue`, `help wanted`, `priority`).
   - Maintainer triage SOP for first-time contributors.

6. Add sustainability and trust signals:
   - `.github/FUNDING.yml` and/or `SPONSORS.md`.
   - README badges (build/license/issues/coverage as available).

7. Improve repository information architecture:
   - Consolidate docs navigation under `docs/README.md` index.
   - Add high-level architecture diagram and per-surface quickstart links (backend/admin/vendor/storefront).

---

## Phase 0 (2 weeks): Foundations & Architecture

### 0.1 Domain model alignment
- Define canonical entities and events:
  - `SalesChannel` (storefront, POS, social, marketplace feed)
  - `InventoryLedgerEvent` and `OrderSyncEvent`
  - `WeightPriceRule`
  - `PickPackBatch`
  - `Invoice`
  - `MerchantCase` and `RiskAlert`
  - `OnboardingProgram`, `TrainingAsset`, `PromoCampaign`
- Add ADR docs for event-driven sync, idempotency, and eventual consistency windows.

### 0.2 Platform prerequisites
- Add feature flags for each capability.
- Add queue topics and dead-letter policies for critical flows (payments, inventory sync, invoice issuance).
- Add observability baseline: traces, structured logs, and SLO dashboards.

**Exit criteria**
- Approved architecture docs.
- Data contracts and JSON schemas committed.
- Feature flags wired in backend and UIs.

---

## Phase 1 (4–6 weeks): Core Commerce Operations

## 1) POS for in-person market/pickup sales

### Scope
- Vendor-facing POS app mode (tablet-friendly in vendor panel).
- Offline-tolerant cart capture and queued sync.
- Cash/card split tenders, receipt generation, pickup tags.

### Backend
- New `pos` module:
  - `pos_session`, `pos_device`, `pos_transaction`, `cash_drawer_count` models.
  - APIs: open/close session, ring sale, void/refund, end-of-day report.
- Integrate with existing order pipeline as `sales_channel = POS`.

### Frontend
- Vendor panel POS route (`/pos`) with quick product search, weighted item entry, discount buttons.
- Printable receipt template + QR order lookup.

### Ops
- Device setup guide and market-day checklist.

**MVP acceptance**
- Complete sale in < 20 seconds median.
- End-of-day reconciliation report generated.

## 2) Sell-by-weight pricing

### Scope
- Price-per-unit-weight products (lb/kg), tare support, min increment rules.
- Optional estimated-at-checkout, final-at-fulfillment adjustment flow.

### Backend
- Extend product/pricing schema:
  - `pricing_mode = fixed | weight`
  - `weight_unit`, `price_per_unit`, `min_weight`, `step_weight`, `average_weight`.
- Add workflow for capture/finalization delta charge or adjustment.

### Frontend
- Vendor product editor for weight rules.
- Storefront UI for “estimated total” and post-fulfillment final total.
- POS support for direct scale/weight input.

**MVP acceptance**
- Weight product can be listed, sold, fulfilled, and invoiced correctly.

## 3) Real-time inventory/order sync across channels

### Scope
- Explicit event-driven sync and channel state visibility.

### Backend
- `channel-sync` module:
  - Event bus consumers for order placement/cancellation/return and inventory adjustments.
  - Conflict resolution strategy (last-write with vector/version + retry queue).
  - Channel health state and lag metrics.

### Frontend
- Vendor/admin sync dashboard with lag, errors, and replay controls.
- Product-level “channel sync status” indicator.

### Documentation
- Add clear “real-time sync” language + guarantees (e.g., < 5s target, fallback < 60s).

**MVP acceptance**
- Inventory update reflected across enabled channels within SLA.
- Retry + dead-letter replay workflow available.

---

## Phase 2 (3–5 weeks): Fulfillment & Financial Operations

## 4) Pick-and-pack lists (explicit feature)

### Scope
- Batch generation by delivery date/zone/order cycle.
- Pick list, pack slip, substitution and short-pick handling.

### Backend
- New `fulfillment-ops` module:
  - `pick_pack_batch`, `pick_item`, `pack_confirmation`, `substitution_log`.
  - APIs for create/assign/complete batches.

### Frontend
- Vendor tablet-optimized pick workflow (barcode optional).
- Print/export CSV/PDF for labels and slips.

**MVP acceptance**
- Batch can be generated, picked, packed, and completion updates order state.

## 5) Invoicing (full feature)

### Scope
- Draft/final invoices, tax breakdown, payment terms, partial payments, credits.

### Backend
- `invoicing` module:
  - `invoice`, `invoice_line`, `credit_note`, `payment_application`.
  - Number sequencing, PDF rendering, email dispatch.
  - Hooks to Hawala/Stripe records.

### Frontend
- Vendor: create/send invoice, mark paid, issue credit.
- Admin: invoice oversight and aging report.
- Customer: invoice history and downloads.

**MVP acceptance**
- Invoice lifecycle end-to-end with email + PDF + payment reconciliation.

## 6) Merchant support as a dedicated capability

### Scope
- Support case management + SLAs + escalation.

### Backend
- `merchant-support` module:
  - `merchant_case`, `case_note`, `case_tag`, `sla_timer`, `case_event`.
- Integrate with Matrix chat/email for threaded communication.

### Frontend
- Vendor “Support” center (open case, attach files, track status).
- Admin support console with queues and assignment.

**MVP acceptance**
- Case intake to resolution flow with SLA breach alerts.

## 7) Fraud monitoring (explicit capability)

### Scope
- Rules engine + risk scoring + review queue.

### Backend
- `risk` module:
  - Real-time checks on order/payment/account events.
  - Rules: velocity, mismatched geo, unusual amount, repeated payment failure.
  - `risk_alert` and decision outcomes.

### Frontend
- Admin risk dashboard with approve/hold/reject actions.
- Explainability panel per alert.

**MVP acceptance**
- Risk alerts generated in real-time and tied to operational actions.

---

## Phase 3 (4–6 weeks): Service Programs & Enablement

## 8) Managed onboarding team workflow

### Scope
- Convert basic wizard into managed success program.

### Backend
- `onboarding-success` module:
  - `onboarding_cohort`, `onboarding_task`, `owner_assignment`, `milestone`.
  - Auto-task templates by seller type.

### Frontend
- Vendor: progress tracker, scheduled calls, required docs checklist.
- Admin: onboarding manager board, workload balancing.

**MVP acceptance**
- Every new merchant gets assigned onboarding plan + owner + milestone tracking.

## 9) Marketing guidance / social best-practice program

### Scope
- Embedded playbooks and performance nudges.

### Backend
- `marketing-guidance` module:
  - `playbook`, `checklist`, `campaign_recommendation`, `content_template`.

### Frontend
- Vendor Marketing Hub with channel-specific checklists (Instagram/Facebook/TikTok/email).
- KPI cards: post cadence, CTR proxy, conversion uplift.

**MVP acceptance**
- Vendor can follow guided checklist and launch first campaign.

## 10) Academy training/workshops program

### Scope
- Learning center with courses, workshops, certifications.

### Backend
- `academy` module:
  - `course`, `lesson`, `workshop_event`, `attendance`, `certificate`.
- Webinar provider integration (Zoom/Jitsi) and recording links.

### Frontend
- Vendor learning portal + workshop calendar + progress tracking.

**MVP acceptance**
- Publish course, run workshop, issue completion certificate.

## 11) Custom farm website build included (service productization)

### Scope
- Productized professional services workflow.

### Backend
- `website-services` module:
  - `website_package`, `brief_form`, `milestone`, `handoff`.
- Intake-to-delivery pipeline with approvals.

### Frontend
- Vendor onboarding add-on selection + project status page.
- Admin project operations board.

**MVP acceptance**
- Website build request can be scoped, tracked, and delivered.

## 12) Promotional tools suite

### Scope
- Coupons, bundles, referral codes, seasonal campaigns, abandoned cart nudges.

### Backend
- Extend promotions domain with campaign orchestration and audience segments.
- Attribution fields for campaign performance.

### Frontend
- Vendor campaign builder (templates + scheduling).
- Analytics dashboard for promo performance.

**MVP acceptance**
- Merchant can launch and measure a promo campaign end-to-end.

## 13) E-books/webinars support resources

### Scope
- Resource library with gated downloads and webinar events.

### Backend
- `resources` module:
  - `resource_asset`, `resource_category`, `download_event`, `webinar_event`, `registration`.

### Frontend
- Public resource center + merchant-only downloadable library.
- Registration and reminder flow for webinars.

**MVP acceptance**
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

---

## Suggested Release Sequencing

## Activation Now (Week 0–2)
- Sprint A (launch-first onboarding)

## Release A (Weeks 1–6)
- POS MVP
- Weight pricing MVP
- Channel sync MVP

## Release B (Weeks 7–11)
- Pick-and-pack MVP
- Invoicing MVP
- Merchant support MVP
- Fraud monitoring MVP

## Release C (Weeks 12–18)
- Managed onboarding program
- Marketing guidance hub
- Academy/workshops
- Website build services workflow
- Promotional tools suite
- E-book/webinar resource center

---

## Resourcing (Suggested)

- **Backend**: 3 engineers
- **Frontend**: 2 engineers (vendor/admin/storefront)
- **Data/Platform**: 1 engineer
- **Design/Product**: 1 designer + 1 PM
- **Ops Enablement**: 1 support lead + 1 onboarding specialist (for process definition)

---

## Success Metrics

- POS share of orders and checkout time
- Inventory sync SLA attainment and error rate
- Pick/pack accuracy and fulfillment lead time
- Invoice payment cycle time / aging reduction
- Support first response and resolution SLAs
- Fraud chargeback rate and prevented loss
- Onboarding time-to-first-sale
- Training completion rates and merchant retention
- Promo campaign adoption and incremental GMV
