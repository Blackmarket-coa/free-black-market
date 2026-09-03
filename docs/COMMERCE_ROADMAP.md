# Commerce Roadmap — B2B and community pivot

Status: **consolidated and code-verified, 2026-09-02. Tier 1 shipped.**

This document reconciles the current consolidated commerce direction (the
offering inventory plus the B2B/community pivot backlog) against what is
actually in `backend/src/modules/` and `backend/src/api/`. It supersedes the
directional ordering in the repo-root `ROADMAP.md`, which
`docs/REPO_CONSOLIDATION_REVIEW.md` §2 flagged as "stale and disconnected"
and asked to be folded in at the next roadmap revision. This is that
revision.

It does **not** supersede `docs/REPO_CONSOLIDATION_REVIEW.md`, which stays
canonical for consolidation decisions (D1–D8), the W1–W6 workstreams, and the
legal gates in its §8. Where this roadmap and that document could conflict,
that document wins and this one is wrong.

**The headline finding: the pivot backlog is much shorter than it looks.**
Of the fifteen capabilities listed as "needs to be implemented for the
B2B/community pivot", eleven already have a module — several of them among
the deepest in the repo — and two of the "hard gates before monetizing"
were retired by decisions already recorded in this repository. Building them
again would duplicate working code and, in two cases, reverse a standing
decision.

---

## 1. Corrections — the consolidated state against the code

Each row was checked against the tree at `c62f51d`. Rows are ordered by how
much the correction changes the plan.

