import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../../modules/order-cycle/service"

// DELETE /vendor/order-cycles/:id/fees/:feeId - Remove fee from order cycle
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { feeId } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    await orderCycleService.deleteOrderCycleFees(feeId)
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ message: "Failed to remove fee from order cycle", error: error.message })
  }
}
