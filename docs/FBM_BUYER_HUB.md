# FBM Buyer Hub — Product Specification

## Purpose

Extend the existing demand-side cluster into a standalone cross-platform hub for buyers,
mutual aid participants, and demand-driven commerce: one place to post a buy order, launch
or join a group buy, request mutual aid, post a bounty for something hard to find, or
browse recurring order cycles from trusted vendors.

This is the demand-side mirror of the vendor hub: same two-surface principle (a hosted hub
experience plus an embeddable widget), same shared entitlement/identity backbone, same
cooperative-economics constraint — transparent, never extractive.

> **Unmet dependency.** The source brief cross-references
> `fbm-vendor-hub-creation-prompt.md` as the definition of the shared
> entitlement/identity/progression contract. **That document does not exist** in this
> repository or in its history. This spec is therefore written self-contained, against the
> infrastructure that demonstrably exists (§3). If the vendor-hub document is later
> written, reconcile §3 against it rather than assuming agreement.

---

## 1. Module reality check

The source brief names five modules as the "existing Buyer Center cluster". **None of them
exist under those names.** The table below maps intent onto real code. Use the right-hand
column; the left-hand column appears only so the brief can be read against this document.

| Named in brief | Actual home | Notes |
|---|---|---|
| `buyer-request` | `modules/demand-pool` (`models/demand-post.ts`), `modules/request` | `demand_post` is the buy order. `request` is a generic RFQ model. |
| `group-buy` | `modules/demand-pool` (`models/demand-participant.ts`) | Threshold mechanic already modelled: `target_quantity`, `min_quantity`, `committed_quantity`. |
| `demand-aggregation` | `modules/demand-pool` | Same module — this is the aggregation engine. |
| `vendor-acquisition` | `modules/demand-pool` (`models/supplier-proposal.ts`, `models/proposal-vote.ts`) | Plus `attractiveness_score` on `demand_post` for supplier discovery. |
| `barter-search` | **Does not exist** | No barter module, and no TrashNothing/hOurworld adapters. Phase 6 is greenfield, not a wiring job. |

Adjacent modules the hub composes with: `order-cycle` (recurring cycles, share boxes),
`buyer-network`, `wishlist`, `bargaining`, `cooperative`, `donation`, `volunteer`.
Reputation substrate: `progression` (XP events, character sheet, KARMA tiers),
`vendor-quest`, `collective-quest`.

---

## 2. Phase 0 — the release gate

The brief treats Phase 0 as a hard gate: no bounty, group-buy pledge, or mutual-aid fund
routing ships against unremediated escrow/idempotency/balance code. That framing stands.
Its factual premises did not.

### 2.1 Already remediated before this work

`ECONOMIC_REVIEW.md` documents three defects the brief cites as open. Its own Remediation
Status table marks all three **Fixed**, and each was confirmed in source:

| ID | Defect | Where it landed |
|---|---|---|
| B4 | Non-deterministic bounty/dividend idempotency keys | `services/collective-hawala.ts` — `bounty-payout-${bounty_id}-m${milestone_index}` |
| H1 | Non-atomic `updateBalances` | `modules/hawala-ledger/service.ts` — `updateBalancesAtomic` CAS path |
| B2 / B5 | Unauthenticated, racy milestone completion | Creator-authorized route + `jsonb_set` CAS in `modules/demand-pool/service.ts` |

`ECONOMIC_REVIEW.md`'s line references are stale — it cites `service.ts:611-671` for
`updateBalances`, which now lives at 1117–1179.

### 2.2 Closed by this change

Two classes of live defect sat inside Phase 0's stated scope and were not covered by that
review.

**Cross-pool bounty IDOR (High — "IDOR on financial endpoints" per `SECURITY.md`).**
The `[id]` pool segment was not enforced anywhere under `bounties/[bountyId]/`. The
milestone route authorized that the caller created pool `:id`, then passed `bountyId`
through unchecked; the claim route destructured `id` and never used it. Because the
milestone completion is a committed atomic UPDATE that runs *before* the ledger transfer
and cannot share a transaction with it, a payout failure left the completion behind — an
inflated `amount_paid_out` with no money moved, which also stranded the escrowed remainder
(`refundBountyEscrow` only returns `amount - amount_paid_out`).

Fixed in three layers:
1. Pool-scoped lookups pushed **into the service layer** (`completeBountyMilestone`,
   `claimBounty` now require `demandPostId`), so a future caller cannot reintroduce it;
   the atomic UPDATE carries `AND demand_post_id = ?`.
