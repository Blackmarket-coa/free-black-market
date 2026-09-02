import { model } from "@medusajs/framework/utils"
import { DisputeReason, DisputeStatus } from "../resolution"
import OrderDisputeEvent from "./order-dispute-event"

/**
 * A buyer's claim against an ordinary order.
 *
 * The escrow state machine has modelled arbitration since it was written, but
 * only service contracts and subcontracts could reach it. A buyer with a bad
 * order had no route at all. This is that route: the case file, and the queue
 * an admin works from.
 *
 * `escrow_agreement_id` is nullable and usually null. Ordinary orders settle
 * through Stripe rather than escrow, so most disputes here are resolved by an
 * admin decision and a refund, not by moving escrowed funds. When an escrow
 * agreement does exist for the order, its id is recorded and its own machine
 * does the moving — this model never becomes a second ledger.
 *
 * One live dispute per order, enforced by a partial unique index: a second
 * claim on the same order is the same argument, and letting two run would let
 * two admins resolve it in opposite directions.
 */
const OrderDispute = model
  .define("order_dispute", {
    id: model.id().primaryKey(),

    order_id: model.text(),
    /** The vendor the claim is against. */
    seller_id: model.text(),
    /** The buyer making it. */
    customer_id: model.text(),

    status: model.enum(Object.values(DisputeStatus)).default(DisputeStatus.OPEN),
    reason: model.enum(Object.values(DisputeReason)).default(DisputeReason.OTHER),

    /** The buyer's account, in their own words. */
    description: model.text(),

    currency_code: model.text().default("usd"),
    /** What the buyer is claiming, minor units. Clamped to the order total. */
    claim_amount: model.number().default(0),
    /** What the resolution actually awarded, minor units. */
    award_amount: model.number().default(0),

    /** The vendor's answer, when they give one. */
    seller_response: model.text().nullable(),
    seller_responded_at: model.dateTime().nullable(),

    /** The admin's reasoning. Written for the parties, not for us. */
    resolution_note: model.text().nullable(),
    resolved_at: model.dateTime().nullable(),
    resolved_by: model.text().nullable(),

    /** The hawala escrow agreement for this order, when one exists. */
    escrow_agreement_id: model.text().nullable(),

    metadata: model.json().nullable(),

    events: model.hasMany(() => OrderDisputeEvent, { mappedBy: "dispute" }),
  })
  .indexes([
    {
      on: ["order_id"],
      name: "UQ_order_dispute_live",
      unique: true,
      where:
        "deleted_at IS NULL AND status IN ('open', 'under_review')",
    },
    {
      on: ["seller_id", "status"],
      name: "IDX_order_dispute_seller_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["customer_id"],
      name: "IDX_order_dispute_customer",
      where: "deleted_at IS NULL",
    },
    {
      on: ["status"],
      name: "IDX_order_dispute_status",
      where: "deleted_at IS NULL",
    },
  ])

export default OrderDispute
