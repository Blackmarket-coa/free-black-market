import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../../modules/order-cycle/service"
import { resolveCycleAccess } from "../../../_access"

// DELETE /vendor/order-cycles/:id/fees/:feeId - Remove fee from order cycle
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, feeId } = req.params

  // Removing a fee changes settlement amounts — coordinator of the cycle only.
  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: true,
  })
  if (!access) return

  const orderCycleService: OrderCycleModuleService = req.scope.resolve(
    "orderCycleModuleService"
  )

  // The fee must belong to the cycle named in the path — the previous handler
  // deleted by global feeId while ignoring :id entirely.
  let fee: any
  try {
    fee = await orderCycleService.retrieveOrderCycleFee(feeId)
  } catch (_error) {
    res.status(404).json({ message: "Fee not found" })
    return
  }
  if (fee.order_cycle_id !== id) {
    res.status(404).json({ message: "Fee not found" })
    return
  }

  try {
    await orderCycleService.deleteOrderCycleFees(feeId)
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ message: "Failed to remove fee from order cycle", error: error.message })
  }
}