2. `completeAndPayMilestone` verifies every payout precondition — bounty belongs to this
   pool, has an assignee, and both ledger legs resolve — **before** the irreversible
   completion. A cross-service transaction is not available here, so ordering is the
   mechanism.
3. Declared `authenticate()` matchers for the milestones and claim paths in
   `api/store/collective/middlewares.ts`, which previously relied on the handler's
   `auth_context` read alone.

**Non-deterministic idempotency keys on seven money paths.** The same anti-pattern as B4,
outside the paths the review examined. Worst on deposit and withdraw, which hand the key to
**Stripe before** writing to the ledger — so a retry moved real money at the bank before
reaching the `idempotency_key TEXT UNIQUE` constraint that would have rejected it.

| Site | Was |
|---|---|
| `api/store/hawala/deposit/route.ts` | `deposit-${customerId}-${Date.now()}` |
| `api/store/hawala/withdraw/route.ts` | `withdraw-${customerId}-${Date.now()}` |
| `api/store/hawala/investments/route.ts` | `invest-…-${Date.now()}` |
| `api/vendor/hawala/pools/[id]/withdraw/route.ts` | `pool-withdraw-${id}-${randomUUID()}` |
| `api/vendor/creator/credits/withdraw/route.ts` | `cwr_${randomUUID()}`, despite a comment claiming stability |
| `api/admin/hawala/transfers/route.ts` | `manual-${Date.now()}` |
| `modules/hawala-ledger/service.ts` (`processRefund`) | `refund-${order_id}-${Date.now()}` — defeated the duplicate check three lines below it |

All now route through `shared/request-idempotency.ts`, which prefers the client's
`Idempotency-Key` header (following the precedent in
`api/store/vendor-hype/markets/[id]/positions/route.ts`), then a body key, then a key
derived from actor + scope + payload + a coarse time bucket. The derived path is a
transitional safety net for callers predating the header, not the intended route: it
collapses a fast retry while leaving a deliberate identical repeat in a later bucket free
to proceed. `storefront/src/lib/hooks/useHawalaWallet.ts` now sends the header.

### 2.3 Balance-path hardening

The remaining Phase 0 items, closed after the two above.

- **`updateBalancesAtomic` now guards `available_balance` as well as `balance`.** The two
  move in lockstep today, so the added predicate is currently equivalent — but
  `available_balance` is modelled as `balance - pending` and `createTransfer`'s own
  pre-check reads it. Guarding only `balance` meant that the moment anything began
  reserving funds, the CAS would spend a reservation the pre-check had just rejected.
- **One-sided moves are compensated.** Both fallback paths issue two independent
  statements, so a credit failure after a successful debit left money debited and never
  credited, with no transaction to roll it back. `applyBalancePairWithCompensation` now
  reverses the debit; if the reversal also fails, the imbalance is logged at error with
  both account ids for `hawala-balance-reconciler` to catch, rather than swallowed.
- **`claimBounty` is decided by a DB-atomic
  `UPDATE … SET assignee_id = ? WHERE assignee_id IS NULL`.** The prior read-check-write
  let two simultaneous claimants both pass the read, with the later writer silently
  overwriting the earlier claimant — so the bounty paid out to the wrong person.
- **`shared/idempotency-store.ts` reports `degraded: true`** when the shared store is
  unreachable and it falls back to a per-process Map. That fallback is a real guard for one
  instance and none at all across a multi-instance deploy; it now says so instead of
  silently implying the check held. A genuinely shared store is an infrastructure decision,
  not a code one — this makes the gap observable.

The legacy read-modify-write `updateBalances` still carries H1's TOCTOU, and is retained
deliberately as the last-resort path when no pg connection resolves at all (unit tests,
misconfiguration). It is now wrapped in compensation, but it is not a CAS. Treat any
deployment that actually reaches it as misconfigured.

**Not provable by unit tests:** true concurrent-write behaviour of the CAS predicates and
the atomic claim needs a live Postgres. `concurrency-soak.integration.spec.ts` is the
harness for it; that job runs in CI (`test-soak`), not locally.

---

## 3. Shared backbone (exists — confirm, do not rebuild)

- **Identity.** `lib/blackout-identity.ts` resolves `mxid` (Matrix ID) and
  `blackout_user_id` (OAuth `sub`) separately, and is emphatic that the two must never be
  conflated — emit points skip rather than put an mxid in a `userId` slot.
