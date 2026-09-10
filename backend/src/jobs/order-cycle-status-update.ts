import { createLogger } from "../shared/logger"
const log = createLogger("jobs/order-cycle-status-update")
import { MedusaContainer } from "@medusajs/framework/types"
import { ORDER_CYCLE_MODULE } from "../modules/order-cycle"
import type OrderCycleModuleService from "../modules/order-cycle/service"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import {
  countCycleOrders,
  cycleEventTypeFor,
  toBlackoutCycleFields,
} from "../lib/blackout-cycle"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Scheduled Job: Update Order Cycle Statuses
 *
 * Runs periodically to automatically transition order cycles:
 * - upcoming/draft → open (when opens_at is reached)
 * - open → closed (when closes_at is reached)
 *
 * It also announces each transition to Blackout as §3 `cycle.open` /
 * `cycle.close`, which is what puts a CSA cycle opening in front of its
 * members in the vendor's announcement room.
 *
 * That announcement lives here rather than in `PlantShipWindowService`, which
 * is where it used to be and where it never once ran: this job calls the module
 * service directly, so `syncCycleStatuses` — the method holding the old emit —
 * had no callers at all. The emit belongs on the path that actually runs.
 */
export default async function orderCycleStatusUpdateJob(
  container: MedusaContainer
) {
  const orderCycleService = container.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  log.info("[Order Cycle Job] Checking for status updates...")

  try {
    const results = await orderCycleService.updateOrderCycleStatuses(
      async (cycle, to) => {
        const type = cycleEventTypeFor(to)
        if (!type) return

        const fields = toBlackoutCycleFields(cycle)
        if (!fields) {
          // Blackout rejects an event without vendorId/cycleId/name, so
          // enqueuing one only produces a delivery that cannot succeed.
          log.warn(
            `[Order Cycle Job] skipping ${type} for cycle ${String(cycle.id)}: incomplete row`
          )
          return
        }

        // `ordersPlaced` only means anything on a close: a cycle that has
        // just opened has had no chance to take orders, so announcing "0
        // order(s) placed" there would read as a result rather than a start.
        // Blackout renders the clause on `cycle.close` only, too.
        if (type === "cycle.close") {
          const ordersPlaced = await countCycleOrders(
            container.resolve(ContainerRegistrationKeys.QUERY),
            fields.cycleId
          )
          if (ordersPlaced !== undefined) {
            fields.ordersPlaced = ordersPlaced
          }
        }

        // Stable id: the same transition retried is the same event. The old
        // emit used Date.now(), which defeats the delivery layer's dedupe.
        await emitBlackoutEvent(container, type, fields, {
          eventId: `${type}:${fields.cycleId}`,
        })
      }
    )

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
