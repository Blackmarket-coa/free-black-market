import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CMS_BLUEPRINT_MODULE, CmsBlueprintServiceType } from "../../../modules/cms-blueprint"
import { TagType } from "../../../modules/cms-blueprint/models/cms-tag"

/**
 * GET /admin/cms-tags
 * List all CMS tags with optional filtering
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { tag_type, category_id } = req.query as { tag_type?: string; category_id?: string }

  const filters: Record<string, any> = {
    deleted_at: null,
  }

  if (tag_type) {
    filters.tag_type = tag_type
  }


  if (category_id) {
    // Get tags for a specific category
    const { data: categoryTags } = await query.graph({
      entity: "cms_category_tag",
      fields: ["tag_id"],
      filters: {
        category_id,
        deleted_at: null,
      },
    })

    const tagIds = categoryTags.map((ct: any) => ct.tag_id)

    if (tagIds.length === 0) {
      return res.json({ tags: [], count: 0 })
    }

    filters.id = tagIds
  }

  const { data: tagData } = await query.graph({
    entity: "cms_tag",
    fields: [
      "id",
      "handle",
      "name",
      "description",
      "tag_type",
      "icon",
      "color",
      "is_active",
      "metadata",
      "created_at",
      "updated_at",
    ],
    filters,
  })

  const tags: any[] = tagData

  return res.json({
    tags,
    count: tags.length,
  })
}

/**
 * POST /admin/cms-tags
 * Create a new CMS tag
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cmsBlueprintService = req.scope.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  const { handle, name, description, tag_type, icon, color, is_active, metadata } = req.body as {
    handle: string
    name: string
    description?: string
    tag_type?: string
    icon?: string
    color?: string
    is_active?: boolean
    metadata?: Record<string, unknown>
  }

  const tag = await cmsBlueprintService.createCmsTags({
    handle,
    name,
    description,
    tag_type: (tag_type as TagType) || TagType.AVAILABILITY,
    icon,
    color,
    is_active: is_active ?? true,
    metadata,
  })

  return res.status(201).json({ tag })
}
