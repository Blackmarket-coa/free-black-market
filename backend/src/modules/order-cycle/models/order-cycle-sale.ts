import { model } from "@medusajs/framework/utils"

/**
 * Order Cycle Sale — one recorded sale against a cycle product.
 *
 * This model exists to make `recordSale` idempotent. `sold_quantity` on
 * `order_cycle_product` is a bare counter incremented with
 * `sold_quantity + quantity`, so a retried or duplicated `order.placed`
 * double-counted it and there was no record to check against. The sibling
 * `modules/cottage-food` had already solved exactly this by keying its sales
 * entries on `(source, source_id)` and returning the existing row; order-cycle
 * had no such key, which is why D9-2 in `docs/AUDIT_DEBT.md` recorded the fix
 * as needing a schema change. This is that change, following the same shape.
 *
 * The unique index is on `(order_cycle_id, variant_id, source, source_id)`
 * rather than on the order alone: one order can contain several variants from
 * the same cycle, and each is its own sale. It is the database, not the
 * service, that guarantees uniqueness — two concurrent deliveries of the same
 * event would both pass a read-then-write check.
 *
 * Recording the quantity as well as the key means the ledger is a real audit
 * trail: `sold_quantity` can be rebuilt from these rows if it ever drifts, and
 * D9-4's write-only order↔cycle link finally has a companion that is read.
 */
const OrderCycleSale = model.define("order_cycle_sale", {
  id: model.id().primaryKey(),

  order_cycle_id: model.text(),

  // The cycle product this sale was applied to.
  order_cycle_product_id: model.text(),

  variant_id: model.text(),

  // Units sold. Recorded so sold_quantity can be rebuilt from the ledger.
  quantity: model.number(),

  /**
   * Where the sale came from. Mirrors cottage-food's `source`/`source_id`
   * pair so the two modules dedupe the same way.
   */
  source: model.text().default("medusa_order"),

  /** The order id, for `medusa_order`. Nullable for a manual adjustment. */
  source_id: model.text().nullable(),

  metadata: model.json().nullable(),
})
.indexes([
  {
    name: "IDX_OCS_ORDER_CYCLE_ID",
    on: ["order_cycle_id"],
  },
  {
    name: "IDX_OCS_SOURCE",
    on: ["source", "source_id"],
  },
  {
    // The idempotency guarantee itself. Partial, because a manual adjustment
    // carries no source_id and several of those are legitimate.
    name: "IDX_OCS_DEDUPE",
    on: ["order_cycle_id", "variant_id", "source", "source_id"],
    unique: true,
    where: "source_id IS NOT NULL",
  },
])

export default OrderCycleSale
