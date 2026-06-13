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
    
    // Check if order has an order_cycle_id in metadata
    const metadata = order.metadata as Record<string, unknown> | null
    const orderCycleId = metadata?.order_cycle_id as string | undefined
    
    if (!orderCycleId) {
      // Order wasn't placed through an order cycle
      return
    }
    
    log.info(`[Order Cycle Subscriber] Order ${orderId} placed in cycle ${orderCycleId}`)
    
    // Verify the order cycle exists and is valid
    let orderCycle
    try {
      orderCycle = await orderCycleService.retrieveOrderCycle(orderCycleId)
    } catch {
      log.info(`[Order Cycle Subscriber] Order cycle ${orderCycleId} not found`)
      return
    }
    
    // Update sold quantities for each item
    const items = order.items as Array<{ variant_id: string; quantity: number }> | undefined
    
    for (const item of items || []) {
      const variantId = item.variant_id
      const quantity = item.quantity
      
      try {
        await orderCycleService.recordSale(orderCycleId, variantId, quantity)
        log.info(`[Order Cycle Subscriber] Recorded sale: ${quantity}x ${variantId}`)
      } catch (error) {
        // Product might not be in the cycle - that's okay
        log.info(`[Order Cycle Subscriber] Could not record sale for ${variantId}:`, error)
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
    
  } catch (error) {
    log.error(`[Order Cycle Subscriber] Error processing order ${orderId}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
