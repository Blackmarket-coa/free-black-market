import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CMS_BLUEPRINT_MODULE, CmsBlueprintServiceType } from "../../../../modules/cms-blueprint"

/**
 * GET /admin/cms-types/:id
 * Get a single CMS type with its categories
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: types } = await query.graph({
    entity: "cms_type",
    fields: [
      "id",
      "handle",
      "name",
      "description",
      "icon",
      "display_order",
      "is_active",
      "metadata",
      "created_at",
      "updated_at",
    ],
    filters: {
      id,
      deleted_at: null,
    },
  })

  if (!types || types.length === 0) {
    return res.status(404).json({ message: "CMS type not found" })
  }

  // Get categories for this type
  const { data: categories } = await query.graph({
    entity: "cms_category",
    fields: [
      "id",
      "handle",
      "name",
      "description",
      "icon",
      "image_url",
      "display_order",
      "is_active",
    ],
    filters: {
      type_id: id,
      deleted_at: null,
    },
  })

  const sortedCategories = categories.sort((a, b) => a.display_order - b.display_order)

  return res.json({
    type: {
      ...types[0],
      categories: sortedCategories,
    },
  })
}

/**
 * PUT /admin/cms-types/:id
 * Update a CMS type
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const cmsBlueprintService = req.scope.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  const { handle, name, description, icon, display_order, is_active, metadata } = req.body as {
    handle?: string
    name?: string
    description?: string
    icon?: string
    display_order?: number
    is_active?: boolean
    metadata?: Record<string, unknown>
  }

  const type = await cmsBlueprintService.updateCmsTypes({
    id,
    handle,
    name,
    description,
    icon,
    display_order,
    is_active,
    metadata,
  })

  return res.json({ type })
}

/**
 * DELETE /admin/cms-types/:id
 * Soft delete a CMS type
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const cmsBlueprintService = req.scope.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  await cmsBlueprintService.softDeleteCmsTypes(id)

  return res.status(200).json({
    id,
    deleted: true,
  })
}
