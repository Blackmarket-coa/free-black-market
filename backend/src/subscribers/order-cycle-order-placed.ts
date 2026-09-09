import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/order-cycle-order-placed")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_CYCLE_MODULE } from "../modules/order-cycle"
import type OrderCycleModuleService from "../modules/order-cycle/service"

/**
 * Subscriber: Track Order Cycle Sales
 *
 * When an order is placed, if it contains products from an order cycle:
 * - Update sold_quantity for each cycle product
 * - Link the order to the order cycle
 *
 * ## Where the cycle id comes from, and why it is per line item
 *
 * Each line item carries its own `metadata.order_cycle_id`. That is not a
 * stylistic choice — it is the only carrier that survives FBM's checkout.
 *
 * `@mercurjs/b2c-core` overrides `POST /store/carts/:id/complete` with
 * `splitAndCompleteCartWorkflow`, which builds its order payload by hand
 * (region, customer, items, shipping, promos) and never copies `cart.metadata`
 * onto the orders. It fetches the field and then drops it. Line-item metadata
 * it does carry: `prepareLineItemData({ ..., metadata: item?.metadata })`.
 *
 * Per item is also the better fit regardless. Mercur SPLITS one cart into one
 * order per seller, so a cart-level tag would be stamped onto every split
 * order; and `recordSale` is per variant anyway, so the item already is the
 * unit the cycle cares about. A cart holding two cycles now records correctly
 * instead of attributing everything to whichever tag was written last.
 *
 * `order.metadata.order_cycle_id` is still read as a fallback, for orders that
 * completed through a path which does propagate cart metadata (Medusa's own
 * `completeCartWorkflow`, which FBM's other completion routes wrap).
 */

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  const orderCycleService = container.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  
  log.info(`[Order Cycle Subscriber] Processing order ${orderId}`)
  
  try {
    // Get order with line items
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "items.*",
        "metadata",
      ],
      filters: {
        id: orderId,
      },
    })
    
    const order = orders[0]
    
    if (!order) {
      log.info(`[Order Cycle Subscriber] Order ${orderId} not found`)
      return
    }
    
    const orderMetadata = order.metadata as Record<string, unknown> | null
    const orderLevelCycleId =
      typeof orderMetadata?.order_cycle_id === "string"
        ? orderMetadata.order_cycle_id
        : undefined

    const items =
      (order.items as
        | Array<{
            variant_id: string
            quantity: number
            metadata?: Record<string, unknown> | null
          }>
        | undefined) || []

    // Group the items by the cycle each one names, falling back to an
    // order-level tag when a path propagated one.
    const byCycle = new Map<string, Array<{ variant_id: string; quantity: number }>>()

    for (const item of items) {
      const itemCycleId =
        typeof item.metadata?.order_cycle_id === "string"
          ? item.metadata.order_cycle_id
          : orderLevelCycleId

      if (!itemCycleId) continue

      const bucket = byCycle.get(itemCycleId)
      if (bucket) {
        bucket.push(item)
      } else {
        byCycle.set(itemCycleId, [item])
      }
    }

    if (byCycle.size === 0) {
      // Order wasn't placed through an order cycle
      return
    }

    for (const [orderCycleId, cycleItems] of byCycle) {
      log.info(`[Order Cycle Subscriber] Order ${orderId} placed in cycle ${orderCycleId}`)

      // Verify the order cycle exists and is valid
      try {
        await orderCycleService.retrieveOrderCycle(orderCycleId)
      } catch {
        log.info(`[Order Cycle Subscriber] Order cycle ${orderCycleId} not found`)
        continue
      }

      for (const item of cycleItems) {
        try {
          await orderCycleService.recordSale(orderCycleId, item.variant_id, item.quantity)
          log.info(
            `[Order Cycle Subscriber] Recorded sale: ${item.quantity}x ${item.variant_id}`
          )
        } catch (error) {
          // Product might not be in the cycle - that's okay
          log.info(
            `[Order Cycle Subscriber] Could not record sale for ${item.variant_id}:`,
            error
          )
        }
      }

      // Link order to order cycle using remote link
      try {
        await remoteLink.create({
          "order": {
            order_id: orderId,
          },
          [ORDER_CYCLE_MODULE]: {
            order_cycle_id: orderCycleId,
          },
        })
        log.info(`[Order Cycle Subscriber] Linked order ${orderId} to cycle ${orderCycleId}`)
      } catch (error) {
        log.info(`[Order Cycle Subscriber] Could not link order:`, error)
      }
    }
    
  } catch (error) {
    log.error(`[Order Cycle Subscriber] Error processing order ${orderId}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