- **Entitlements.** `modules/entitlement` keys a grantee by `customer_id`,
  `customer_external_id` (**this carries the mxid**), or `seller_id`.
  `shared/seller-plan.ts` unions plan features with directly-held entitlements.
- **Two-surface delivery.** `storefront/public/connect.js` (vanilla IIFE, `data-fbm-*`
  configuration, capability gating via `CAP_FOR_KIND`, PublishableKey auth for write
  actions) plus the hosted "Launch" mode. Spec: `docs/integrations/fbm-connect.md`.
  A buyer-hub surface should be added as a new `data-fbm` kind, not a parallel script.
- **Progression.** `xp_event` carries `source_module`/`source_id`; `character_sheet`
  aggregates across every source. Stances: producer, consumer, investor, coalition,
  creator.

---

## 4. Phases

**Phase 0 — remediation.** See §2. Gate, not a sequential step.

**Phase 1 — foundational plumbing.** Shared identity/entitlement backbone (§3 — exists).

*Two-surface delivery is now in place.* The hosted surface already existed at
`(main)/collective/demand-pools/{,new,[id]}`; the embeddable one is a new
`data-fbm="demand-pools"` kind in `storefront/public/connect.js`, added as a kind rather
than a parallel script so it inherits the existing config, theming, styles and analytics.

One structural difference worth recording: **this is the first vendorless surface.** Every
other kind resolves through `getData(handle)` → `GET /store/vendors/:handle` and rejects
without a configured vendor. Demand is posted by buyers, so requiring `data-fbm-vendor`
would make the buyer hub un-embeddable on any site that is not already a storefront —
which is most of the sites that would want it. It therefore reads the public
`GET /store/collective/demand-pools` (which already existed, filtered to PUBLIC +
OPEN/THRESHOLD_MET), and `autoMount` skips the capability probe for kinds in
`VENDORLESS_KINDS`. It has no `CAP_FOR_KIND` entry because there is no vendor whose
capability could gate it.

connect.js had no test coverage at all — it ships from `public/`, outside vitest's `src/**`
include. `storefront/src/lib/__tests__/connect-demand-pools.spec.ts` evaluates the asset in
a `vm` with a minimal DOM stub rather than restructuring a shipped file to make it
importable. It pins the query construction, the divide-by-zero and overshoot cases in the
progress bar, the empty and failure states, and — most importantly — that buyer-supplied
pool titles are escaped before reaching `innerHTML`, since that is the only untrusted
string on the surface.

*The generic non-FBM buyer archetype is now in place*, as
`modules/demand-pool/buyer-archetype.ts`. It mirrors `product-archetype` — a behavioural
category supplying defaults, with anything stated explicitly winning over them — and
follows `vendor-plan/catalog.ts` in keeping code as the source of truth.

Codes: `GENERAL`, `HOUSEHOLD`, `BUYING_CLUB`, `ORGANIZATION`, `MUTUAL_AID`. Each supplies a
deadline window, `deadline_type`, `visibility`, a `min_quantity` threshold ratio, and a
unit of measure. `min_quantity` is consequently now optional on `POST
/store/collective/demand-pools` — posting a want should not require a number the buyer has
no basis to pick.

`GENERAL` is the point of the set and the fallback for anything unrecognised: posting a
want must work with no cooperative, no buyer network, no vertical, and no other
FBM-specific concept, or the hub cannot be used outside FBM — which is the premise of it
being a standalone product. Every other archetype is an opt-in refinement, never a
prerequisite.

Deliberately **not persisted**. These are creation-time defaults, not state on the post: a
stored archetype would drift from the values it produced the moment the catalog changed,
and nothing reads it afterwards. A per-buyer stored assignment (à la
`product_archetype_assignment`) is the natural follow-up if archetypes ever need
overriding per account.

**Phase 2 — reputation unification.** Trust earned as a bounty filler, mutual aid helper,
or group-buy organizer must be one score, not three. The buyer side previously awarded **no
XP at all** while nine other `source_module`s did. Two of the three modes now emit, both
onto the same character sheet:

| Mode | Event | Subscriber | Award |
|---|---|---|---|
| Bounty fill | `bounty.milestone_settled` | `progression-bounty-settled.ts` | COALITION, or CREATOR for creator-facing objectives; 1 XP per unit settled |
| Group buy | `demand_pool.fulfilled` | `progression-demand-pool-fulfilled.ts` | COALITION to the organizer, CONSUMER to each committed participant |

