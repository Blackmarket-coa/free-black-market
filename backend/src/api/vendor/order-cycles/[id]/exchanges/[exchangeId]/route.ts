import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../../modules/order-cycle/service"
import { resolveExchangeAccess } from "../../../_access"

interface UpdateExchangeBody {
  pickup_time?: string
  pickup_instructions?: string
  ready_at?: string
  is_active?: boolean
}

/**
 * One exchange of an order cycle. Every handler gates on
 * `resolveExchangeAccess` (shared from `order-cycles/_access.ts`), which
 * checks cycle access, that the exchange belongs to the `:id` in the path,
 * and — for writes — coordinator or exchange-owner.
 */

// GET /vendor/order-cycles/:id/exchanges/:exchangeId
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const loaded = await resolveExchangeAccess(req, res, false)
  if (!loaded) return
  res.json({ exchange: loaded.exchange })
}

// PUT /vendor/order-cycles/:id/exchanges/:exchangeId
export const PUT = async (req: MedusaRequest<UpdateExchangeBody>, res: MedusaResponse) => {
  const { exchangeId } = req.params
  const { pickup_time, pickup_instructions, ready_at, is_active } = req.body

  const loaded = await resolveExchangeAccess(req, res, true)
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

  const loaded = await resolveExchangeAccess(req, res, true)
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
