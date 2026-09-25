import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackstar-delivery-option-selected")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackstarEvent } from "../lib/blackstar-emit"
import {
  buildDeliveryOptionSelectedPayload,
  resolveBlackstarCoalitionRefs,
  resolveBlackstarOrigin,
} from "../lib/blackstar-delivery-payload"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../modules/blackstar-fulfillment/service"

/**
 * The contract's `delivery.option.selected` moment: a fulfillment was created
 * on the Blackstar provider. Records the local BlackstarShipment row, then
 * emits the event Blackstar builds its shipment board listing from
 * (idempotently, on `source_order_ref`).
 *
 * This used to happen inside the provider's `createFulfillment`, where it
 * could not work: Medusa constructs a fulfillment provider with the
 * fulfillment module's own container cradle, which holds only that module's
 * dependencies (logger, event bus, manager, config, pg connection, caching).
 * `this.container_.resolve` throws on a cradle and no FBM module is
 * registered there, so the row write and the emit each threw into their own
 * catch and nothing reached Blackstar. A subscriber runs with the application container, where the
 * blackstar-fulfillment module, the webhooks channel, `query` and the
 * order-cycle module all resolve.
 *
 * Gated on the fulfillment's provider, so it is inert unless the Blackstar
 * provider is registered (FBM_BLACKSTAR_INTEGRATION=1), and the emit itself
 * no-ops unless the outbound channel is configured.
 *
 * Origin coordinates and coalition refs are added only when FBM knows them;
 * see `lib/blackstar-delivery-payload.ts`. `created_by_user_id` is
 * deliberately absent — FBM has no Blackstar user identity to send, and
 * Blackstar owns the listing-side default.
 */
export default async function emitBlackstarDeliveryOptionSelected({
  event: { data },
  container,
}: SubscriberArgs<{ order_id?: string; fulfillment_id?: string }>) {
  const orderId = data?.order_id
  const fulfillmentId = data?.fulfillment_id
  if (!orderId || !fulfillmentId) return

  try {
    const query = container.resolve("query") as any
    const { data: fulfillments } = await query.graph({
      entity: "fulfillment",
      fields: ["id", "provider_id", "location_id", "data"],
      filters: { id: fulfillmentId },
    })
    const fulfillment = fulfillments?.[0]
    if (!fulfillment) return
    if (!String(fulfillment.provider_id ?? "").includes("blackstar")) return

    // The shipping method's data, which the provider hands back unchanged.
    const shippingData = (fulfillment.data ?? {}) as Record<string, unknown>
    const fulfillmentNodeId = asId(shippingData.fulfillment_node_id)
    const pickupPointId = asId(shippingData.pickup_point_id)
    const vendingMachineId = asId(shippingData.vending_machine_id)

    // Recorded before the emit, because `order.cancelled` is only sent for
    // orders with a row. Only on first sight — a redelivered event must not
    // rewind a status the bridge has since moved.
    try {
      const service = container.resolve<BlackstarFulfillmentModuleService>(
        BLACKSTAR_FULFILLMENT_MODULE
      )
      const [existing] = await service.listBlackstarShipments({
        order_id: orderId,
        fulfillment_id: fulfillmentId,
      })
      if (!existing) {
        await service.recordOrUpdateShipment({
          order_id: orderId,
          fulfillment_id: fulfillmentId,
          fulfillment_node_id: fulfillmentNodeId,
          pickup_point_id: pickupPointId,
          vending_machine_id: vendingMachineId,
          external_status: "pending",
          metadata:
            (shippingData.metadata as Record<string, unknown> | undefined) ?? null,
        })
      }
    } catch (err) {
      log.error("[blackstar-fulfillment] failed to persist BlackstarShipment", err)
    }

    const [origin, coalition] = await Promise.all([
      resolveBlackstarOrigin(container, fulfillment.location_id ?? null),
      resolveBlackstarCoalitionRefs(container, orderId),
    ])

    await emitBlackstarEvent(
      container,
      "delivery.option.selected",
      buildDeliveryOptionSelectedPayload({
        orderId,
        fulfillmentNodeId,
        pickupPointId,
        vendingMachineId,
        origin,
        coalition,
      }),
      {
        eventId: `blackstar:delivery.option.selected:${orderId}:${fulfillmentId}`,
        correlationId: orderId,
      }
    )
  } catch (err) {
    log.error(
      `[emit-blackstar-delivery-option-selected] failed for order ${orderId}:`,
      err
    )
  }
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
