import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"
import OrderCycleModuleService from "../../../../modules/order-cycle/service"
import { getSellerId } from "../../quests/_helpers"
import { definedFields } from "../../../../shared/defined-fields"

interface UpdateEnterpriseFeeBody {
  name?: string
  description?: string
  fee_type?: "admin" | "packing" | "transport" | "fundraising" | "sales" | "coordinator"
  calculator_type?: "flat_rate" | "flat_per_item" | "percentage" | "weight"
  amount?: number
  currency_code?: string
  is_active?: boolean
}

// GET /vendor/enterprise-fees/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve(ORDER_CYCLE_MODULE)
  const sellerId = await getSellerId(req)

  try {
    const enterprise_fee = await orderCycleService.retrieveEnterpriseFee(id)
    
    // Verify ownership
    if (enterprise_fee.seller_id !== sellerId) {
      return res.status(403).json({ message: "Forbidden" })
    }

    res.json({ enterprise_fee })
  } catch (_error) {
    res.status(404).json({ message: "Enterprise fee not found" })
  }
}

// PUT /vendor/enterprise-fees/:id
export const PUT = async (req: MedusaRequest<UpdateEnterpriseFeeBody>, res: MedusaResponse) => {
  const { id } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve(ORDER_CYCLE_MODULE)
  const sellerId = await getSellerId(req)

  try {
    // Verify ownership
    const existing = await orderCycleService.retrieveEnterpriseFee(id)
    if (existing.seller_id !== sellerId) {
      return res.status(403).json({ message: "Forbidden" })
    }

    const { name, description, fee_type, calculator_type, amount, currency_code, is_active } = req.body

    // Only the fields given: an omitted one passed as undefined made every
    // partial update a 500 (`shared/defined-fields.ts`).
    const enterprise_fee = await orderCycleService.updateEnterpriseFees({
      id,
      ...definedFields({ name, description, fee_type, calculator_type, amount, currency_code, is_active }),
    })

    res.json({ enterprise_fee })
  } catch (error) {
    res.status(500).json({ message: "Failed to update enterprise fee", error: error.message })
  }
}

// DELETE /vendor/enterprise-fees/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve(ORDER_CYCLE_MODULE)
  const sellerId = await getSellerId(req)

  try {
    // Verify ownership
    const existing = await orderCycleService.retrieveEnterpriseFee(id)
    if (existing.seller_id !== sellerId) {
      return res.status(403).json({ message: "Forbidden" })
    }

    await orderCycleService.deleteEnterpriseFees(id)
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete enterprise fee", error: error.message })
  }
}
