# aid-network module

Opt-in model of a distribution network: the hubs it is made of, the stock each
holds, how non-purchased goods get in, and how stock moves between hubs.

## Tables

- `network_node` — one physical hub (pantry, free store, kitchen, warehouse…).
- `node_stock` — one lot of an item held at one hub.
- `intake_receipt` — goods arriving with no purchase order behind them.
- `node_transfer` — stock moving from one hub to another.

## Why this exists

Three gaps that looked separate turn out to be the same missing noun.

`agriculture/node-fulfillment` already splits an order across the growers who
*own* the stock. That is seller-scoped routing. It does not help a network
rebalance its **own** inventory between its **own** hubs, because the stack had
no entity for "a place that holds stock" — `food_producer` is an organisation
with an address, `seller` is a vendor, and neither holds inventory.

Once hubs exist:

- **In-kind intake** is a hub receiving goods with no purchase order
  (`intake_receipt`). Every previous inventory path assumed a purchase or a
  production run; a pantry's actual intake is neither.
- **Reverse logistics** is stock leaving a hub that has surplus for one that
  needs it (`node_transfer` with reason `rescue` /
  `surplus_redistribution`). `findExpiringSurplus` supplies the input: rescue
  and gleaning produce stock nobody requested, so the question is not "who asked
  for it" but "what spoils next".
- **Cross-hub allocation** is the plan connecting the two (`allocation.ts`).

## Design rules

- **Stock is lot-level.** Expiry is a property of a lot, and expiry drives every
  real decision here. One row per item per hub would destroy it.
- **`item_key` is the join.** Two hubs both holding carrots must agree on a key
  before anything can be allocated between them. `item_label` is for people.
- **Planning is pure and read-only.** `allocateAcrossNodes` writes nothing and
  is deterministic, so a plan can be re-run, diffed and reviewed. A plan a human
  has not approved should never silently move a network's food.
- **Intake writes stock in the same call.** A receipt with no resulting stock is
  the failure mode that makes donated goods invisible to allocation.
- **Cold chain is refused up front.** A cold item is never planned into, or
  transferred to, a hub without cold storage — checked at request time rather
  than discovered when the food arrives warm. A hub's *own* cold stock is
  exempt: it is already being held there.
- **Three quantities, not one.** `requested` / `shipped` / `received` genuinely
  differ, and the gap between them is the shrinkage signal that says which route
  is losing food. Receiving draws the origin down by what *shipped*, because
  food lost in transit has still left the origin shelf.

## Allocation strategies

`local_first` (default) fills a hub from its own shelves before moving anything,
since a transfer costs handling and adds spoilage risk. `expiry_first` ignores
hub boundaries and always burns the soonest-expiring lot in the network — fewer
wasted lots, more transport. Within either, lots go first-expired-first-out,
with distance as the tiebreak.

Unfilled demand reports *why*: `no_supply`, `cold_chain_unavailable`,
`expires_before_needed`, `out_of_range` or `transfers_disabled`. These get fixed
differently — "we have it but cannot keep it cold" is a fridge, not a food
drive.

Gated by the `AID_NETWORK_V1` feature flag.
