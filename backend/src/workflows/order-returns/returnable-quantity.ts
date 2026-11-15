import type { BigNumberInput } from "@medusajs/framework/types"
import { MathBN, MedusaError } from "@medusajs/framework/utils"

type Quantity = BigNumberInput | null | undefined

/**
 * An order item's quantity counters, as the order module keeps them on the
 * item's `detail` (the `order_item` row).
 */
export type OrderItemQuantities = {
  fulfilled_quantity?: Quantity
  return_requested_quantity?: Quantity
  return_received_quantity?: Quantity
  return_dismissed_quantity?: Quantity
  written_off_quantity?: Quantity
}

/**
 * How many units of an order item a buyer may still ask to return: what was
 * fulfilled, less what is already requested, received back, dismissed on
 * receipt, or written off.
 *
 * Core's own check (`@medusajs/order` `utils/actions/return-item.js`) is
 * `fulfilled - return_requested` only. Receiving a return moves its units out
 * of `return_requested` and into `return_received` (dismissing, into
 * `return_dismissed`), so by core's count units the seller has already taken
 * back become returnable again, and a second request for them would be
 * accepted and, once received, owed a second refund. Never below zero.
 */
export function returnableQuantity(detail: OrderItemQuantities | null | undefined): number {
  const n = (value: Quantity) => MathBN.convert(value ?? 0)
  const available = MathBN.sub(
    n(detail?.fulfilled_quantity),
    MathBN.add(
      n(detail?.return_requested_quantity),
      n(detail?.return_received_quantity),
      n(detail?.return_dismissed_quantity),
      n(detail?.written_off_quantity)
    )
  )
  return Math.max(0, available.toNumber())
}

export type ReturnableItem = {
  id: string
  detail?: OrderItemQuantities | null
} & OrderItemQuantities

/**
 * Refuses a request for more of any item than `returnableQuantity` allows,
 * with the same error type core uses for its own quantity check, so the
 * client sees a 400. Items not on the order are left to core's validation,
 * which names them.
 */
export function assertReturnableQuantities(
  orderItems: ReturnableItem[],
  requested: { id: string; quantity: number }[]
): void {
  for (const want of requested) {
    const item = orderItems.find((i) => i.id === want.id)
    if (!item) continue
    const available = returnableQuantity(item.detail ?? item)
    if (want.quantity > available) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        available === 0
          ? `Item ${want.id} has no units left to return: they are already requested, received or dismissed.`
          : `Cannot request to return more than ${available} of item ${want.id}: the rest is already requested, received or dismissed.`
      )
    }
  }
}
