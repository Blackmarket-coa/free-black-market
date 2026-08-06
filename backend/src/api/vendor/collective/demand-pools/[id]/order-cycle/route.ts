import { createLogger } from "../../../../../../shared/logger"
import type { VendorRequest } from "../../../../types"
const log = createLogger("api/vendor/collective/demand-pools/[id]/order-cycle")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"
import { ORDER_CYCLE_MODULE } from "../../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../../modules/order-cycle/service"

const schema = z.object({
  order_cycle_id: z.string().min(1),
})

/**
 * POST /vendor/collective/demand-pools/:id/order-cycle
 *
 * Turn a one-off group buy into a standing relationship by pointing it at an
 * order cycle you coordinate.
 *
 * Two ownership checks, because two different things could be captured:
 * the demand pool (only its selected supplier may hand it over — anyone else
 * would be taking a buyer group they did not win) and the order cycle (only
 * its coordinator may attach it — otherwise a seller could point demand at
 * someone else's window).
 *
 * The cross-module check lives here rather than in either service: the modules
 * stay independent of each other, and the route is where they compose.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = schema.parse(req.body)
    const sellerId = (req as VendorRequest).auth_context?.actor_id
    if (!sellerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
      ORDER_CYCLE_MODULE
    )
    const cycles = await orderCycleService.listOrderCycles({
      id: body.order_cycle_id,
    })
    if (cycles.length === 0) {
      return res.status(404).json({ error: "Order cycle not found" })
    }
    if (cycles[0].coordinator_seller_id !== sellerId) {
      return res
        .status(403)
        .json({ error: "Only the coordinator of that order cycle can link it" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )
    const demand_pool = await demandPoolService.linkOrderCycle(
      id,
      body.order_cycle_id,
      sellerId
    )

    res.json({
      demand_pool,
      message: "Demand pool is now served by a standing order cycle",
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message =
      error instanceof Error ? error.message : "Failed to link order cycle"
    log.error(
      `[POST /vendor/collective/demand-pools/${id}/order-cycle] Error:`,
      message
    )
    const notFound = /not found/i.test(message)
    const forbidden = /only the selected supplier/i.test(message)
    res.status(notFound ? 404 : forbidden ? 403 : 400).json({ error: message })
  }
}
