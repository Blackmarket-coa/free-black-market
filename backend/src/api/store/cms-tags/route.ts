import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/cms-tags
 * List all active CMS tags with optional filtering
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { tag_type, category_handle } = req.query as { tag_type?: string; category_handle?: string }

  const filters: Record<string, any> = {
    is_active: true,
    deleted_at: null,
  }

  if (tag_type) {
    filters.tag_type = tag_type
  }


  if (category_handle) {
    // First get category by handle
    const { data: categories } = await query.graph({
      entity: "cms_category",
      fields: ["id"],
      filters: {
        handle: category_handle,
        is_active: true,
        deleted_at: null,
      },
    })

    if (!categories || categories.length === 0) {
      return res.json({ tags: [] })
    }

    // Get tags for this category
    const { data: categoryTags } = await query.graph({
      entity: "cms_category_tag",
      fields: ["tag_id"],
      filters: {
        category_id: categories[0].id,
        deleted_at: null,
      },
    })

    const tagIds = categoryTags.map((ct: any) => ct.tag_id)

    if (tagIds.length === 0) {
      return res.json({ tags: [] })
    }

    filters.id = tagIds
  }

  const { data: tagData } = await query.graph({
    entity: "cms_tag",
    fields: [
      "id",
      "handle",
      "name",
      "tag_type",
      "icon",
      "color",
    ],
    filters,
  })

  const tags: any[] = tagData

  // Group by type for easier frontend usage
  const tagsByType = tags.reduce((acc: Record<string, any[]>, tag: any) => {
    const type = tag.tag_type
    if (!acc[type]) {
      acc[type] = []
    }
    acc[type].push(tag)
    return acc
  }, {})

  return res.json({
    tags,
    tags_by_type: tagsByType,
  })
}
