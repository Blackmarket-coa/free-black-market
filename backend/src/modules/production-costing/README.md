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

Gated by the `PRODUCTION_COSTING_V1` feature flag and the existing
`vendor.production_ledger` plan feature — costing ships with the addon that
already sells the ledger rather than adding a new billing surface.
