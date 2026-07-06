import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { resolveCycleAccess } from "../../_access"

interface CreateExchangeBody {
  exchange_type: "incoming" | "outgoing"
  seller_id: string
  receiver_id?: string
  pickup_time?: string
  pickup_instructions?: string
  ready_at?: string
}

// GET /vendor/order-cycles/:id/exchanges - List exchanges
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return

  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    const incoming = await orderCycleService.listOrderCycleExchanges({
      order_cycle_id: id,
      exchange_type: "incoming",
    })

    const outgoing = await orderCycleService.listOrderCycleExchanges({
      order_cycle_id: id,
      exchange_type: "outgoing",
    })

    res.json({ incoming, outgoing })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch exchanges", error: error.message })
  }
}

// POST /vendor/order-cycles/:id/exchanges - Create exchange
export const POST = async (req: MedusaRequest<CreateExchangeBody>, res: MedusaResponse) => {
  const { id } = req.params
  const { exchange_type, seller_id, receiver_id, pickup_time, pickup_instructions, ready_at } = req.body

  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return

  // Coordinators may create exchanges on behalf of any participant; a plain
  // participant may only create their own exchange. Never trust a body-supplied
  // seller_id from a non-coordinator (that was the impersonation vector).
  const effectiveSellerId = access.isCoordinator
    ? seller_id || access.sellerId
    : access.sellerId

  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    const exchange = await orderCycleService.createOrderCycleExchanges({
      order_cycle_id: id,
      exchange_type,
      seller_id: effectiveSellerId,
      receiver_id,
      pickup_time,
      pickup_instructions,
      ready_at: ready_at ? new Date(ready_at) : undefined,
    })

    res.status(201).json({ exchange })
  } catch (error) {
    res.status(500).json({ message: "Failed to create exchange", error: error.message })
  }
}
