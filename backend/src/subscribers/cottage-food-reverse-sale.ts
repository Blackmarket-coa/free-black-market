import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/cottage-food-reverse-sale")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { COTTAGE_FOOD_MODULE } from "../modules/cottage-food"
import type CottageFoodModuleService from "../modules/cottage-food/service"
import {
  resolveSellerTotalsForOrder,
  orderSourceId,
} from "../modules/cottage-food/utils/order-lines"

/**
 * Back a cancelled or refunded order out of the cottage-food ledger.
 *
 * Appends a compensating negative entry rather than deleting the original, so
 * the ledger remains a history of what was counted and when — the form a
 * permit renewal or a health inspector actually asks for. `reverseSale` is a
 * no-op when the original was never recorded or has already been reversed.
 *
 * The order's sellers are re-resolved from the order itself, which still
 * exists at cancel/refund time, so the reversal targets exactly the entries
 * the placement handler wrote.
 */
export default async function cottageFoodReverseSale({
  event,
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const orderId = event.data.order_id ?? event.data.id
  try {
    const service = container.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
    const totals = await resolveSellerTotalsForOrder(container, orderId)

    for (const total of totals) {
      await service.reverseSale(
        "medusa_order",
        orderSourceId(orderId, total.seller_id)
      )
    }
  } catch (error) {
    log.error(
      `[cottage-food-reverse-sale] failed for order ${orderId}:`,
      error
    )
  }
}

export const config: SubscriberConfig = {
  event: ["order.canceled", "order.refund_created"],
}
