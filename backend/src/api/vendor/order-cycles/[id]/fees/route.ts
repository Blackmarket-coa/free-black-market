import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../modules/order-cycle/service"

interface ApplyFeeBody {
  enterprise_fee_id: string
  application_type: "coordinator" | "incoming" | "outgoing"
  target_seller_id?: string
}

// GET /vendor/order-cycles/:id/fees - List fees for order cycle
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    const fees = await orderCycleService.listOrderCycleFees({
      order_cycle_id: id,
    })

    // Fetch the enterprise fee details for each
    const feesWithDetails = await Promise.all(
      fees.map(async (fee) => {
        try {
          const enterprise_fee = await orderCycleService.retrieveEnterpriseFee(fee.enterprise_fee_id)
          return { ...fee, enterprise_fee }
        } catch {
          return fee
        }
      })
    )

    res.json({ fees: feesWithDetails })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch order cycle fees", error: error.message })
  }
}

// POST /vendor/order-cycles/:id/fees - Apply fee to order cycle
export const POST = async (req: MedusaRequest<ApplyFeeBody>, res: MedusaResponse) => {
  const { id } = req.params
  const { enterprise_fee_id, application_type, target_seller_id } = req.body
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    // Validate that incoming/outgoing fees have a target seller
    if ((application_type === "incoming" || application_type === "outgoing") && !target_seller_id) {
      return res.status(400).json({ 
        message: `${application_type} fees require a target_seller_id` 
      })
    }

    const fee = await orderCycleService.createOrderCycleFees({
      order_cycle_id: id,
      enterprise_fee_id,
      application_type,
      target_seller_id,
    })

    // Fetch enterprise fee details
    const enterprise_fee = await orderCycleService.retrieveEnterpriseFee(enterprise_fee_id)

    res.status(201).json({ fee: { ...fee, enterprise_fee } })
  } catch (error) {
    res.status(500).json({ message: "Failed to apply fee to order cycle", error: error.message })
  }
}
