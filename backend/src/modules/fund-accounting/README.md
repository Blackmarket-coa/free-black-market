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

## Restrictions

`unrestricted` · `purpose` · `time` · `purpose_and_time` · `permanent`

Purpose compliance is mechanical: set `designated_program_id` on the fund, tag
expenditures with `program_id`, and a mismatch is an error rather than something
someone has to notice in a memo field.

Gated by the `FUND_ACCOUNTING_V1` feature flag.
