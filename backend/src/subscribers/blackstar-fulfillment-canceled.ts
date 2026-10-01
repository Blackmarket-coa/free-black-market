import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/blackstar-fulfillment-canceled")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackstarEvent } from "../lib/blackstar-emit"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../modules/blackstar-fulfillment/service"
import { decideStatusWrite } from "../modules/blackstar-fulfillment/shipment-lifecycle"

type ShipmentRow = {
  id: string
  fulfillment_id?: string | null
  external_status?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * A fulfillment on the Blackstar provider was canceled: mark its
 * BlackstarShipment row `cancelled`, and when that leaves the order with no
 * live Blackstar shipment, tell Blackstar with `order.cancelled`.
 *
 * This used to be the provider's `cancelFulfillment`, where it could not
 * work: Medusa constructs a fulfillment provider with the fulfillment
 * module's own container cradle, where the blackstar-fulfillment module does
 * not resolve (see `modules/blackstar-fulfillment-provider/service.ts`). It
 * logged an error and returned without touching the row. A subscriber runs
 * with the application container, like
 * `emit-blackstar-delivery-option-selected.ts` on the create side.
 *
 * Gated on FBM_BLACKSTAR_INTEGRATION=1 and on a BlackstarShipment row for
 * this fulfillment — the row exists precisely when the fulfillment went
 * through the Blackstar provider. The status write goes through the same
 * ordering guard the inbound bridge uses, so a shipment Blackstar already
 * cancelled or disputed is left alone. A shipment Blackstar reported
 * `delivered` is left alone too: a local cancel cannot unmake a delivery, and
 * overwriting it would hide that the parcel arrived.
 *
 * Why the emit is conditional: contract v1 has no per-fulfillment cancel.
 * Blackstar keeps one shipment board listing per `source_order_ref` and
 * cancels it on `order.cancelled` (only from open|claimed|in_transit —
 * `InboundEventProcessor::applyEvent`). So the event is sent only once every
 * Blackstar shipment on the order is cancelled; while another Blackstar
 * fulfillment on the order is still live, cancelling the listing would
 * strand it. The event id is the one `emit-blackstar-order-cancel.ts` uses,
 * so when the whole order is canceled next (Medusa cancels its fulfillments
 * first) the outbound queue and Blackstar's receipt table both dedupe it.
 */
export default async function blackstarFulfillmentCanceled({
  event: { data },
  container,
}: SubscriberArgs<{ order_id?: string; fulfillment_id?: string }>) {
  if (process.env.FBM_BLACKSTAR_INTEGRATION !== "1") return

  const orderId = data?.order_id
  const fulfillmentId = data?.fulfillment_id
  if (!orderId || !fulfillmentId) return

  try {
    const service = container.resolve<BlackstarFulfillmentModuleService>(
      BLACKSTAR_FULFILLMENT_MODULE
    )
    const rows = ((await service.listBlackstarShipments({
      order_id: orderId,
    })) ?? []) as unknown as ShipmentRow[]

    const targets = rows.filter((row) => row.fulfillment_id === fulfillmentId)
    if (targets.length === 0) return

    const cancelledAt = new Date().toISOString()
    const cancelledIds = new Set<string>()
    for (const row of targets) {
      if (row.external_status === "delivered") {
        log.info(
          `[blackstar-fulfillment] cancel: shipment ${row.id} is delivered; leaving it`
        )
        continue
      }
      const decision = decideStatusWrite(row.external_status, "cancelled")
      if (!decision.apply) {
        log.info(
          `[blackstar-fulfillment] cancel: shipment ${row.id} is ${row.external_status}; not rewriting (${decision.reason})`
        )
        continue
      }
      await service.updateBlackstarShipments([
        {
          id: row.id,
          external_status: "cancelled",
          metadata: {
            ...(row.metadata ?? {}),
            cancelled_locally_at: cancelledAt,
            cancelled_via: "order.fulfillment_canceled",
          },
        },
      ])
      cancelledIds.add(row.id)
    }

    const orderHasLiveShipment = rows.some(
      (row) => !cancelledIds.has(row.id) && row.external_status !== "cancelled"
    )
    if (orderHasLiveShipment) return

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
    log.error(
      `[blackstar-fulfillment-canceled] failed for order ${orderId} fulfillment ${fulfillmentId}:`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_canceled",
}
