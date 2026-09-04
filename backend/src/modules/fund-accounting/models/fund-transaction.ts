import { model } from "@medusajs/framework/utils"

/**
 * What a row does to a fund. Kept explicit rather than folded into a signed
 * amount, because "awarded but not yet received" and "received but not yet
 * spent" are different questions and a grant report has to answer both.
 */
export enum FundEntryType {
  /** Grantor commits money. Raises the award; moves no cash. */
  AWARD = "award",
  /** Cash actually lands against an award. */
  RECEIPT = "receipt",
  /** Money spent against the fund. */
  EXPENDITURE = "expenditure",
  /** Restriction satisfied; amount is reportable as unrestricted. */
  RELEASE = "release",
  /** Unspent money returned to the grantor. */
  RETURN = "return",
}

/**
 * Fund Transaction — one movement against a fund.
 *
 * Amounts are integer cents. A correction is a negative row of the *same*
 * entry type — an ordinary reversing entry — rather than a separate adjustment
 * type, so every figure in a report traces to rows of the type it describes and
 * nothing has to guess which bucket an adjustment belonged to.
 *
 * `program_id` is what makes purpose compliance mechanical: an expenditure
 * tagged with a program other than the fund's `designated_program_id` is
 * flagged, rather than relying on someone reading the memo field.
 */
const FundTransaction = model
  .define("fund_transaction", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    fund_id: model.text(),

    entry_type: model.enum(Object.values(FundEntryType)),

    amount_cents: model.bigNumber(),
    currency_code: model.text().default("usd"),

    /** When the movement happened, for period-compliance tests. */
    occurred_at: model.dateTime(),

    description: model.text().nullable(),

    /** Program this spend served. Checked against the fund's designation. */
    program_id: model.text().nullable(),

    /**
     * Where this came from elsewhere in the system — a production cost entry,
     * an order, a payout. Lets a grant report drill back to the real event.
     */
    reference_type: model.text().nullable(),
    reference_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["fund_id"], name: "IDX_fund_transaction_fund" },
    { on: ["seller_id"], name: "IDX_fund_transaction_seller" },
    { on: ["entry_type"], name: "IDX_fund_transaction_type" },
    { on: ["program_id"], name: "IDX_fund_transaction_program" },
  ])

export default FundTransaction
