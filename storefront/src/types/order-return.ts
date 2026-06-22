import { HttpTypes } from "@medusajs/types"
import { SellerProps } from "./seller"

/**
 * Shared types for the order-return flow. The marketplace's return-request
 * endpoints (`/store/return-request`) return custom shapes that have no Medusa
 * SDK equivalent, so they are modelled here from the fields the UI actually
 * consumes. Standard order/line-item/reason data reuses `HttpTypes.Store*`.
 */

/** An order enriched with the marketplace seller + its order-set reference. */
export type ReturnOrder = HttpTypes.StoreOrder & {
  seller: SellerProps
  order_set?: { id: string }
}

/** A line item the shopper has selected to return (request-creation payload). */
export type SelectedReturnItem = {
  line_item_id: string
  quantity?: number
  reason_id: string
}

/** A line item attached to an existing return request. */
export type ReturnLineItem = {
  line_item_id: string
  created_at: string
  reason_id?: string
  quantity?: number
}

/** A return request as returned by `getReturns` / `createReturnRequest`. */
export type ReturnRequest = {
  id: string
  status: string
  created_at?: string
  order: ReturnOrder
  line_items: ReturnLineItem[]
}

/** Body sent to `createReturnRequest`. */
export type ReturnRequestPayload = {
  order_id: string
  customer_note: string
  shipping_option_id: string | null
  line_items: SelectedReturnItem[]
}

/** An order line item decorated with the resolved return-reason label. */
export type OrderLineItemWithReason = HttpTypes.StoreOrderLineItem & {
  reason_id: string
}
