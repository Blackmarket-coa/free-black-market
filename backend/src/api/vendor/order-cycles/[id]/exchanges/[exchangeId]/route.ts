import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../../modules/order-cycle/service"

interface UpdateExchangeBody {
  pickup_time?: string
  pickup_instructions?: string
  ready_at?: string
  is_active?: boolean
}

// GET /vendor/order-cycles/:id/exchanges/:exchangeId
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { exchangeId } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    const exchange = await orderCycleService.retrieveOrderCycleExchange(exchangeId)
    res.json({ exchange })
  } catch (_error) {
    res.status(404).json({ message: "Exchange not found" })
  }
}

// PUT /vendor/order-cycles/:id/exchanges/:exchangeId
export const PUT = async (req: MedusaRequest<UpdateExchangeBody>, res: MedusaResponse) => {
  const { exchangeId } = req.params
  const { pickup_time, pickup_instructions, ready_at, is_active } = req.body
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

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
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    await orderCycleService.deleteOrderCycleExchanges(exchangeId)
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete exchange", error: error.message })
  }
}