Two design choices worth recording:

- **Group-buy XP fires on fulfillment, not on join.** Joining is free and reversible —
  there is a withdraw endpoint — so join-time XP would be farmable by joining and leaving
  repeatedly. Fulfillment is operator-confirmed, so it reflects cooperation that actually
  happened.
- **Group-buy awards are flat, not proportional to order value.** The signal is "did you
  follow through", not "how much did you spend" — proportional awards would let a large
  pool simply out-earn a small one, which is the opposite of a cooperative trust score.

`source_id` is scoped per milestone, and per pool-and-role, so a redelivered event cannot
double-count — matching the partial unique index on `(source_module, source_id)` from H6.
Sellers are skipped throughout; they progress through the Quest Engine.

**All three modes now emit**, since Phase 5 landed the `mutual-aid` module:
`mutual_aid.fulfilled` → `progression-mutual-aid-fulfilled.ts` → COALITION XP, the same
track as the other two. "Reputation carries across modes" is now literally true rather than
aspirational.

**Phase 3 — buy orders and bounties.** Largely present before this work: storefront pages
at `(main)/collective/demand-pools/{,new,[id]}`, and the escrow-backed bounty flow in
`demand-pool` + `services/collective-hawala.ts`.

*The vendor-acquisition hook is now closed.* Previously, expiry was a dead end in the
literal sense: `getSupplierOpportunities` only lists OPEN/THRESHOLD_MET pools, so the
moment a pool expired it dropped out of every supplier view and the demand signal was lost
entirely. Two additions:

- `demand-pool-expiry` emits `demand_pool.expired_unfulfilled` carrying the demand signal
  (category, region, committed vs target quantity, bounty amount). The emitter is injected
  into `expireOverduePools` rather than resolved inside it, so that helper stays
  container-free and unit-testable, and a failed emit cannot turn a completed
  refund-and-expire into a reported failure.
- `getUnfulfilledDemandLeads` + `GET /vendor/collective/demand-leads` surface that demand
  to prospective suppliers, filtered by category and region, ranked by attractiveness, and
  excluding pools the supplier already proposed to.

Kept deliberately separate from `/vendor/collective/demand-pools`: those are live pools a
supplier can still bid on, these are historical and cannot be bid on. Merging them would
fill an actionable feed with dead rows. EXPIRED only — a CANCELLED pool was withdrawn by
its creator and says nothing about whether the market could have been served.

**Phase 4 — group buying and order cycles.** Threshold unlock already exists on
`demand-pool` (`min_quantity` / `committed_quantity`, auto-transition to `THRESHOLD_MET` in
`joinDemandPool`), and buyer archetypes now supply the ratio.

*`order-cycle` is now wired as the recurring alternative.* A group buy dissolves once it
completes, so recurring demand re-forms from nothing every time — buyers re-post,
re-commit, and re-find a supplier for something that was always going to repeat. An order
cycle is the durable version of that relationship: a coordinator's repeating ordering
window. `demand_post.order_cycle_id` is the join, set through
`POST /vendor/collective/demand-pools/:id/order-cycle`.

Two ownership checks, because two different things could be captured:

- **The demand pool** — only its `selected_supplier_id` may hand it over. Any seller being
  able to attach a cycle would let them capture a buyer group they had no part in winning,
  overriding what the pool's proposal vote decided.
- **The order cycle** — only its `coordinator_seller_id` may attach it, or a seller could
  point someone else's buyers at a window they do not run.

The cross-module check lives in the route rather than in either service: `demand-pool` and
`order-cycle` stay independent of one another, and the route is where they compose.

*Surplus disposition is built.* A participant can choose what happens to their pledge if
the pool does not complete: a plain refund, or a redirect to mutual aid. The guardrail
(§5) constrains the implementation rather than just the UI:

- `REFUND` is the column default and what every existing row holds. Nothing infers
  `DONATE` — not an archetype, not a pool setting, not a previous choice on another pool.
- The only writer is `setSurplusDisposition`, reached through
  `PUT /store/collective/demand-pools/:id/surplus-disposition`, which the participant calls
  for themselves. There is deliberately no creator or admin equivalent: an endpoint someone
  else could call on a buyer's behalf would defeat "opt-in" however the UI was written.
- Reversible until the escrow actually moves; rejected once the participant is `REFUNDED`,
  because the money is gone and pretending otherwise would be a lie rather than a courtesy.

