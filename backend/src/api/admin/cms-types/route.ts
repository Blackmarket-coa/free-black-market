import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils"
import { CMS_BLUEPRINT_MODULE, CmsBlueprintServiceType } from "../../../modules/cms-blueprint"

/**
 * GET /admin/cms-types
 * List all CMS types with optional filtering
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
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
      deleted_at: null,
    },
  })

  // Sort by display_order
  const sortedTypes = types.sort((a, b) => a.display_order - b.display_order)

  return res.json({
    types: sortedTypes,
    count: sortedTypes.length,
  })
}

/**
 * POST /admin/cms-types
 * Create a new CMS type
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cmsBlueprintService = req.scope.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  const { handle, name, description, icon, display_order, is_active, metadata } = req.body as {
    handle: string
    name: string
    description?: string
    icon?: string
    display_order?: number
    is_active?: boolean
    metadata?: Record<string, unknown>
  }

  const type = await cmsBlueprintService.createCmsTypes({
    id: generateEntityId("", "cms_type"),
    handle,
    name,
    description,
    icon,
    display_order: display_order ?? 0,
    is_active: is_active ?? true,
    metadata,
  })

  return res.status(201).json({ type })
}
