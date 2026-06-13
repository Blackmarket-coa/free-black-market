import { createLogger } from "../shared/logger"
const log = createLogger("jobs/order-cycle-status-update")
import { MedusaContainer } from "@medusajs/framework/types"
import { ORDER_CYCLE_MODULE } from "../modules/order-cycle"
import type OrderCycleModuleService from "../modules/order-cycle/service"

/**
 * Scheduled Job: Update Order Cycle Statuses
 * 
 * Runs periodically to automatically transition order cycles:
 * - upcoming/draft → open (when opens_at is reached)
 * - open → closed (when closes_at is reached)
 * 
 * Register this in medusa-config.ts under jobs array
 */

export default async function orderCycleStatusUpdateJob(
  container: MedusaContainer
) {
  const orderCycleService = container.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  
  log.info("[Order Cycle Job] Checking for status updates...")
  
  try {
    const results = await orderCycleService.updateOrderCycleStatuses()
    
    if (results.opened > 0 || results.closed > 0) {
      log.info(
        `[Order Cycle Job] Updated ${results.opened} cycles to open, ${results.closed} cycles to closed`
      )
    }
    
    return results
  } catch (error) {
    log.error("[Order Cycle Job] Error updating statuses:", error)
    throw error
  }
}

export const config = {
  name: "order-cycle-status-update",
  // Run every 5 minutes
  schedule: "*/5 * * * *",
}
