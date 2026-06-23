import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CMS_BLUEPRINT_MODULE, CmsBlueprintServiceType } from "../../../modules/cms-blueprint"
import { AttributeInputType, AttributeDisplayType } from "../../../modules/cms-blueprint/models/cms-attribute"

/**
 * GET /admin/cms-attributes
 * List all CMS attributes with optional filtering
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { category_id, is_filterable } = req.query as { category_id?: string; is_filterable?: string }

  const filters: Record<string, unknown> = {
    deleted_at: null,
  }

  if (is_filterable !== undefined) {
    filters.is_filterable = is_filterable === "true"
  }

  let attributes

  if (category_id) {
    // Get attributes for a specific category
    const { data: categoryAttributes } = await query.graph({
      entity: "cms_category_attribute",
      fields: ["attribute_id", "is_required", "display_order"],
      filters: {
        category_id,
        deleted_at: null,
      },
    })

    const attributeIds = categoryAttributes.map((ca) => ca.attribute_id)

    if (attributeIds.length === 0) {
      return res.json({ attributes: [], count: 0 })
    }

    filters.id = attributeIds

    const { data: attrData } = await query.graph({
      entity: "cms_attribute",
      fields: [
        "id",
        "handle",
        "name",
        "description",
        "input_type",
        "display_type",
        "unit",
        "options",
        "validation",
        "is_filterable",
        "is_required",
        "display_order",
        "is_active",
        "metadata",
        "created_at",
        "updated_at",
      ],
      filters,
    })

    // Merge with category-specific overrides
    attributes = attrData.map((attr) => {
      const mapping = categoryAttributes.find((ca) => ca.attribute_id === attr.id)
      return {
        ...attr,
        category_is_required: mapping?.is_required || false,
        category_display_order: mapping?.display_order || 0,
      }
    })

    // Sort by category display order
    attributes.sort((a, b) => a.category_display_order - b.category_display_order)
  } else {
    const { data: attrData } = await query.graph({
      entity: "cms_attribute",
      fields: [
        "id",
        "handle",
        "name",
        "description",
        "input_type",
        "display_type",
        "unit",
        "options",
        "validation",
        "is_filterable",
        "is_required",
        "display_order",
        "is_active",
        "metadata",
        "created_at",
        "updated_at",
      ],
      filters,
    })

    attributes = attrData.sort((a, b) => a.display_order - b.display_order)
  }

  return res.json({
    attributes,
    count: attributes.length,
  })
}

/**
 * POST /admin/cms-attributes
 * Create a new CMS attribute
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cmsBlueprintService = req.scope.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  const {
    handle,
    name,
    description,
    input_type,
    display_type,
    unit,
    options,
    validation,
    is_filterable,
    is_required,
    display_order,
    is_active,
    metadata,
  } = req.body as {
    handle: string
    name: string
    description?: string
    input_type?: string
    display_type?: string
    unit?: string
    options?: unknown
    validation?: unknown
    is_filterable?: boolean
    is_required?: boolean
    display_order?: number
    is_active?: boolean
    metadata?: Record<string, unknown>
  }

  const attribute = await cmsBlueprintService.createCmsAttributes({
    handle,
    name,
    description,
    input_type: (input_type as AttributeInputType) || AttributeInputType.TEXT,
    display_type: (display_type as AttributeDisplayType) || AttributeDisplayType.TEXT_INPUT,
    unit,
    options: options as Record<string, unknown> | null,
    validation: validation as Record<string, unknown> | null,
    is_filterable: is_filterable ?? true,
    is_required: is_required ?? false,
    display_order: display_order ?? 0,
    is_active: is_active ?? true,
    metadata,
  })

  return res.status(201).json({ attribute })
}