| Claim in the consolidated state | What the code says | Consequence |
| --- | --- | --- |
| **TigerBeetle ledger correctness is a hard gate blocking Buyer Center and module-licensing monetization** | TigerBeetle was **rejected**, not deferred pending work: `REPO_CONSOLIDATION_REVIEW.md` D1 — "`hawala-ledger` is the org-canonical ledger… TigerBeetle stays rejected (PR #800)". The string appears in exactly two docs and **zero** source files. The Buyer Center escrow/idempotency defects it was said to gate were "closed before Move 1, guarded by blocking CI soak (PR #800)" (`FEDERATION_VS_FOUNDATION_DECISION.md` §182-185). | **Drop the gate.** Nothing is blocked on it. Ledger investment goes into `hawala-ledger` instead — the harvest items in `REPO_CONSOLIDATION_REVIEW.md` §5, of which 1–4 landed as W1a. |
| **Blackstar needs to be built out — mesh routing, reverse-auction bidding, batch claim aggregation, micro-depots** | D2: "Blackstar frozen; FBM fulfillment modules are the live implementation." What exists in FBM is a persistence + webhook layer: `modules/blackstar-fulfillment` (3 models, 2 migrations, signature verification, bridge-credential cipher, 4 unit specs) and `modules/blackstar-fulfillment-provider`, a stub provider behind `FBM_BLACKSTAR_INTEGRATION=1`. | **Superseded 2026-09-03 — the freeze was lifted.** The operator reversed D2; Blackstar is active work again (§1b). FBM's fulfillment modules remain the live implementation. Micro-depot listings are still reachable without the federated protocol — see §3. |
| **connect.js is scoped (three tiers, publishable key, two checkout modes)** | Shipped, versioned and frozen: `/v2.0.0/connect.js` went out SRI-pinned on 2026-08-13 (PRs #801–#803). `modules/embed-keys` issues `pk_live_*` (SHA-256 at rest, plaintext once), `modules/embed-analytics` records the funnel, and `shared/__tests__/connect-sri.unit.spec.ts` enforces release/template parity so a version bump cannot leave the pinned template behind. | Treat connect.js as a **shipped artifact under version discipline**, not a scoped design. New embed work is a v2.x change with a changelog entry (`docs/integrations/fbm-connect-changelog.md`). |
| **Bulk-buying cooperative orders are new** | The deepest cluster in the repo already: `demand-pool` (6 models, 5 migrations, ~3,430 LOC — demand posts, pledge thresholds, supplier proposals, proposal votes, bounties), `bargaining` (6 models — groups, negotiation threads, proposals, votes, with `payment_terms`/`quality_standards`), `cooperative`, `buyer-network`, `collective-campaign` (8 models), and the `collective-purchase` workflows. | **Wire, don't build.** The pivot's flagship B2B mechanic is largely done; what it lacks is a route from a group to a priced quote (§3). |
| **Community garden coordination likely lives in Coalition App or Blackout, not FBM** | It is already in FBM: `modules/garden` (5 models — gardens, plots, plot assignments, soil zones, memberships, plus a garden-ledger service) behind `/store/gardens`, with `modules/governance` (proposals, votes, delegation) and `/store/work-parties` alongside it. | **Do not relocate.** Coordination stays in FBM; only the spatial layer belongs elsewhere (D5 — Blackout is the single spatial home). |
| **Storage/space rental and equipment lending are new** | `modules/kitchen` already models spaces, station rentals, equipment with maintenance tracking, and memberships. `docs/manifests/tool-library.md` and `repair-cafe.md` are reference asset-graph manifests for exactly this. `modules/rental` exists but is a shell (2 models, ~102 LOC — date range and status, no pricing, no availability, no deposit). | **Generalize, don't start over.** The gap is `rental`'s depth, not the concept — see §3. |
| **Batch/lot tracking for manufacturing needs implementing** | Four overlapping implementations exist: `modules/agriculture` (Harvest, Lot, AvailabilityWindow + the `sync-lot-inventory` workflow), `harvest-batches` (best-by dates, reservations, scarcity levels), `production-ledger` (a deliberately generic `production_batch`), and `nursery-vertical`/`botanical` production runs. | **Consolidate, don't add a fifth.** `production-ledger` is the generic one and is the thinnest (~186 LOC); it is the natural target. |
| **Document verification/escrow for certifications needs implementing** | `modules/document-vault` (typed vendor uploads — lease, licence, insurance, credential — with an admin-driven `markVerified` audit stamp that is never auto-set) plus `modules/vendor-verification` (4 models, ~960 LOC) behind `/vendor/vault` and `/admin/vendor-verification`. | Exists; **thin but correct**. Only the B2B document types and expiry handling are missing. |
| **Dispute resolution workflow needs implementing** | `hawala-ledger/escrow-state-machine.ts` implements the full arbitration path (`funded → disputed → resolve_dispute_release / recover`) with unit tests, and dispute routes exist at `/v1/seller/services/contracts/[id]/dispute` and `.../subcontracts/[id]/dispute`. | The machine exists; the **buyer-facing entry point for ordinary orders** does not (§3). |
| **Contract/recurring-order management needs implementing** | `modules/subscription`, `modules/order-cycle` (10 models, ~2,518 LOC — cycle lifecycle, enterprise fees, share-box templates and subscriptions), and `modules/order-subcontract` (proposal, unit pricing, append-only event log). | Largely exists. Recurring B2B ordering is an `order-cycle` configuration question, not a build. |
| **Multi-marketplace sync across Etsy, Shopify, Amazon, Faire, eBay, Walmart — planned** | `modules/channel-connector` is real (per-seller connection, encrypted token, sync cursor, last-run report) but its catalog defines **one** channel: Faire. Inbound importers exist for WooCommerce and Odoo. | Six channels claimed, **one built**. Each additional channel is its own adapter — size the roadmap accordingly. |
| **Buyer Center has barter adapters (Craigslist RSS, TrashNothing, hOurworld)** | `modules/barter` is a single `barter_proposal` model (~484 LOC across the module) with **no external adapters**. `docs/FBM_BUYER_HUB.md` §1 says so directly: "barter-search — Does not exist… Phase 6 is greenfield, not a wiring job." | The one genuinely greenfield item in the demand-side cluster. |
| **70–85% commission split by KARMA tier, and a flat 3% commission** | These are two different economics, and the code implements the second: all eleven playbook recipes set `commission_rate: 0.03` (`modules/playbook/recipes/*.ts`). `docs/ADDON_COMMITMENTS.md` §3 commits that "the commission never creeps upward". | The 70–85% split is superseded legacy-archetype framing. **Use flat 3%** in any external positioning. |
| **1099-B exposure review; legal review of KARMA-linked pricing rebase** | Neither appears in the canonical gate list. `REPO_CONSOLIDATION_REVIEW.md` §8 records exactly three standing gates: Coliseum betting shelved, ACH payouts disabled pending money-transmitter sign-off, and Coalition investing / revenue-share gated on Reg CF and CSA-style claim analysis. | Either **add these to §8 deliberately** or drop them. An unrecorded gate blocks nothing and is invisible to everyone who reads the canonical list. |
| **RFQ/quote system needs implementing** | Partly there: `modules/request` is a generic RFQ shell (`type`, `data` JSON, submitter/reviewer, `pending → accepted/rejected/completed/cancelled`) already backing seller registration; `bargaining` carries negotiation threads and priced proposals; `demand-pool` has `supplier-proposal` with `payment_terms`. | **Real gap, narrower than stated** — see §3.1. |
| **Net-terms invoicing (net-30/60) needs implementing** | Half-modelled: `vendor_customer_tier.payment_terms_days` exists (`modules/vendor-rules`), is defaulted to 30 in the wholesale seed path (`service.ts:328`), and is echoed on approval (`api/admin/wholesale-application/[id]/approve/route.ts:83`). But `/vendor/invoices` is a thin lifecycle record (`draft → sent → paid → void`) stored through seller metadata, and **nothing reads `payment_terms_days`** to derive a due date. | **Real gap, and the sharpest one** — terms are declared and never enforced. See §3.2. |

One partial correction found along the way, outside this roadmap's scope but
worth recording: `docs/GIFT_ECONOMY_REUSE_MAP.md` says CCR "can be minted and
burned, but not spent". Commit `1af77af` has since landed the cart
**reservation** lifecycle (`lib/ccr-cart-ledger.ts`, `lib/ccr-checkout.ts`,
`/store/carts/[id]/credits`, and the `validate-ccr-reservation` hook), so the
`CART` purchase context finally has a writer — but the conclusion still
stands: credits are tender, the tender half is unbuilt, cart completion is
deliberately bolted shut against any cart holding a reservation, and the
surface is dark behind `FBM_CCR_CHECKOUT_LIVE`. A dated note recording both
halves has been added to that document.

---

### 1a. The commission rule, as of 2026-09-02

**Commission is for native sales.** FBM's 3% applies to any sale that went
through FBM checkout — storefront, `connect.js` embed, POS, vending, pickup,
subscription renewal. It does not apply to an order captured by an external
marketplace and ingested here: that marketplace priced it, took its own cut
(`FeeType.CHANNEL_FEE`), and FBM ran no checkout for it.

This was already true structurally — `channel_order` rows are never converted
into Medusa orders, so they never reach the payout path — and is now stated in
`modules/payout-breakdown/commission-scope.ts`, which throws rather than
returning zero if a caller asks for commission on a non-native sale. Recorded
in `docs/ADDON_COMMITMENTS.md` §3a.

The flat 3% is unchanged and unchanged-able upward (§3 of the same document);
all eleven playbook recipes set `commission_rate: 0.03`.

---

### 1b. Blackstar, unfrozen 2026-09-03

D2 froze Blackstar and made FBM's own fulfillment modules the live
implementation. The operator lifted that freeze on 2026-09-03. The
absorption half of D2 is unchanged — FBM's modules stay the live
implementation — but Blackstar is an active line of work again, and the
plan to archive the repo is withdrawn.

What the freeze had obscured: the FBM↔Blackstar bridge was **far more built
than this roadmap's §1 row credited**. Contract v1 is fully specified in
`docs/integrations/federated-logistics.md` — signed webhooks both
directions, per-partner machine credentials with overlap rotation, an
outbound retry queue, a receiver, and a fulfillment provider. Calling it a
"persistence + webhook layer" undersold it.

What the freeze did leave broken, and what unfreezing fixed first:

- **Out-of-order events corrupted shipment state.** The bridge is
  at-least-once with no ordering guarantee, and the receiver applied
  last-writer-wins, so a delayed `in_transit` retry landing after
  `delivered` would report a delivered parcel as still travelling. The
  contract acknowledged this and pushed it onto "downstream consumers".
  Now guarded in `shipment-lifecycle.ts` (contract §8).
- **No replay dedupe.** Contract §9.4 was open. `blackstar_event_receipt`
  closes it, keyed on the stable outbound `event_id` that §9.2 made
  available.

Still open and genuinely bilateral: per-shipment sequence numbers
(contract §9.3) are a wire-format change needing the Laravel side too.

The integration remains dark by default (`FBM_BLACKSTAR_INTEGRATION=0`).
Unfreezing the decision is not the same act as enabling it in production,
which needs paired secrets per contract §4.

---

## 2. What the pivot already stands on

For planning, the B2B and community substrate that exists today:

- **Negotiated demand** — `demand-pool`, `bargaining`, `buyer-network`,
  `cooperative`, `collective-campaign`, `wishlist`.
- **Recurring and cyclical supply** — `order-cycle` (CSA/food-hub cycles,
  share boxes, enterprise fees), `subscription`, `season`.
- **Production and lot provenance** — `agriculture`, `harvest-batches`,
  `production-ledger`, `botanical`, `nursery-vertical`.
- **Trust** — `vendor-verification`, `document-vault`, `reviews`, and
  `karma_event` as the canonical reputation write path (D7/W4).
- **Money** — `hawala-ledger` (double-entry, escrow with arbitration,
  settlement batches, external reconciliation, balance monitors, lineage,
  point-in-time balances), `payout-breakdown`, `vendor-billing`.
- **Distribution** — `delivery`, `local-delivery-fulfillment`,
  `food-distribution`, `printful-fulfillment`, `blackstar-fulfillment`
  (frozen bridge).
- **Community, non-commerce** — `garden`, `kitchen`, `governance`,
  `mutual-aid`, `volunteer`, `harvest`, `knowledge-base`.
- **Embed and channels** — `connect.js` v2.0.0, `embed-keys`,
  `embed-analytics`, `channel-connector` (Faire), `woocommerce-import`,
  `odoo-import`.

---

## 3. The verified gaps

These are what survived the audit. Everything else in the pivot backlog is a
wiring, configuration, or consolidation task against §2.

### 3.1 Priced quote object (RFQ → quote → order) — **CLOSED 2026-09-02**

Shipped as `modules/quote` (`071d368`). A quote carries priced lines against
real variants with a `list_unit_price` snapshot, a `valid_until`, and a
draft/sent/accepted/declined/withdrawn/expired lifecycle. Acceptance builds a
real cart and overrides each line's `unit_price` with `is_custom_price`,
following `api/store/carts/[id]/wholesale`, so checkout, payouts, the 3% on
native sales and AR all behave normally afterwards. `request_id` links a quote
back to the RFQ it answers rather than adding a second approval model.

Surfaces: `/vendor/quotes` (+`/[id]`), `/store/quotes` (+`/[id]`,
`/[id]/accept`), job `quote-expiry`.

### 3.2 Net-terms enforcement (accounts receivable) — **CLOSED 2026-09-02**

Shipped as `modules/accounts-receivable` (`502d336`). `payment_terms_days` is
now read at issue, copied onto the invoice, and turned into a real `due_at`
that aging and dunning key off. Invoices moved off the
`seller_metadata.invoices_v1` blob onto `ar_invoice` + `ar_invoice_payment`
(idempotent, backfilled by `scripts/backfill-ar-invoices.ts`, blob left in
place). `overdue` and `partially_paid` are derived rather than stored; a
credit ceiling was added to `vendor_customer_tier` (`credit_limit_cents`,
nullable — no-limit and no-credit are different promises).

Surfaces: `/vendor/invoices` (+`/[id]`, `/[id]/payments`, `/aging`), job
`ar-dunning-sweep`.

### 3.3 Buyer-facing dispute entry for ordinary orders — **CLOSED 2026-09-02**

Shipped as `modules/order-dispute` (`cbe99e6`). A buyer can raise a claim
against an ordinary order within a 60-day window; the vendor can answer; an
admin works a queue and decides. No new arbitration engine — it records the
decision and names the escrow transition it implies, returning null for the
ordinary un-escrowed order rather than fabricating one. One live dispute per
order; only an admin resolves.

Surfaces: `/store/orders/[id]/dispute`, `/vendor/disputes` (+`/[id]`),
`/admin/disputes` (+`/[id]`).

### 3.4 `rental` module depth

Carrying storage, cold storage, micro-depot and tool-library listings needs
pricing, an availability calendar, deposits and damage handling on
`modules/rental` — roughly what `kitchen` already does for spaces and
equipment. Generalising `kitchen`'s model is the cheaper path than growing
`rental` independently; decide which is the survivor before building.

### 3.5 Production capacity and lead time on ordinary products

`booking` honours lead time for appointments and `agriculture` models
availability windows for lots, but an ordinary product has no production
lead time or capacity ceiling — the thing a manufacturing buyer needs to see
before committing to a quantity.

### 3.6 Outbound channel adapters beyond Faire

Five of the six named channels are unbuilt. Note the locked decision recorded
in `modules/channel-connector/catalog.ts`: **hybrid** — native adapters for
the wedge channels, an aggregator behind a single adapter for the long tail.
So this is not five bespoke adapters; it is a wedge decision (which channels
earn a native adapter) plus one aggregator integration. The same file records
why the catalogue lists only Faire: "a catalogue entry for a channel with no
adapter would show a vendor a connect button that cannot work." Keep that
rule — extend the catalogue only alongside a working adapter.

### 3.7 Barter external adapters

Craigslist RSS, TrashNothing and hOurworld are greenfield, as
`docs/FBM_BUYER_HUB.md` states. `barter_proposal` is the internal half.

### 3.8 Seed library / seed swap

The thinnest item: no module. The substrate is `barter_proposal` plus
`garden` plus `knowledge-base`. Genuinely small if built on those, and
genuinely absent today.

### 3.9 Market-day mode

Partly reachable now — `season`, `venues`, `ticket-booking` and
`order-cycle`'s dispatch lifecycle cover most of it. What is missing is a
time-boxed vendor inventory tied to a physical event. Scope this against
`order-cycle` before treating it as new.

### 3.10 Freight documentation, customs, 3PL

Untouched, and correctly deferred: it is only reachable once cross-border or
non-self-fulfilling vendors actually exist. No design work yet.

---

## 4. Build priority

Ordered by dependency and by how much each unblocks. Each tier is
independently shippable.

**Tier 1 — make B2B transactable. ✅ DONE 2026-09-02.**
1. ~~**Priced quote object**~~ (§3.1) — `modules/quote`, `071d368`.
2. ~~**Net-terms enforcement**~~ (§3.2) — `modules/accounts-receivable`,
   `502d336`.
3. ~~**Buyer-facing dispute entry**~~ (§3.3) — `modules/order-dispute`,
   `cbe99e6`.

Alongside them, the commission rule was made explicit rather than
structural: **commission is for native sales** — anything through FBM
checkout, nothing on an order another marketplace captured and already took
its cut from (`commission-scope.ts`, `f573f53`). That was already true by
construction, since channel orders never become Medusa orders; it is now a
rule that throws instead of an accident that holds. The same change fixed a
real defect — FBM's own line on `/vendor/revenue/channels` reported its fee as
*unknown*, so the one take rate we could always state was the only one the
screen withheld.

**Tier 2 is now the front of the queue.**

**Tier 2 — make B2B credible.**
4. **B2B document types and expiry** on `document-vault` — certificates of
   insurance, licences, organic/regenerative certs, with expiry reminders.
   Small; `markVerified` and the audit stamp already exist.
5. **Production capacity and lead time** (§3.5).
6. **Batch/lot consolidation** onto `production-ledger` (§1) — pay this down
   before a fifth implementation appears.

**Tier 3 — the sharing-economy layer.**
7. **Resolve `rental` vs. `kitchen`** and build the survivor out (§3.4).
8. **Storage, cold storage and micro-depot listings** on that survivor. This
   is how micro-depots ship without unfreezing Blackstar.
9. **Tool/equipment lending**, against `docs/manifests/tool-library.md`.

**Tier 4 — community infrastructure (non-commerce).**
10. **Garden coordination surfacing** — the module exists; plot allocation,
    shared tool access and harvest-sharing need the front-end and the
    `governance` wiring, not a backend build.
11. **Seed library** (§3.8) on `barter_proposal` + `garden`.
12. **Market-day mode** (§3.9), scoped against `order-cycle` first.

**Tier 5 — reach.**
13. **Channel adapters** (§3.6), one at a time, demand-ordered.
14. **Barter external adapters** (§3.7).
15. **Freight/customs/3PL** (§3.10) — only when a real cross-border vendor
    exists.

**Not on this roadmap, deliberately:** TigerBeetle (rejected, D1) and
federation protocol work (gated on a second real marketplace, D3). The
Blackstar freeze was lifted on 2026-09-03 and is no longer an exclusion —
see §1b.

---

## 5. Gates

The standing gates are `REPO_CONSOLIDATION_REVIEW.md` §8, restated here
because Tier 1 and Tier 3 both run close to them:

- **ACH payouts stay disabled** until the money-transmitter/compliance
  sign-off recorded in `PRE_LAUNCH_AUDIT.md` §5-C. Net terms (§3.2) is an AR
  question and does not require ACH — keep the two separate so the gate does
  not swallow Tier 1.
- **Coalition investing and revenue-share subscriptions**: modelling may
  proceed, no cash-in/cash-out path ships before the Reg CF and CSA-style
  claim work completes.
- **Coliseum betting stays shelved.**

Anything money-touching also reads `docs/POSTURE_A_COMPLIANCE.md` first.

Two gates named in the consolidated state are **not** in the canonical list —
1099-B exposure and legal review of a KARMA-linked pricing rebase. They are
recorded here so the discrepancy is visible; adding them is an operator
decision on §8, not something this roadmap can do on its own. Until they are
in §8, no one reading the canonical gate list will honour them.

---

## 6. Maintenance

- When a gap in §3 closes, move it to §2 and cite the module.
- When a claim here is contradicted by code, the code wins — correct this
  document rather than working around it.
- Module inventory lives in `docs/MODULE_CATALOG.md`; add a row there when a
  roadmap item ships a module.
- Consolidation decisions and W-workstreams stay in
  `docs/REPO_CONSOLIDATION_REVIEW.md`.
