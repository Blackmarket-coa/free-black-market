import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"
import OrderCycleModuleService from "../../../modules/order-cycle/service"

interface CreateEnterpriseFeeBody {
  name: string
  description?: string
  fee_type: "admin" | "packing" | "transport" | "fundraising" | "sales" | "coordinator"
  calculator_type: "flat_rate" | "flat_per_item" | "percentage" | "weight"
  amount: number
  currency_code?: string
  tax_category_id?: string
  inherits_tax_category?: boolean
}

// GET /vendor/enterprise-fees - List enterprise fees for vendor
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const filters: Record<string, unknown> = { seller_id: sellerId }
    
    if (req.query.is_active !== undefined) {
      filters.is_active = req.query.is_active === "true"
    }

    const enterprise_fees = await orderCycleService.listEnterpriseFees(filters)
    res.json({ enterprise_fees, count: enterprise_fees.length })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch enterprise fees", error: error.message })
  }
}

// POST /vendor/enterprise-fees - Create enterprise fee
export const POST = async (req: MedusaRequest<CreateEnterpriseFeeBody>, res: MedusaResponse) => {
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { name, description, fee_type, calculator_type, amount, currency_code, tax_category_id, inherits_tax_category } = req.body

  try {
    const enterprise_fee = await orderCycleService.createEnterpriseFees({
      seller_id: sellerId,
      name,
      description,
      fee_type,
      calculator_type,
      amount,
      currency_code: currency_code || "usd",
      tax_category_id,
      inherits_tax_category: inherits_tax_category ?? true,
    })

    res.status(201).json({ enterprise_fee })
  } catch (error) {
    res.status(500).json({ message: "Failed to create enterprise fee", error: error.message })
  }
}
