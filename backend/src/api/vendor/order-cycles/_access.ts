import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import type { VendorRequest } from "../types"

export type CycleAccess = {
  sellerId: string
  orderCycle: any
  isCoordinator: boolean
}

/**
 * Resolve the authenticated seller and verify they may act on the given order
 * cycle. On denial this sends the appropriate 401/403/404 response and returns
 * `null`, so callers use the pattern:
 *
 *   const access = await resolveCycleAccess(req, res, id, { requireCoordinator })
 *   if (!access) return
 *
 * This centralizes the object-level authorization the child routes (exchanges,
 * fees) previously lacked — they had only the generic `/vendor/**` seller
 * authentication and would read/write/delete another vendor's cycle records.
 * Mirrors the gate already inlined in `order-cycles/[id]/route.ts`.
 *
 * - `requireCoordinator: true`  → only the cycle's `coordinator_seller_id`
 *   passes (create/update/delete of cycle children).
 * - `requireCoordinator: false` → coordinator OR an active participant passes
 *   (reads).
 */
export async function resolveCycleAccess(
  req: MedusaRequest,
  res: MedusaResponse,
  cycleId: string,
  opts: { requireCoordinator: boolean }
): Promise<CycleAccess | null> {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
    ORDER_CYCLE_MODULE
  )

  let orderCycle: any
  try {
    orderCycle = await orderCycleService.retrieveOrderCycle(cycleId)
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
    return null
  }

  const isCoordinator = orderCycle.coordinator_seller_id === sellerId

  if (opts.requireCoordinator) {
    if (!isCoordinator) {
      res.status(403).json({
        message: "Only the coordinator can modify this order cycle",
      })
      return null
    }
  } else {
    const sellers = await orderCycleService.listOrderCycleSellers({
      order_cycle_id: cycleId,
    })
    const isParticipant = (sellers ?? []).some(
      (s: any) => s.seller_id === sellerId && s.is_active
    )
    if (!isCoordinator && !isParticipant) {
      res.status(403).json({ message: "Access denied" })
      return null
    }
  }

  return { sellerId, orderCycle, isCoordinator }
}