**The money-moving half is dark**, behind `FBM_SURPLUS_REDIRECT_LIVE`, following the
`creator-credits.ts` / `campaign-escrow.ts` pattern. Two reasons, both real:

1. Under Posture A, donations route through a 501(c)(3) fiscal sponsor and FBM does not
   hold the donor-recipient relationship (`modules/donation/models/donation-settings.ts`,
   `docs/POSTURE_A_COMPLIANCE.md`). Paying redirected pledges into a platform account —
   the obvious shortcut — is the exact arrangement that posture exists to avoid.
2. §5 requires legal/compliance sign-off before real-money mutual aid routing in any
   jurisdiction with money-transmission licensing.

So the flag alone cannot switch it on: `FBM_MUTUAL_AID_ACCOUNT_ID` must also name a
destination, and `requireMutualAidAccountId()` throws rather than falling back to anything
if it is unset. With the flag off, a `DONATE` intent is recorded and reported back to the
caller, but the escrow still returns to the buyer — the safe direction to fail in, and the
API response says so plainly rather than implying the donation happened.

**Phase 5 — mutual aid.** The native half is built; the inbound half is blocked, and that
split is deliberate.

*Built:* a `mutual-aid` module with requests and offers, geographic matching, and
`/store/mutual-aid/*` routes. Confirming fulfilment emits `mutual_aid.fulfilled`, and
`subscribers/progression-mutual-aid-fulfilled.ts` awards COALITION XP — **which completes
Phase 2**. All three modes (bounty fill, group buy, mutual aid) now land on one character
sheet, which until now described two.

Three constraints shaped it:

- **Location is split.** `latitude`/`longitude` are precise enough to route a delivery and
  describe where a person in need actually is. `locality` is a coarse label, and it is the
  only thing public listings show. `lib/aid-location.ts` does the narrowing, and it is
  **whitelist-only** — a projection that deleted known-bad fields would start leaking the
  day someone added a column. Distances are reported as bands, never exact figures:
  enough exact distances from known points and a household can be trilaterated.
- **Only the requester confirms fulfilment.** A helper marking their own good deed
  complete is the self-attestation that makes a reputation score worthless, and this feeds
  XP directly.
- **Matching is a guarded first-come claim** (`status = 'OPEN'` predicate). Someone waiting
  on aid who is told twice that help is coming, and then receives none, is worse off than
  someone never matched at all.

XP is flat — not scaled by urgency or quantity. Paying more for `URGENT` would create a
reason to overstate urgency on a board read by people in need, and paying by size would
rank a large donation above showing up.

*Not built, and not buildable here:* inbound aggregation from Mutual Aid Hub and
rubyforgood/mutual-aid. §5 requires an actual consent and data-sharing agreement, so this
is a conversation to have, not code to write. It is also the piece that solves the per-city
cold-start problem, so the native board above will feel empty until either that agreement
exists or a community seeds it directly.

*Also worth flagging:* the brief says to reuse "Coalition's mutual-aid heatmap/scroll
design work already done for Blackout." **No MapLibre, heatmap, or map UI of any kind
exists in this repository** — like `fbm-vendor-hub-creation-prompt.md`, that work lives
somewhere this repo cannot see. The module exposes coarse localities and distance bands,
which is what a heatmap would need; the map itself remains unbuilt.

**Phase 6 — barter as a fulfillment path.** *Built.* The brief lists `barter-search` as an
existing module to "wire up"; it does not exist, so this is new — a `barter` module with
`BarterProposal`, plus `/store/collective/demand-pools/:id/barter` to offer a trade and
`.../barter/:proposalId/accept` for the pool creator to take one.

The mechanic none of the four competitor categories offer: a demand pool exists because
people want a thing, and whether that want is met with money or a swap is a settlement
detail. Hard-coding "money" as the only route is what makes every competitor cash-only.

Design notes:

- **`offering` and `wanting` are free text.** Barter is exactly where a taxonomy fails —
  the point is that someone can offer three hours of plumbing for a chest freezer, and no
  category tree survives that. Matching is human; the model records the agreement rather
  than classifying it.
- **Settlement is a zero-value ledger entry.** A barter is a real event the Phase 7 trail
  should show, but no money moved, and booking a notional value would corrupt the
  arithmetic that trail invites people to check. `createTransfer` accepts `0` (it rejects
  only negative and non-finite amounts), so the entry records the event at zero.
