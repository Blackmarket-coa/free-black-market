# Roadmap

> **AI-first readiness process:** [Full-platform audit, repair and feature visibility plan](docs/FBM_AI_FIRST_AUDIT_AND_REPAIR_PLAN.md) defines how to verify every journey, finish small repairs, hide and preserve incomplete capabilities, and escalate only necessary human decisions. This plan has **not yet been executed**.

> **MVP scope (2026-11-03):** [FBM Resource Exchange MVP](docs/FBM_RESOURCE_EXCHANGE_MVP.md) defines the first-session journey, four target exchange primitives, regional pilot, privacy and legal gates, release criteria, and metrics. This is a proposed acceptance contract, **not a claim of deployed functionality**.

> **2026-11-03 decision update:** [FBM Resource Exchange Mission and Implementation Charter](docs/FBM_RESOURCE_EXCHANGE_CHARTER.md) is authoritative for FBM's shift to goal-first resource allocation and composable sale, barter, gift, pooled-buy, lending and cooperative tools. Fixed decisions: flat 3% commission after processing-fee deduction; **no subscriptions** (one-time software purchases and transparent at-cost hosted usage); E2EE never paywalled; national/international quest scope; AGPL-3.0 compatibility; Capacitor app wrappers using synced web checkout. **Any monthly plan, subscription entitlement, KARMA-based fee variation, ideological mode or state-only quest rule below is historical and superseded, not approved future pricing or behavior.** Existing code/deployment status has **not** been re-audited by this documentation change. Flag contradictions for audit; do not claim implementation or remove production billing without an approved migration.


Directional planning for the Free Black Market (FBM) cooperative marketplace
platform. This file is the index; the detail lives in three documents, each
canonical for its own scope:

| Scope | Canonical document |
| --- | --- |
| Product north star — buyer/seller value, repeat utility, trust principles, and sequencing | `docs/FBM_PRODUCT_STRATEGY.md` |
| --- | --- |
| Consolidation decisions (D1–D8), the W1–W6 workstreams, legal gates | `docs/REPO_CONSOLIDATION_REVIEW.md` |
| Commerce build priority — B2B and community pivot | `docs/COMMERCE_ROADMAP.md` |
| CDFI lending, co-op formation, farmers-market compliance, mutual aid, co-op delivery, time banking — the market-connections cluster reconciled against the code | `docs/CDFI_COOP_ROADMAP.md` |
| Commerce-operational feature specs (POS, weight pricing, pick/pack, invoicing) | `FEATURE_BUILD_PLAN.md` |

`docs/REPO_CONSOLIDATION_REVIEW.md` §2 recorded this file as "stale and
disconnected" and asked that its ordering be folded in at the next roadmap
revision. That revision is `docs/COMMERCE_ROADMAP.md` (2026-09-02), which
also reconciles the commerce backlog against the code.

## Near-term (0–3 months)

Execution should be guided by `docs/FBM_PRODUCT_STRATEGY.md`: prioritize immediate buyer/seller painkillers (delivered-cost clarity, trustworthy product/seller information, local and shipping comparisons, fast vendor activation, sharing, and useful activity summaries). This is a product-priority lens; the domain roadmaps below remain authoritative for verified technical gaps and release gates.

- **Make B2B transactable** — Tier 1 of `docs/COMMERCE_ROADMAP.md`: the
  priced quote object, net-terms enforcement (accounts receivable), and a
  buyer-facing dispute entry point for ordinary orders.
- **Turn the quest engine toward capital access** — Tier A of
  `docs/CDFI_COOP_ROADMAP.md`: extend the existing CDFI readiness quest (Q3)
  and certification tracker (Q8), add the refer-out partner directory that
  the quests link to, point co-op formation (Q11) at Blackout's founding
  document templates, and state the CSA and time-bank positioning honestly.
  Definition and content changes; no engine work.
- Vendor activation acceleration (Time to First Live Listing improvements).
- Validation automation rollout (`scripts/release_validation.sh`) on release
  branches.
- QA remediation and route-contract consistency for admin/vendor/storefront
  surfaces.
