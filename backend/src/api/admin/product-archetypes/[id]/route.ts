import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCT_ARCHETYPE_MODULE } from "../../../../modules/product-archetype"
import ProductArchetypeService from "../../../../modules/product-archetype/service"

/**
 * GET /admin/product-archetypes/:id
 * 
 * Get a product archetype by ID.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: archetypes } = await query.graph({
    entity: "product_archetype",
    fields: ["*"],
    filters: {
      id,
    },
  })

  if (!archetypes || archetypes.length === 0) {
    return res.status(404).json({
      message: `Product archetype ${id} not found`,
    })
  }

  return res.json({
    product_archetype: archetypes[0],
  })
}

/**
 * PUT /admin/product-archetypes/:id
 * 
 * Update a product archetype.
 */
export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  
  const productArchetypeService: ProductArchetypeService = req.scope.resolve(
    PRODUCT_ARCHETYPE_MODULE
  )

  const body = req.body as unknown as {
    name?: string
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

  const updated = await productArchetypeService.updateProductArchetypes(
    { id },
    body
  )

  return res.json({
    product_archetype: updated,
  })
}

/**
 * DELETE /admin/product-archetypes/:id
 * 
 * Delete a product archetype.
 */
export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  
  const productArchetypeService: ProductArchetypeService = req.scope.resolve(
    PRODUCT_ARCHETYPE_MODULE
  )

  await productArchetypeService.deleteProductArchetypes(id)

  return res.status(200).json({
    id,
    object: "product_archetype",
    deleted: true,
  })
}
