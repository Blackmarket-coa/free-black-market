import type { AdminOrderLineItem, OrderLineItemDTO } from "@medusajs/types"

// Accept either the workflow-level OrderLineItemDTO or the admin
// response shape (which share the quantity / detail.fulfilled_quantity
// fields this helper reads).
export const getFulfillableQuantity = (
  item: OrderLineItemDTO | AdminOrderLineItem
) => {
  return item.quantity - item.detail.fulfilled_quantity
}