- Open-source readiness package (contribution templates, governance, funding
  metadata).
- Workstream A: vendor dashboard baseline delivery (product CRUD/publish
  flow, fulfillment selector, supplier attachment, inventory thresholds,
  sales reports + CSV export, and vendor/admin scope UAT).

## Mid-term (3–9 months)

- **Make B2B credible, then ship the sharing-economy layer** — Tiers 2 and 3
  of `docs/COMMERCE_ROADMAP.md`: B2B document types and expiry on
  `document-vault`, production capacity/lead time, batch/lot consolidation
  onto `production-ledger`, and storage / micro-depot / tool-lending
  listings.
- **Wire the solidarity-economy seams** — Tiers B and C of
  `docs/CDFI_COOP_ROADMAP.md`: the fiscal-sponsorship readiness quest on
  `fund-accounting`, the shared expiry/overdue reminder rail, mutual-aid
  asks on Grove storefronts and the FBM→Blackout mutual-aid events, then —
  once the recorded operator rulings land — the governing-document and
  certification vault types, time-bank ignition, and micro-depot listings.
- Core commerce operations from `FEATURE_BUILD_PLAN.md`: POS sessions and
  transactions, weight-based pricing rules, pick/pack batching and
  operational dashboards, invoicing and sync hardening.
- Integration reliability improvements (retry policies, idempotent
  workflows).
- Expanded E2E coverage for cross-module user journeys.

## Long-term (9+ months)

- **Community infrastructure and reach** — Tiers 4 and 5 of
  `docs/COMMERCE_ROADMAP.md`: garden coordination surfacing, seed library,
  market-day mode, then outbound channel adapters, barter adapters, and
  freight/customs/3PL when a real cross-border vendor exists.
- **Relay and external adapters** — Tier D of `docs/CDFI_COOP_ROADMAP.md`:
  a Blackstar depot node kind and relay through a depot, external time-bank
  and mutual-aid adapters, each only against a real counterpart with a
  working adapter.
- Deeper service layers (merchant support, training program delivery, managed
  onboarding).
- Risk and trust systems expansion (fraud analytics, policy automation).
- Governance and community economy feature depth.

## Not on the roadmap, deliberately

Recorded so they are not re-proposed. Each was decided in
`docs/REPO_CONSOLIDATION_REVIEW.md`; reversing one is an operator decision,
not a planning change.

- **TigerBeetle** — rejected (D1). `hawala-ledger` is the org-canonical
  ledger.
- **Federation protocol build** — gated on a second real marketplace (D3).
  The interface (connect.js, `/v1`, webhooks, signing) already ships.

**Blackstar was on this list and is no longer.** The D2 freeze was lifted by
operator decision on 2026-09-03; see `docs/REPO_CONSOLIDATION_REVIEW.md` §3.
FBM's fulfillment modules remain the live implementation — that half of D2
did not change — but Blackstar work is active again, starting with the
inbound bridge hardening in `docs/integrations/federated-logistics.md` §7–§9.
The integration stays dark by default until two deployments are paired.

`docs/CDFI_COOP_ROADMAP.md` §4 recommends three further exclusions — FBM-run
insurance pooling, FBM-run payroll, and any compensated lender or service
referral — as rulings for `docs/REPO_CONSOLIDATION_REVIEW.md` §8. They are
requests, not decisions, until an operator records them there.

## Gates

The standing legal gates are `docs/REPO_CONSOLIDATION_REVIEW.md` §8 — ACH
payouts disabled pending money-transmitter sign-off, Coalition
investing/revenue-share gated on Reg CF and CSA-style claim work, Coliseum
betting shelved. Money-touching work reads `docs/POSTURE_A_COMPLIANCE.md`
first.

## Delivery Operating System

- Project board and workflow baseline: `docs/PROJECT_OPERATING_SYSTEM.md`.
- Weekly cadence and KPI dashboard definitions are tracked in the same
  operating-system document.

## Success Signals

- Faster vendor activation and higher first-session publish rate.
- Stable CI with repeatable release validation gates.
- Low critical regression counts across release cycles.
- Healthy contributor pipeline and issue/PR throughput.
