import { model } from "@medusajs/framework/utils"

/**
 * How donor intent constrains the money. Modelled on the two axes a grant
 * actually constrains — *what* it may be spent on and *when* — rather than on
 * the legacy three-bucket net-asset classes, because those two are what a
 * compliance check can mechanically verify.
 */
export enum FundRestriction {
  /** General operating money. No purpose or period test applies. */
  UNRESTRICTED = "unrestricted",
  /** Must be spent on a designated program. */
  PURPOSE = "purpose",
  /** Must be spent inside a stated period. */
  TIME = "time",
  /** Both tests apply. */
  PURPOSE_AND_TIME = "purpose_and_time",
  /** Corpus may never be spent; only its income may be. */
  PERMANENT = "permanent",
}

export enum FundSource {
  GRANT = "grant",
  DONATION = "donation",
  CONTRACT = "contract",
  INTERNAL = "internal",
}

export enum FundStatus {
  ACTIVE = "active",
  /** Award fully spent or returned; kept for reporting. */
  CLOSED = "closed",
}

/**
 * Fund — a pot of money held under donor intent.
 *
 * The gap this closes: commission-based vendor revenue and round-up donations
 * both answer "who gets paid." Neither answers the question a grant-funded
 * organisation is audited on — "how much of this award is unspent, and was it
 * spent on what it was designated for, inside the period it was designated
 * for?" That needs money tagged with intent at rest, not just in motion.
 *
 * Balances are never stored here. They are derived from `fund_transaction`
 * rows, so a fund can never disagree with its own history.
 */
const Fund = model
  .define("fund", {
    id: model.id().primaryKey(),

    seller_id: model.text(),

    name: model.text().searchable(),
    /** Short operator-chosen code, unique per seller ("USDA-LFPA-24"). */
    code: model.text(),
    description: model.text().nullable(),

    restriction: model
      .enum(Object.values(FundRestriction))
      .default(FundRestriction.UNRESTRICTED),
    source: model.enum(Object.values(FundSource)).default(FundSource.GRANT),

    /** What the money is designated for, in the grantor's words. */
    purpose_description: model.text().nullable(),
    /**
     * Machine-checkable designation. When set, an expenditure carrying a
     * different program_id is flagged as off-purpose by the compliance check.
     */
    designated_program_id: model.text().nullable(),

    /** Period restriction bounds. Null means unbounded on that side. */
    spend_from: model.dateTime().nullable(),
    spend_until: model.dateTime().nullable(),

    grantor_name: model.text().nullable(),
    grant_reference: model.text().nullable(),

    currency_code: model.text().default("usd"),

    status: model.enum(Object.values(FundStatus)).default(FundStatus.ACTIVE),

    /** Whether the service refuses expenditures beyond the unspent award. */
    enforce_spend_limit: model.boolean().default(true),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["seller_id"], name: "IDX_fund_seller" },
    { on: ["seller_id", "code"], name: "UQ_fund_seller_code", unique: true },
    { on: ["status"], name: "IDX_fund_status" },
  ])

export default Fund
