import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCT_ARCHETYPE_MODULE } from "../../../modules/product-archetype"
import ProductArchetypeService from "../../../modules/product-archetype/service"

/**
 * GET /admin/product-archetypes
 * 
 * List all product archetypes.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: archetypes } = await query.graph({
    entity: "product_archetype",
    fields: ["*"],
  })

  return res.json({
    product_archetypes: archetypes,
  })
}

/**
 * POST /admin/product-archetypes
 * 
 * Create a custom product archetype.
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const productArchetypeService: ProductArchetypeService = req.scope.resolve(
    PRODUCT_ARCHETYPE_MODULE
  )

  const body = req.body as unknown as {
    code: string
    name: string
    description?: string
    inventory_strategy?: string
    requires_availability_window?: boolean
    supports_preorder?: boolean
    perishable?: boolean
    perishable_shelf_days?: number
    requires_shipping?: boolean
    supports_pickup?: boolean
    supports_delivery?: boolean
    fulfillment_lead_time_hours?: number
    refundable?: boolean
    return_window_days?: number
    tax_category?: string
    requires_lot_tracking?: boolean
    supports_surplus_pricing?: boolean
    requires_producer_link?: boolean
    metadata?: Record<string, unknown>
  }

  const archetype = await (
    productArchetypeService as unknown as {
      createProductArchetypes(data: Record<string, unknown>): Promise<unknown>
    }
  ).createProductArchetypes(body)

  return res.status(201).json({
    product_archetype: archetype,
  })
}
