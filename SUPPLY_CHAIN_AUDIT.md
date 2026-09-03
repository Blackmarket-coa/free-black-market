# Supply Chain & Logistics Audit

Verification pass over the supply-chain gaps proposed for FBM + Blackout, done by
reading the code rather than reasoning from the roadmap. **Most of the proposed
gaps are already built.** This document records what was checked, what was found,
and the three things that genuinely were not there.

Method: every claim below was resolved to a model, service or route in
`backend/src` (FBM) or `packages/` (Blackout). A claim with no file reference did
not survive.

## Already built — proposed gaps that do not exist

| Proposed gap | Actually implemented in |
| --- | --- |
| Upstream sourcing / RFQ between producers | `modules/demand-pool` — `demand-post`, `supplier-proposal`, `proposal-vote`, `demand-bounty`; plus `modules/bargaining`, `modules/request`, `modules/supplier-forwarding` |
| Shared production capacity booking | `modules/kitchen` — `kitchen-space`, `equipment`, `kitchen-membership`; scheduled through `modules/booking` (`vendor-availability`) and `modules/rental` |
| QC / inspection gate before distribution | `modules/botanical/models/production-run.ts` (`qc_passed`); `modules/work-verification` (`proof-artifact`) |
| Multi-node fulfillment routing | `modules/agriculture/node-fulfillment.ts` — groups an order by resolved grower node, resolves each node's stock location, gates dispatch on phyto certs |
| Cold chain in **transport**, not just storage | `modules/food-distribution` — `courier.has_cold_storage`, `delivery.requires_cold`, `delivery.temperature_logged`, `food-order.requires_temperature_control` |
| Volunteer / last-mile courier coordination | `modules/food-distribution/models/courier.ts`; `modules/volunteer` — `work-party`, `work-party-signup`, `volunteer-log`, `time-credit` |
| Volunteer shift scheduling as unpaid labor | `modules/volunteer` (same as above) — already distinct from paid vendor staff |
| Creator-content → commerce attribution bridge | **Both ends exist.** FBM: `modules/creator-attribution` — `affiliate-link` (UTM, short codes, multi-level referrers), `click-event`, `order-attribution` (commission lifecycle), `promo-code-binding`. Blackout: `packages/api/src/services/marketplaceWebhook.ts` consumes FBM growth-attribution events and settles them into the tip ledger; `services/creatorDrivenSales.ts` aggregates the creator-driven-sales KPI; surfaced in `CreatorHubCreatorDrivenSales.tsx` |

The attribution bridge was previously called one of the two biggest structural
gaps. It is closed end to end, in both directions, with Prometheus counters at
settlement. No PostHog/Umami adoption is needed for this.

Multi-node inventory was called the other biggest gap. Routing across nodes
exists (`node-fulfillment.ts`). What does *not* exist is network-wide allocation
across shared hubs — routing is grower/seller-scoped, so a pantry network cannot
yet rebalance stock between its own hubs. That is a real but narrower gap than
"there is no multi-node inventory", and it does not obviously justify adopting
OpenBoxes wholesale.

## Genuine gaps

### 1. Cost accounting / COGS — **closed by this change**

`modules/production-ledger` tracks what was made and realized yield, and states
in its README that it deliberately carries no money ("that stays in the hawala
ledger"). But `hawala-ledger` is settlement and payments — accounts, entries,
escrow, payouts. Nothing anywhere tracked materials, labor or overhead per batch,
so a producer had no unit cost and therefore no sustainable price.

Added as `modules/production-costing` — a separate module rather than columns on
`production_batch`, so the ledger's "no money here" rule stays intact and either
module can be adopted alone. See `backend/src/modules/production-costing/README.md`.

The design point worth keeping: donated materials and volunteer hours are real
costs (they must be replaced if the donation stops) but they are not cash. Every
cost line carries `is_cash_outlay`, derived from its source, so one set of books
answers both "what did this batch cost to make?" and "how much cash did we need?"
A COGS model that collapses those two numbers is wrong for mutual aid.

### 2. Restricted-fund / grant tracking — **still open**

No `fund_id`, `restricted_fund`, `designated_fund` or equivalent anywhere in
`backend/src`. `modules/donation` routes money *to* beneficiaries
(`donation-beneficiary`, `donation-disbursement`) but does not track designated
money held *against* a program. A nonprofit cannot currently answer "how much of
this grant is unspent, and did we spend it on what it was designated for?"

This is a fund-tagging layer over the existing ledger, not a separate product.
`production_cost_entry.reference_type`/`reference_id` is a plausible attachment
point on the spend side.

### 3. In-kind material intake — **partially addressed, still open**

`CostSource.DONATED` now lets a donated input be valued into a batch's COGS
without inflating cash outlay, which covers the *production-input* case. It does
not cover intake as inventory: receiving donated goods into stock, with no
purchase order and no vendor, is still unmodelled.

## Not evaluated

Reverse logistics (food rescue / gleaning / surplus routing) was searched for and
not found, but the adjacent modules (`food-distribution`, `mutual-aid`,
`harvest`) are large enough that absence of a keyword is not proof of absence of
the capability. Treat it as unverified rather than as a confirmed gap.
