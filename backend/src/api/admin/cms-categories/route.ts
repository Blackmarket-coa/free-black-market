import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils"
import { CMS_BLUEPRINT_MODULE, CmsBlueprintServiceType } from "../../../modules/cms-blueprint"

/**
 * GET /admin/cms-categories
 * List all CMS categories with optional filtering
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { type_id } = req.query as { type_id?: string }

  const filters: Record<string, unknown> = {
    deleted_at: null,
  }

  if (type_id) {
    filters.type_id = type_id
  }

  const { data: categories } = await query.graph({
    entity: "cms_category",
    fields: [
      "id",
      "type_id",
      "handle",
      "name",
      "description",
      "icon",
      "image_url",
      "display_order",
      "is_active",
      "metadata",
      "created_at",
      "updated_at",
    ],
    filters,
  })

  // Sort by display_order
  const sortedCategories = categories.sort((a, b) => a.display_order - b.display_order)

  return res.json({
    categories: sortedCategories,
    count: sortedCategories.length,
  })
}

/**
 * POST /admin/cms-categories
 * Create a new CMS category
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cmsBlueprintService = req.scope.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  const { type_id, handle, name, description, icon, image_url, display_order, is_active, metadata } = req.body as {
    type_id: string
    handle: string
    name: string
    description?: string
    icon?: string
    image_url?: string
    display_order?: number
    is_active?: boolean
    metadata?: Record<string, unknown>
  }

  const category = await cmsBlueprintService.createCmsCategories({
    id: generateEntityId("", "cms_cat"),
    type_id,
    handle,
    name,
    description,
    icon,
    image_url,
    display_order: display_order ?? 0,
    is_active: is_active ?? true,
    metadata,
  })

  return res.status(201).json({ category })
}
