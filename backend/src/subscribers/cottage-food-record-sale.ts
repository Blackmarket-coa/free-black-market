import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/cottage-food-record-sale")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { COTTAGE_FOOD_MODULE } from "../modules/cottage-food"
import type CottageFoodModuleService from "../modules/cottage-food/service"
import {
  resolveSellerTotalsForOrder,
  orderSourceId,
} from "../modules/cottage-food/utils/order-lines"

/**
 * Record a placed order against each participating seller's cottage-food
 * ledger.
 *
 * Two properties this handler must keep:
 *
 * 1. **It never affects the order.** Everything is wrapped in try/catch and the
 *    handler is purely additive. A seller past their declared cap still gets
 *    the sale — FBM's role is to count, not to gate. Nothing here is wired into
 *    cart validation, and this subscriber runs after the order already exists.
 *
 * 2. **It never double-counts.** `recordSale` is idempotent on
 *    `(source, source_id)`, with `source_id` scoped per seller, so a retried
 *    event can't inflate a compliance meter.
 *
 * Sellers with no cottage-food profile are skipped — the module is opt-in and
 * shouldn't accumulate rows for vendors who never enabled it.
 */
export default async function cottageFoodRecordSale({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const service = container.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
    const totals = await resolveSellerTotalsForOrder(container, data.id)
    if (!totals.length) return

    for (const total of totals) {
      const profile = await service.getProfileForSeller(total.seller_id)
      if (!profile) continue

      // "One meal" is the seller's own definition; line-item quantity is the
      // best default available and they can correct it on the entry. Only
      // meaningful for operations that sell cooked meals.
      const tracksMeals =
        profile.operation_type === "HOME_KITCHEN" ||
        profile.operation_type === "BOTH"

      await service.recordSale({
        seller_id: total.seller_id,
        source: "medusa_order",
        source_id: orderSourceId(data.id, total.seller_id),
        amount_cents: total.gross_cents,
        meal_count: tracksMeals ? total.quantity : 0,
        note: null,
        metadata: { order_id: data.id },
      })
    }
  } catch (error) {
    log.error(
      `[cottage-food-record-sale] failed for order ${data.id}:`,
      error
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
