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

### 2.3 Still open — documented, deliberately not fixed

These were scoped out of this change and remain follow-ups. **They are inside Phase 0's
subject matter**; treat them as gating for anything that depends on exact balances.

- `updateBalancesAtomic` (`modules/hawala-ledger/service.ts`) guards on `balance`, not
  `available_balance` — an account with funds reserved can still be drained.
- The no-transaction fallback in `createTransfer` runs two un-transacted statements, so a
  credit failure after a successful debit leaves a one-sided move.
- Legacy `updateBalances` retains the H1 TOCTOU verbatim as a fallback.
- `claimBounty` is still read-check-write racy (first-come claim).
- `shared/idempotency-store.ts`'s in-memory fallback is per-process, so it is not a real
  guard in a multi-instance deploy.

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
Generic non-FBM buyer archetype with sensible defaults (**not built**). Two-surface
delivery: hosted hub plus embeddable widget following connect.js.

**Phase 2 — reputation unification.** Trust earned as a bounty filler, mutual aid helper,
or group-buy organizer must be one score, not three. *Partially delivered:* the buyer side
previously awarded **no XP at all** while nine other `source_module`s did. Bounty milestone
settlement now emits `bounty.milestone_settled`, and `subscribers/progression-bounty-settled.ts`
records it against the shared character sheet — COALITION XP, or CREATOR for
creator-facing objectives, with `source_id` scoped per milestone so a replay cannot
double-count. Group-buy organizing and mutual-aid help still need their own emitters.

**Phase 3 — buy orders and bounties.** Largely present: storefront pages exist at
`(main)/collective/demand-pools/{,new,[id]}`, and the escrow-backed bounty flow lives in
`demand-pool` + `services/collective-hawala.ts`. Remaining: the vendor-acquisition hook
that turns an unfulfilled bounty into a qualified lead rather than a dead end.

**Phase 4 — group buying and order cycles.** Threshold unlock on `demand-pool`; wire
`order-cycle` as the recurring-relationship alternative to one-off group buys. Surplus and
overshoot handling — see the guardrail in §5.

**Phase 5 — mutual aid.** Request/offer matching, reusing Coalition's heatmap/scroll design
rather than building parallel UI. Inbound aggregation from Mutual Aid Hub and
rubyforgood/mutual-aid solves the per-city cold-start problem — **only under an actual
data-sharing agreement** (§5).

**Phase 6 — barter as a fulfillment path.** Greenfield: no barter module exists.

**Phase 7 — ledger-backed trust.** Surface the Stellar/USDC settlement trail for pooled
funds. Depends on §2.3 being closed first — do not advertise a "verifiable" ledger built
on a balance path with known atomicity gaps.

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
