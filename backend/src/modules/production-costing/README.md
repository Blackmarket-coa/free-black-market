# production-costing module

Opt-in COGS for production batches — "what did this batch cost to make, and what
must a unit sell for to be sustainable."

This is the money the [`production-ledger`](../production-ledger/README.md)
module deliberately refuses to carry ("no money is tracked here"). The ledger
answers *what was made*; this module answers *what it cost*. They stay separate
modules so either can be adopted alone.

## Table

- `production_cost_entry` — one costed line against a `production_batch`, in
  integer cents.

## Design rules

- **Cash and in-kind are both costs, and they are not the same number.**
  Donated flour and volunteer hours belong in COGS — if the donation stops, the
  cost is real and must be replaced. But no cash left the organisation to get
  them. Every entry carries `is_cash_outlay`, derived from `source` unless the
  caller states otherwise, so one set of books answers both "what did this
  actually cost?" (`total_cents`) and "how much cash did we need?"
  (`cash_outlay_cents`). This is the mutual-aid case the usual COGS model gets
  wrong.
- **No cross-module resolution.** The service never resolves the production
  ledger. `yield_qty` is passed in by the caller, so a vendor can run the ledger
  without costing, costing without the ledger, or source yields from anywhere.
- **Rounding lives in one file.** All arithmetic is in `costing.ts`, pure and
  I/O-free. Suggested prices round *up*, so rounding never lands a seller under
  their target margin.
- **Unknown yield returns null, never a guess.** A batch that has not reported
  yield has no unit cost; callers get `null` rather than `Infinity` or a zero
  that reads as "free".

## Margin convention

Gross margin is measured against revenue, the way a P&L reads it:
`price = cost / (1 - margin/100)`. A 50% margin on a $4.00 unit cost is $8.00,
not $6.00. Margins outside `[0, 100)` return null.

The suggested prices are that formula and nothing else: no card-processing
fee, no platform commission, no spoilage and no outbound fulfilment is in them
(found in SD-152; Plates Phase 5 in `docs/PLATES_SC_PILOT_PLAN.md` is where
they are added).

## Routes

All under `/vendor/production-costs`, for a signed-in vendor:

| Route | Does |
|---|---|
| `GET /` | The store's cost entries; `?production_batch_id=` for one batch. |
| `POST /` | Record a cost line against one of the store's batches. |
| `DELETE /:id` | Remove one of the store's cost entries. |
| `GET /rollup?production_batch_id=…[&price_cents=…]` | Totals by category, the cash and in-kind split, unit cost, suggested prices, and the margin a given price would realize. |

- **Keyed by the store.** `seller_id` on a row is the store's id, read with
  `getSellerId` (`api/vendor/quests/_helpers.ts`, SD-145), so every member of
  a store sees and edits the same entries. A batch or an entry of another
  store answers 404, never 403.
- **Numbers are numbers.** Every answer that carries a cost entry goes through
  `toCostEntryDTO` (`service.ts`), which gives `quantity`, `unit_amount_cents`
  and `amount_cents` as JSON numbers. `quantity` is `model.number()` over a
  NUMERIC column, and a read of a database built from the migrations returns
  it as a string (`"2.5"`); the column is left NUMERIC because a quantity can
  be fractional. A new route that answers a cost entry must use the same
  function (`api/vendor/production-costs/__tests__/production-routes.unit.spec.ts`
  lists the routes that do).

## Access

In every vendor plan, the free plan included (PL-1; owner decision of
2026-11-17). Two gates stay registered on `/vendor/production-costs*`, in this
order (`api/middlewares.ts`):

1. **`FF_PRODUCTION_COSTING_V1`, the kill switch.** Off, which is the default,
   every route answers 404 `feature_disabled`. Only the literal `true` turns
   it on. The flag is read from the environment on each request.
2. **`requirePlanFeature("vendor.production_ledger")`.** The key is in
   `UNIVERSAL_FEATURE_KEYS` (`modules/vendor-plan/catalog.ts`), which every
   plan carries, so it lets every seller through. It is kept so that emptying
   that list puts the paywall back without touching a route, and so that a
   failed plan lookup still answers 503 instead of opening the route.

A cost line needs a production batch, so `FF_PRODUCTION_LEDGER_V1` has to be
on as well for a vendor to make one (see the
[`production-ledger`](../production-ledger/README.md) README).

No add-on pack sells this any more: the Grower Tools pack carried the key
until PL-1 and is now nursery management only. A seller who bought it before
keeps the rows it wrote until they expire, and keeps costing after that
through their plan (`shared/__tests__/grower-pack-holder.unit.spec.ts`).

Proof on Postgres: `integration-tests/http/production-costing-every-plan.spec.ts`.
