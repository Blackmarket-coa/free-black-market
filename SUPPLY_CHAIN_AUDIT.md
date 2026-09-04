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

### 1. Cost accounting / COGS — **closed**

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

### 2. Restricted-fund / grant tracking — **closed**

No `fund_id`, `restricted_fund` or equivalent existed anywhere in `backend/src`.
`modules/donation` routes money *to* beneficiaries; it does not track designated
money held *against* a program. A nonprofit could not answer "how much of this
grant is unspent, and did we spend it on what it was designated for?"

Added as `modules/fund-accounting` (`fund`, `fund_transaction`). See
`backend/src/modules/fund-accounting/README.md`.

Award, receipt and spend are separate entry types rather than one signed number,
because "committed but not received" and "received but not spent" are both real
states a grant report has to show. Balances are never stored — every figure
derives from transaction rows, so a fund cannot disagree with its own history.

The guards refuse the write rather than flagging it afterwards: overspending an
award, spending outside the permitted period, and spending a permanently
restricted corpus are all rejected at `recordEntry`, because the write is the
thing that costs the grant. `checkCompliance` still reports every finding at
once for reconciliation, including the case that is not provably wrong but is
not auditable either — a purpose-restricted spend carrying no `program_id`.

### 3. In-kind material intake — **closed**

`intake_receipt` in `modules/aid-network` records goods arriving with no
purchase order behind them — donation, rescue, gleaning, overproduction — and
creates the `node_stock` lots in the same call, because a receipt that produces
no stock is exactly what made donated goods invisible to allocation.

In-kind valuation (`estimated_value_cents` + `valuation_basis`) is deliberately
kept out of the money ledgers: no cash moved, but the figure is needed for donor
acknowledgment and in-kind contribution reporting, and it is only defensible
alongside how it was reached.

`CostSource.DONATED` in `production-costing` covers the adjacent case — a
donated *input consumed by a production batch* — so donated flour lands in COGS
without inflating cash outlay.

### 4. Reverse logistics / surplus rescue — verified absent, now **closed**

Previously listed as unverified. Confirmed absent: `mutual-aid` is a
person-to-person offer/request board, and `harvest`'s `donation` pool allocates
one garden's harvest by percentage — neither routes recovered goods between
organisations.

Closed by `node_transfer` (reasons `rescue` and `surplus_redistribution`) plus
`findExpiringSurplus`, which supplies the input the problem actually has: rescue
and gleaning produce stock nobody requested, so the question is not "who asked
for it" but "what spoils next".

### 5. Network-wide multi-node allocation — **closed**

`agriculture/node-fulfillment` splits an order across the growers who *own* the
stock. That is seller-scoped routing, and it does not let a network rebalance
its own inventory between its own hubs — because the stack had no entity for "a
place that holds stock". `food_producer` is an organisation with an address;
`seller` is a vendor; neither holds inventory.

`network_node` + `node_stock` supply the missing noun, and `allocation.ts` plans
across them: first-expired-first-out, local shelves before any transfer,
distance as tiebreak, cold items never planned into a hub that cannot hold them.
Planning is pure, read-only and deterministic, so a plan can be re-run, diffed
and reviewed before anyone moves food.

Unfilled demand reports *why* — `no_supply`, `cold_chain_unavailable`,
`expires_before_needed`, `out_of_range`, `transfers_disabled` — because those get
fixed differently. "We have it but cannot keep it cold" is a fridge, not a food
drive.

## Adoption note

None of this required adopting OpenBoxes, PostHog or Umami. The attribution
bridge was already built; the allocation and fund-accounting gaps were narrow
enough to close directly against the existing module conventions, which keeps
seller scoping, feature flags and the vendor API surface consistent with the
rest of FBM.

## Status

| Gap | State |
| --- | --- |
| Cost accounting / COGS | Closed — `production-costing` |
| Restricted-fund / grant tracking | Closed — `fund-accounting` |
| In-kind material intake | Closed — `aid-network` (`intake_receipt`) |
| Reverse logistics / surplus rescue | Closed — `aid-network` (`node_transfer`, `findExpiringSurplus`) |
| Network-wide multi-node allocation | Closed — `aid-network` (`allocation.ts`) |

All five are behind feature flags (`FF_PRODUCTION_COSTING_V1`,
`FF_FUND_ACCOUNTING_V1`, `FF_AID_NETWORK_V1`) and default off.

## Verification

Unit coverage alone cannot show that a migration matches its model or that a
route's gates, validation and guards compose correctly, so the modules were
also verified against a live Postgres 16:

- **Migrations.** `medusa db:migrate` applies all three cleanly. The migrated
  schema was inspected: every `model.bigNumber()` field has its `raw_*` JSONB
  companion, all 14 enum types exist, both unique partial indexes exist, and
  column counts match the models.
- **Module specs** (`*.integration.spec.ts`, via `moduleIntegrationTestRunner`):
  cents survive the bigNumber roundtrip; the fund overspend guard refuses
  against real history and yields once a reversing entry is written; an intake
  produces stock the planner finds on the next read; receiving a transfer draws
  the origin down by what shipped and stocks the destination with what arrived.
- **HTTP spec** (`integration-tests/http/vendor-supply-chain-flows.spec.ts`):
  the real seller-auth path through every new route, with three sellers — two
  paid to prove ownership isolation, one free to prove the
  `vendor.fund_accounting` paywall 402s and that aid-network answers it anyway.

### Found and fixed on the way

`order_attribution` declares three `model.bigNumber()` fields, and its create
migration made only the NUMERIC half of each — none of the `raw_*` companions
the generated CRUD reads and writes. On a database built from its own
migrations, `createOrderAttributions` and `listOrderAttributions` failed on a
missing column: the creator-to-commerce bridge this audit called "closed end to
end" could not persist an attribution. `Migration20260904AddRawBigNumberColumns`
adds the companions (nullable, backfilled from the numeric values, idempotent),
and `integration-tests/http/creator-attribution-bignumber.spec.ts` writes and
reads a row through the generated CRUD to hold it closed.
