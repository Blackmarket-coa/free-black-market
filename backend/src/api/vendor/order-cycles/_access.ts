import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import type { VendorRequest } from "../types"

type OrderCycleRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveOrderCycle"]>
>
type OrderCycleSellerRecord = Awaited<
  ReturnType<OrderCycleModuleService["listOrderCycleSellers"]>
>[number]
type OrderCycleExchangeRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveOrderCycleExchange"]>
>

export type CycleAccess = {
  sellerId: string
  orderCycle: OrderCycleRecord
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

  let orderCycle: OrderCycleRecord
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
      (s: OrderCycleSellerRecord) => s.seller_id === sellerId && s.is_active
    )
    if (!isCoordinator && !isParticipant) {
      res.status(403).json({ message: "Access denied" })
      return null
    }
  }

  return { sellerId, orderCycle, isCoordinator }
}

/**
 * Resolve access to one exchange inside a cycle.
 *
 * Three checks, and a child route needs all three: the caller may act on the
 * cycle at all; the exchange named in the path really belongs to that cycle
 * (otherwise a mismatched `:id`/`:exchangeId` pair acts on another cycle's
 * exchange); and, for writes, the caller is the cycle's coordinator or the
 * exchange's own seller.
 *
 * This lived as a private helper in `exchanges/[exchangeId]/route.ts` while
 * its own child route `exchanges/[exchangeId]/products` had no gate at all —
 * so any authenticated seller could read another coordinator's exchange
 * products and insert rows into their cycle. It is shared from here now so a
 * new child route cannot be added without a gate in reach.
 */
export async function resolveExchangeAccess(
  req: MedusaRequest,
  res: MedusaResponse,
  requireCoordinator: boolean
): Promise<{ access: CycleAccess; exchange: OrderCycleExchangeRecord } | null> {
  const { id, exchangeId } = req.params

  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return null

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
    ORDER_CYCLE_MODULE
  )

  let exchange: OrderCycleExchangeRecord
  try {
    exchange = await orderCycleService.retrieveOrderCycleExchange(exchangeId)
  } catch (_error) {
    res.status(404).json({ message: "Exchange not found" })
    return null
  }

  // The exchange must belong to the cycle named in the path.
  if (exchange.order_cycle_id !== id) {
    res.status(404).json({ message: "Exchange not found" })
    return null
  }

  const isOwner = exchange.seller_id === access.sellerId
  if (requireCoordinator && !access.isCoordinator && !isOwner) {
    // Writes: coordinator or the exchange's own seller.
    res.status(403).json({ message: "Access denied" })
    return null
  }
  // Reads are already satisfied by the cycle participant/coordinator check.

  return { access, exchange }
}
