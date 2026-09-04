import { model } from "@medusajs/framework/utils"

/** How the goods arrived. Every one of these is a non-purchase intake. */
export enum IntakeSource {
  DONATION = "donation",
  RESCUE = "rescue",
  GLEANING = "gleaning",
  /** A producer's own overrun, contributed rather than sold. */
  OVERPRODUCTION = "overproduction",
  TRANSFER_IN = "transfer_in",
}

export enum DonorType {
  INDIVIDUAL = "individual",
  BUSINESS = "business",
  FARM = "farm",
  ORGANIZATION = "organization",
  ANONYMOUS = "anonymous",
}

/**
 * Intake Receipt — goods arriving at a hub with no purchase order behind them.
 *
 * The gap: every existing inventory path in the stack assumes a purchase or a
 * production run. A pantry's actual intake is neither — a supermarket's
 * near-date pallet, a farm's unsold flat, a neighbour's box of tins. There was
 * nowhere to record it, so it could not become inventory, so it could not be
 * allocated.
 *
 * `estimated_value_cents` is the in-kind valuation. It is deliberately separate
 * from anything in the money ledgers: no cash moved, but the organisation needs
 * the figure for donor acknowledgment and for in-kind contribution reporting,
 * and a donor's own claimed value is not the organisation's to assert. Recording
 * the basis alongside the number is what keeps it defensible.
 */
const IntakeReceipt = model
  .define("intake_receipt", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    node_id: model.text(),

    source: model.enum(Object.values(IntakeSource)).default(IntakeSource.DONATION),

    donor_name: model.text().nullable(),
    donor_type: model.enum(Object.values(DonorType)).default(DonorType.INDIVIDUAL),
    donor_contact: model.text().nullable(),

    received_at: model.dateTime(),
    received_by: model.text().nullable(),

    /** In-kind valuation in cents, and how it was arrived at. */
    estimated_value_cents: model.bigNumber().nullable(),
    valuation_basis: model.text().nullable(),
    currency_code: model.text().default("usd"),

    /** Whether the donor has been sent an acknowledgment for this intake. */
    acknowledgment_sent: model.boolean().default(false),

    /** Optional link to a fund, when the gift is designated. */
    fund_id: model.text().nullable(),

    notes: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["node_id"], name: "IDX_intake_receipt_node" },
    { on: ["seller_id"], name: "IDX_intake_receipt_seller" },
    { on: ["source"], name: "IDX_intake_receipt_source" },
    { on: ["received_at"], name: "IDX_intake_receipt_received_at" },
  ])

export default IntakeReceipt