- **It is not on the GIFT rail, despite GIFT being the natural home** ("non-settling,
  recorded as zero-value flow for audit"). A rail is a property of the *accounts* and
  `createTransfer` takes no currency code, so the entry sits on the parties' wallets and
  carries `intended_rail: "GIFT"` in metadata rather than claiming a rail it is not on.
  GIFT-denominated accounts would close that gap.
- **The audit entry is best-effort.** The trade is agreed either way; failing an acceptance
  because a zero-value audit row did not write would be the wrong trade-off.
- Acceptance is authorized in the route, since it spans two modules — only the pool's
  creator may accept a trade fulfilling their pool, and `barter` deliberately knows nothing
  about demand pools. It is guarded on `status = 'PROPOSED'` so two accepters cannot both
  believe they struck the deal.

*Not built:* the TrashNothing and hOurworld adapters the brief mentions. Those are
third-party integrations and fall under the same consent constraint as Phase 5's inbound
half — an agreement, not a scraper.

**Phase 7 — ledger-backed trust.** *Built*, and only now legitimate to build: §2.3's
balance-path work had to land first, because advertising a verifiable ledger on top of a
non-atomic balance operation would have been the exact overclaim this feature exists to
avoid.

`GET /store/collective/demand-pools/:id/ledger` returns the money trail for a pool's
escrow — every entry in and out, whether each has settled into a Stellar batch, and the
on-chain anchor (`stellar_tx_hash`, `stellar_ledger_sequence`, `merkle_root`) when it has.
Nothing new had to be built in the ledger for this: `settlement_batch` already carried the
anchor fields and `ledger_entry.settlement_batch_id` already pointed at them.

Three decisions worth recording, all in `lib/pool-ledger-trail.ts`:

- **It projects a view, it does not serialize the row.** A ledger entry names both accounts
  and, through `debit_balance_after` / `credit_balance_after`, the running balance of a
  private wallet. Account ids, balances-after and idempotency keys are dropped. What the
  pool did with its money is collective; what any one member holds is not.
- **Verification status is honest per entry.** `ANCHORED` requires a Stellar tx hash;
  a batch that exists but has not landed is `SETTLED_PENDING_ANCHOR`; everything else is
  `UNSETTLED`. Presenting an unsettled entry as verified would recreate the "trust us"
  position the feature is meant to replace, so the summary counts the three separately.
- **It is public.** A trail only the pool's own members can read is not much of a trust
  mechanism — the claim is that an *outsider* can check where pooled money went. Non-PUBLIC
  pools are excluded, since publishing one would leak the existence and size of a
  NETWORK_ONLY or INVITE_ONLY buy to anyone who guessed an id.

Totals are signed by direction relative to the escrow account, so `net` should equal the
escrow balance — that subtraction is the check a reader is meant to be able to redo.

**Phase 8 — inbound connectors.** Pull buy requests and mutual aid needs in from external
communities where permitted.

---

## 5. Guardrails (non-negotiable)

- **Phase 0 gates everything.** No bounty, group-buy pledge, or mutual-aid fund routing
  ships against unremediated escrow/idempotency/balance code.
- **Mutual aid integrations require real consent and data-sharing agreements** — never
  unauthorized scraping of Mutual Aid Hub or rubyforgood directory data.
- **Do not adopt the deal-aggregation affiliate-commission model** (Honey/Rakuten/
  Slickdeals). It optimizes for cheapest-anywhere, which is structurally opposed to routing
  demand toward a cooperative vendor network.
- **Any "redirect surplus to mutual aid" flow must be explicit, opt-in, and reversible
  before finalization** — never a default, never a dark-pattern nudge away from a plain
  refund.
- **Never imply guaranteed fulfillment.** Buy orders and bounties are best-effort
  mechanisms backed by escrow, not delivery contracts. Copy must not suggest otherwise.
- **Confirm with legal/compliance** before enabling real-money mutual aid pledge routing in
  any jurisdiction with money-transmission licensing requirements.

---

## 6. Open questions

The brief's own framing is right: this combination has no proven revenue model. Mutual aid
tools have never found one, and deal aggregation's only proven model is the one §5 rules
out. The value-add mechanics — reputation carrying across modes, fulfillment feeding vendor
progression, unfulfilled demand routing to mutual aid or vendor acquisition, barter as
first-class, visible ledger as the trust mechanic, recurring order-cycle relationships,
inbound aggregation for cold-start liquidity — are the hypothesis being tested, not a
footnote. Treat them as prioritized over feature-parity with any competitor.
