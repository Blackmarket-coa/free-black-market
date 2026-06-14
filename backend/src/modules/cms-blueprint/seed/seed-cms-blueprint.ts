import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CMS_TYPES,
  CMS_CATEGORIES,
  CMS_TAGS,
  CMS_ATTRIBUTES,
  CMS_CATEGORY_TAG_MAPPINGS,
  CMS_CATEGORY_ATTRIBUTE_MAPPINGS,
} from "./cms-blueprint-data"
import { CMS_BLUEPRINT_MODULE, CmsBlueprintServiceType } from "../index"
import { TagType } from "../models/cms-tag"
import { AttributeInputType, AttributeDisplayType } from "../models/cms-attribute"

/**
 * Seed the CMS Blueprint data
 * Creates types, categories, tags, attributes, and their relationships
 */
export async function seedCmsBlueprint(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("Starting CMS Blueprint seeding...")

  // Check if CMS types already exist
  try {
    const { data: existingTypes } = await query.graph({
      entity: "cms_type",
      fields: ["id"],
    })

    if (existingTypes && existingTypes.length > 0) {
      logger.info("CMS Blueprint data already exists, skipping seed...")
      return
    }
  } catch (_error) {
    // Table might not exist yet, continue with seeding
    logger.info("CMS tables may not exist yet, will seed after migration...")
  }

  // Get the CMS Blueprint service
  const cmsBlueprintService = container.resolve<CmsBlueprintServiceType>(CMS_BLUEPRINT_MODULE)

  // 1. Seed CMS Types
  logger.info("Seeding CMS Types...")
  for (const type of CMS_TYPES) {
    await cmsBlueprintService.createCmsTypes({
      handle: type.handle,
      name: type.name,
      description: type.description,
      icon: type.icon,
      display_order: type.display_order,
      is_active: type.is_active,
    })
  }
  logger.info(`Seeded ${CMS_TYPES.length} CMS Types`)

  // Fetch the created types to get their IDs
  const { data: createdTypes } = await query.graph({
    entity: "cms_type",
    fields: ["id", "handle"],
  })
  const typeIdMap = new Map(createdTypes.map((t: any) => [t.handle, t.id]))

  // 2. Seed CMS Categories
  logger.info("Seeding CMS Categories...")
  for (const category of CMS_CATEGORIES) {
    // Map the type_id from handle to actual ID
    const typeHandle = CMS_TYPES.find(t => t.id === category.type_id)?.handle
    const actualTypeId = typeHandle ? typeIdMap.get(typeHandle) : null

    if (!actualTypeId) {
      logger.warn(`Could not find type for category ${category.handle}, skipping...`)
      continue
    }

    await cmsBlueprintService.createCmsCategories({
      type_id: actualTypeId,
      handle: category.handle,
      name: category.name,
      description: category.description,
      icon: category.icon,
      display_order: category.display_order,
      is_active: category.is_active,
    })
  }
  logger.info(`Seeded ${CMS_CATEGORIES.length} CMS Categories`)

  // Fetch created categories to get their IDs
  const { data: createdCategories } = await query.graph({
    entity: "cms_category",
    fields: ["id", "handle"],
  })
  const categoryIdMap = new Map(createdCategories.map((c: any) => [c.handle, c.id]))

  // 3. Seed CMS Tags
  logger.info("Seeding CMS Tags...")
  for (const tag of CMS_TAGS) {
    await cmsBlueprintService.createCmsTags({
      handle: tag.handle,
      name: tag.name,
      tag_type: tag.tag_type as TagType,
      color: tag.color,
      is_active: true,
    })
  }
  logger.info(`Seeded ${CMS_TAGS.length} CMS Tags`)

  // Fetch created tags to get their IDs
  const { data: createdTags } = await query.graph({
    entity: "cms_tag",
    fields: ["id", "handle"],
  })
  const tagIdMap = new Map(createdTags.map((t: any) => [t.handle, t.id]))

  // 4. Seed CMS Attributes
  logger.info("Seeding CMS Attributes...")
  for (const attribute of CMS_ATTRIBUTES) {
    await cmsBlueprintService.createCmsAttributes({
      handle: attribute.handle,
      name: attribute.name,
      description: attribute.description,
      input_type: attribute.input_type as AttributeInputType,
      display_type: attribute.display_type as AttributeDisplayType,
      unit: attribute.unit,
      options: attribute.options as unknown as Record<string, unknown> | null,
      validation: attribute.validation as unknown as Record<string, unknown> | null,
      is_filterable: attribute.is_filterable,
      is_required: attribute.is_required,
      display_order: attribute.display_order,
      is_active: true,
    })
  }
  logger.info(`Seeded ${CMS_ATTRIBUTES.length} CMS Attributes`)

  // Fetch created attributes to get their IDs
  const { data: createdAttributes } = await query.graph({
    entity: "cms_attribute",
    fields: ["id", "handle"],
  })
  const attributeIdMap = new Map(createdAttributes.map((a: any) => [a.handle, a.id]))

  // 5. Seed Category-Tag Mappings
  logger.info("Seeding Category-Tag Mappings...")
  for (const mapping of CMS_CATEGORY_TAG_MAPPINGS) {
    // Map from seed IDs to actual database IDs
    const categoryHandle = CMS_CATEGORIES.find(c => c.id === mapping.category_id)?.handle
    const tagHandle = CMS_TAGS.find(t => t.id === mapping.tag_id)?.handle

    const actualCategoryId = categoryHandle ? categoryIdMap.get(categoryHandle) : null
    const actualTagId = tagHandle ? tagIdMap.get(tagHandle) : null

    if (!actualCategoryId || !actualTagId) {
      continue
    }

    await cmsBlueprintService.createCmsCategoryTags({
      category_id: actualCategoryId,
      tag_id: actualTagId,
      is_default: false,
      display_order: 0,
    })
  }
  logger.info(`Seeded ${CMS_CATEGORY_TAG_MAPPINGS.length} Category-Tag Mappings`)

  // 6. Seed Category-Attribute Mappings
  logger.info("Seeding Category-Attribute Mappings...")
  for (const mapping of CMS_CATEGORY_ATTRIBUTE_MAPPINGS) {
    // Map from seed IDs to actual database IDs
    const categoryHandle = CMS_CATEGORIES.find(c => c.id === mapping.category_id)?.handle
    const attributeHandle = CMS_ATTRIBUTES.find(a => a.id === mapping.attribute_id)?.handle

    const actualCategoryId = categoryHandle ? categoryIdMap.get(categoryHandle) : null
    const actualAttributeId = attributeHandle ? attributeIdMap.get(attributeHandle) : null

    if (!actualCategoryId || !actualAttributeId) {
      continue
    }

    await cmsBlueprintService.createCmsCategoryAttributes({
      category_id: actualCategoryId,
      attribute_id: actualAttributeId,
      is_required: mapping.is_required || false,
      display_order: 0,
    })
  }
  logger.info(`Seeded ${CMS_CATEGORY_ATTRIBUTE_MAPPINGS.length} Category-Attribute Mappings`)

  logger.info("CMS Blueprint seeding completed successfully!")
}

export default seedCmsBlueprint
