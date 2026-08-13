import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackstar-order-cancel")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackstarEvent } from "../lib/blackstar-emit"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../modules/blackstar-fulfillment/service"

/**
 * Emit Blackstar's `order.cancelled` when an order with a Blackstar shipment
 * on record is canceled, so Blackstar can cancel the matching shipment board
 * listing (its processor cancels only from open|claimed|in_transit — anything
 * later is its call, not ours).
 *
 * Gate: a BlackstarShipment row for the order. That row exists precisely when
 * the Blackstar path was engaged, which is a sharper signal than re-deriving
 * shipping-option provenance at cancel time.
 */
export default async function emitBlackstarOrderCancel({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  try {
    const service = container.resolve<BlackstarFulfillmentModuleService>(
      BLACKSTAR_FULFILLMENT_MODULE
    )
    const shipments = await service.listBlackstarShipments({ order_id: orderId })
    if (!shipments || shipments.length === 0) return

    await emitBlackstarEvent(
      container,
      "order.cancelled",
      { source_order_ref: orderId },
      {
        eventId: `blackstar:order.cancelled:${orderId}`,
        correlationId: orderId,
      }
    )
  } catch (err) {
    log.error(`[emit-blackstar-order-cancel] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
