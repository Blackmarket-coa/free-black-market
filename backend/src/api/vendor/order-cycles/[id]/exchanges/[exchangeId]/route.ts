import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../../modules/order-cycle/service"
import { resolveCycleAccess } from "../../../_access"

interface UpdateExchangeBody {
  pickup_time?: string
  pickup_instructions?: string
  ready_at?: string
  is_active?: boolean
}

/**
 * Load the exchange and verify it belongs to the `id` cycle and that the caller
 * may act on it (coordinator of the cycle, or the exchange's own seller). On
 * denial the appropriate response is sent and `null` is returned.
 */
async function loadAuthorizedExchange(
  req: MedusaRequest,
  res: MedusaResponse,
  requireCoordinator: boolean
): Promise<{ exchange: any } | null> {
  const { id, exchangeId } = req.params

  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return null

  const orderCycleService: OrderCycleModuleService = req.scope.resolve(
    "orderCycleModuleService"
  )

  let exchange: any
  try {
    exchange = await orderCycleService.retrieveOrderCycleExchange(exchangeId)
  } catch (_error) {
    res.status(404).json({ message: "Exchange not found" })
    return null
  }

  // The exchange must belong to the cycle named in the path (prevents acting on
  // another cycle's exchange via a mismatched :id/:exchangeId pair).
  if (exchange.order_cycle_id !== id) {
    res.status(404).json({ message: "Exchange not found" })
    return null
  }

  const isOwner = exchange.seller_id === access.sellerId
  if (requireCoordinator) {
    // Writes: coordinator or the exchange's own seller.
    if (!access.isCoordinator && !isOwner) {
      res.status(403).json({ message: "Access denied" })
      return null
    }
  }
  // Reads already satisfied by cycle participant/coordinator access above.

  return { exchange }
}

// GET /vendor/order-cycles/:id/exchanges/:exchangeId
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const loaded = await loadAuthorizedExchange(req, res, false)
  if (!loaded) return
  res.json({ exchange: loaded.exchange })
}

// PUT /vendor/order-cycles/:id/exchanges/:exchangeId
export const PUT = async (req: MedusaRequest<UpdateExchangeBody>, res: MedusaResponse) => {
  const { exchangeId } = req.params
  const { pickup_time, pickup_instructions, ready_at, is_active } = req.body

  const loaded = await loadAuthorizedExchange(req, res, true)
  if (!loaded) return

  const orderCycleService: OrderCycleModuleService = req.scope.resolve(
    "orderCycleModuleService"
  )

  try {
    const exchange = await orderCycleService.updateOrderCycleExchanges({
      id: exchangeId,
      pickup_time,
      pickup_instructions,
      ready_at: ready_at ? new Date(ready_at) : undefined,
      is_active,
    })

    res.json({ exchange })
  } catch (error) {
    res.status(500).json({ message: "Failed to update exchange", error: error.message })
  }
}

// DELETE /vendor/order-cycles/:id/exchanges/:exchangeId
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { exchangeId } = req.params

  const loaded = await loadAuthorizedExchange(req, res, true)
  if (!loaded) return

  const orderCycleService: OrderCycleModuleService = req.scope.resolve(
    "orderCycleModuleService"
  )

  try {
    await orderCycleService.deleteOrderCycleExchanges(exchangeId)
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete exchange", error: error.message })
  }
}
