import { model } from "@medusajs/framework/utils"
import OrderDispute from "./order-dispute"

/**
 * Append-only log of everything that happened to a dispute.
 *
 * Follows `order_subcontract_event`: a dispute is an argument about money
 * between two parties with a third deciding, so who said what and when is the
 * record that matters most. Statuses are overwritten; this is not.
 *
 * `actor_type` is recorded rather than inferred from `actor_id`, because a
 * seller id and a customer id are different namespaces and a reader should
 * not have to know which prefix means what to follow the thread.
 */
const OrderDisputeEvent = model
  .define("order_dispute_event", {
    id: model.id().primaryKey(),

    dispute: model.belongsTo(() => OrderDispute, { mappedBy: "events" }),

    /** opened | seller_responded | status_changed | note | resolved */
    kind: model.text(),

    /** buyer | seller | admin | system */
    actor_type: model.text(),
    actor_id: model.text().nullable(),

    /** Status before and after, when this event changed one. */
    from_status: model.text().nullable(),
    to_status: model.text().nullable(),

    message: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["dispute_id"],
      name: "IDX_order_dispute_event_dispute",
      where: "deleted_at IS NULL",
    },
  ])

export default OrderDisputeEvent
