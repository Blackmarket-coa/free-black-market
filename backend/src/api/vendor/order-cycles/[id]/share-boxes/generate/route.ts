import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../../modules/order-cycle/service"
import { resolveCycleAccess } from "../../../_access"

/**
 * POST /vendor/order-cycles/:id/share-boxes/generate
 *
 * Materialize one box per eligible subscription for this cycle.
 *
 * Safe to call twice: `generateBoxesForCycle` looks for an existing box on
 * (subscription, cycle) and reuses it, which is what the model's UNIQUE
 * (`share_box_subscription_id`, `order_cycle_id`) index requires. The result
 * reports `generated` and `reused` separately so a coordinator re-running it
 * after adding subscribers can see what actually changed.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const access = await resolveCycleAccess(req, res, req.params.id, {
    requireCoordinator: true,
  })
  if (!access) return

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const result = await service.generateBoxesForCycle(req.params.id)
    res.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    // The service refuses outright on a cancelled cycle. That is the caller's
    // state, not a server fault, so it is a 409 rather than a 500.
    if (message.includes("cancelled cycle")) {
      return res.status(409).json({ message })
    }
    res.status(500).json({ message })
  }
}
