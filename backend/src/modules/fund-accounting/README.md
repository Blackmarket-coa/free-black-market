# fund-accounting module

Opt-in tracking of money held under donor intent — restricted funds, grants and
designated gifts.

## Tables

- `fund` — the terms of one pot of money: what it may be spent on, when, and how
  much was awarded.
- `fund_transaction` — one movement against a fund.

## Why this exists

Commission splits (`payout-breakdown`), settlement (`hawala-ledger`) and
round-up donations (`donation`) all answer *who gets paid*. None of them answers
the question a grant-funded organisation is audited on:

> How much of this award is unspent, and was it spent on what it was designated
> for, inside the period it was designated for?

That needs money tagged with intent **at rest**, not just in motion.

## Design rules

- **Balances are never stored.** Every figure derives from `fund_transaction`
  rows (`fund-math.ts`), so a fund cannot disagree with its own history.
- **Award, receipt and spend are three different questions.** "Committed but not
  received" and "received but not spent" are both real states a grant report has
  to show, so they are separate entry types rather than one signed number.
- **A correction is a negative row of the same type.** An ordinary reversing
  entry — not a separate adjustment type that later has to be guessed back into
  a bucket.
- **The guards refuse the write.** Overspending an award and spending outside
  the period are refused up front rather than written and flagged later, because
  the write is the thing that costs the grant. A fund can opt out with
  `enforce_spend_limit: false`; a single entry can opt out with `force`.
- **Unverifiable is reported, not passed.** A spend from a purpose-restricted
  fund carrying no `program_id` is not provably wrong, but it is not auditable
  either, so it surfaces as a warning.
- **Compliance returns every finding.** A reconciliation needs the whole list,
  so `checkCompliance` collects rather than throwing on the first failure.

## A spend must cite a settlement

An expenditure is a claim that grant money paid for something. The claim is
only auditable if it points at the money that actually moved, so every
non-zero expenditure — reversals included — must cite a `hawala_ledger_entry`
(`reference_type = "hawala_ledger_entry"`, `reference_id`; the vendor route
accepts `settlement_id` as the friendly form). The write is refused unless the
cited entry:

- exists and is debited from one of **this seller's** accounts — an unknown id
  and another seller's entry both read as not-found, so the guard never
  confirms someone else's ledger rows;
- has actually moved (`COMPLETED` or `SETTLED`); a `PENDING` entry is money that
  has not left yet;
- is in the fund's currency;
- and, summed across **every fund the seller holds**, is not attributed beyond
  what it moved. A $1,000 payment may be split $600/$400 between two grants; it
  may never be claimed as $600 by one and $500 by another.

The module never resolves the ledger. The route composes a `SettlementVerifier`
from hawala (`api/vendor/funds/_settlements.ts`) and passes it in; without one,
an expenditure fails closed rather than being written unverified.

`force` bypasses the award limit and the spend period — policy, with documented
exceptions. It does **not** bypass the citation or the cap. Those are
conservation: money cannot be attributed that did not move, and there is no
documented exception to that.

A spend written before this rule surfaces as an `uncited_spend` finding.

Two things the route layer has to get right: hawala accounts are keyed by the
`sel_*` seller id while the vendor guard rewrites the actor to `mem_*`, so the
lookup goes through `resolveVendorSellerId`; and hawala stores amounts in major
units while this module is integer cents, so the conversion happens once, there.

## Restrictions

`unrestricted` · `purpose` · `time` · `purpose_and_time` · `permanent`

Purpose compliance is mechanical: set `designated_program_id` on the fund, tag
expenditures with `program_id`, and a mismatch is an error rather than something
someone has to notice in a memo field.

Gated by the `FUND_ACCOUNTING_V1` feature flag.
