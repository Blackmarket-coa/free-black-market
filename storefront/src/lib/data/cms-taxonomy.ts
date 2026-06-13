import { logger } from "@/lib/logger"
import { medusaFetch } from "@/lib/config"

export interface CmsType {
  id: string
  handle: string
  name: string
  description: string | null
  icon: string | null
  display_order: number
  is_active: boolean
  categories?: CmsCategory[]
}

export interface CmsCategory {
  id: string
  type_id: string
  handle: string
  name: string
  description: string | null
  icon: string | null
  image_url: string | null
  display_order: number
  is_active: boolean
  tags?: CmsTag[]
  attributes?: CmsAttribute[]
}

export interface CmsTag {
  id: string
  handle: string
  name: string
  tag_type: string
  icon: string | null
  color: string | null
  is_active: boolean
}

export interface CmsAttribute {
  id: string
  handle: string
  name: string
  description: string | null
  input_type: string
  display_type: string
  unit: string | null
  is_filterable: boolean
  is_required: boolean
}

export interface CmsTaxonomy {
  taxonomy: CmsType[]
  total_types: number
  total_categories: number
}

/**
 * Fetch the complete CMS taxonomy for navigation
 * Returns all types with their categories
 */
export async function getCmsTaxonomy(): Promise<CmsTaxonomy> {
  try {
    const response = await medusaFetch<CmsTaxonomy>(
      "/store/cms-taxonomy",
      {
        cache: "force-cache",
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    )
    return response
  } catch (error) {
    logger.error("Failed to fetch CMS taxonomy:", error)
    // Return empty taxonomy on error
    return {
      taxonomy: [],
      total_types: 0,
      total_categories: 0,
    }
  }
}

/**
 * Fetch all CMS types
 */
export async function getCmsTypes(): Promise<CmsType[]> {
  try {
    const response = await medusaFetch<{ types: CmsType[] }>(
      "/store/cms-types",
      {
        cache: "force-cache",
        next: { revalidate: 3600 },
      }
    )
    return response.types || []
  } catch (error) {
    logger.error("Failed to fetch CMS types:", error)
    return []
  }
}

/**
 * Fetch a single type with its categories
 */
export async function getCmsTypeByHandle(handle: string): Promise<CmsType | null> {
  try {
    const response = await medusaFetch<{ type: CmsType }>(
      `/store/cms-types/${handle}`,
      {
        cache: "force-cache",
        next: { revalidate: 300 }, // 5 minute cache
      }
    )
    return response.type || null
  } catch (error) {
    logger.error(`Failed to fetch CMS type ${handle}:`, error)
    return null
  }
}

/**
 * Fetch a category with its tags and attributes
 */
export async function getCmsCategoryByHandle(handle: string): Promise<CmsCategory | null> {
  try {
    const response = await medusaFetch<{ category: CmsCategory }>(
      `/store/cms-categories/${handle}`,
      {
        cache: "force-cache",
        next: { revalidate: 300 },
      }
    )
    return response.category || null
  } catch (error) {
    logger.error(`Failed to fetch CMS category ${handle}:`, error)
    return null
  }
}

/**
 * Fetch tags, optionally filtered by type or category
 */
export async function getCmsTags(options?: {
  tag_type?: string
  category_id?: string
}): Promise<CmsTag[]> {
  try {
    const queryParams = new URLSearchParams()
    if (options?.tag_type) queryParams.set("tag_type", options.tag_type)
    if (options?.category_id) queryParams.set("category_id", options.category_id)

    const url = `/store/cms-tags${queryParams.toString() ? `?${queryParams.toString()}` : ""}`

    const response = await medusaFetch<{ tags: CmsTag[] }>(url, {
      cache: "force-cache",
      next: { revalidate: 3600 },
    })
    return response.tags || []
  } catch (error) {
    logger.error("Failed to fetch CMS tags:", error)
    return []
  }
}

// Icon mapping for CMS types (emoji to Lucide icon name mapping)
export const TYPE_ICONS: Record<string, string> = {
  "food-produce": "🥬",
  "prepared-foods-meals": "🍽️",
  "supplies-goods": "📦",
  "services-delivery": "🚚",
  "organizations-partnerships": "🤝",
  "equipment-tools": "🔧",
}

// Fallback categories for when CMS is not available
export const FALLBACK_TYPES: CmsType[] = [
  {
    id: "type_food_produce",
    handle: "food-produce",
    name: "Food & Produce",
    description: "Fresh fruits, vegetables, grains, meat, dairy, and beverages",
    icon: "🥬",
    display_order: 1,
    is_active: true,
    categories: [
      { id: "cat_fruits_vegetables", type_id: "type_food_produce", handle: "fruits-vegetables", name: "Fruits & Vegetables", description: null, icon: "🥕", image_url: null, display_order: 1, is_active: true },
      { id: "cat_grains_legumes", type_id: "type_food_produce", handle: "grains-legumes", name: "Grains & Legumes", description: null, icon: "🌾", image_url: null, display_order: 2, is_active: true },
      { id: "cat_meat_poultry", type_id: "type_food_produce", handle: "meat-poultry", name: "Meat & Poultry", description: null, icon: "🍗", image_url: null, display_order: 3, is_active: true },
      { id: "cat_seafood", type_id: "type_food_produce", handle: "seafood", name: "Seafood", description: null, icon: "🐟", image_url: null, display_order: 4, is_active: true },
      { id: "cat_dairy_eggs", type_id: "type_food_produce", handle: "dairy-eggs", name: "Dairy & Eggs", description: null, icon: "🥛", image_url: null, display_order: 5, is_active: true },
      { id: "cat_beverages", type_id: "type_food_produce", handle: "beverages", name: "Beverages", description: null, icon: "🍹", image_url: null, display_order: 6, is_active: true },
    ],
  },
  {
    id: "type_prepared_foods",
    handle: "prepared-foods-meals",
    name: "Prepared Foods",
    description: "Ready-to-eat meals, snacks, and beverages",
    icon: "🍽️",
    display_order: 2,
    is_active: true,
    categories: [
      { id: "cat_ready_to_eat", type_id: "type_prepared_foods", handle: "ready-to-eat-meals", name: "Ready-to-Eat Meals", description: null, icon: "🥡", image_url: null, display_order: 1, is_active: true },
      { id: "cat_baked_goods", type_id: "type_prepared_foods", handle: "baked-goods", name: "Baked Goods", description: null, icon: "🥐", image_url: null, display_order: 2, is_active: true },
      { id: "cat_preserved_canned", type_id: "type_prepared_foods", handle: "preserved-canned-goods", name: "Preserved & Canned", description: null, icon: "🥫", image_url: null, display_order: 3, is_active: true },
      { id: "cat_snacks_treats", type_id: "type_prepared_foods", handle: "snacks-treats", name: "Snacks & Treats", description: null, icon: "🍪", image_url: null, display_order: 4, is_active: true },
    ],
  },
  {
    id: "type_supplies_goods",
    handle: "supplies-goods",
    name: "Supplies & Goods",
    description: "Household items, personal care, and pantry staples",
    icon: "📦",
    display_order: 3,
    is_active: true,
    categories: [
      { id: "cat_pantry_staples", type_id: "type_supplies_goods", handle: "pantry-staples", name: "Pantry Staples", description: null, icon: "🫙", image_url: null, display_order: 1, is_active: true },
      { id: "cat_personal_care", type_id: "type_supplies_goods", handle: "personal-care", name: "Personal Care", description: null, icon: "🧴", image_url: null, display_order: 2, is_active: true },
      { id: "cat_household_items", type_id: "type_supplies_goods", handle: "household-items", name: "Household Items", description: null, icon: "🧹", image_url: null, display_order: 3, is_active: true },
      { id: "cat_pet_supplies", type_id: "type_supplies_goods", handle: "pet-supplies", name: "Pet Supplies", description: null, icon: "🐾", image_url: null, display_order: 4, is_active: true },
    ],
  },
  {
    id: "type_services_delivery",
    handle: "services-delivery",
    name: "Services",
    description: "Delivery, catering, and logistics",
    icon: "🚚",
    display_order: 4,
    is_active: true,
    categories: [
      { id: "cat_delivery_services", type_id: "type_services_delivery", handle: "delivery-services", name: "Delivery Services", description: null, icon: "📦", image_url: null, display_order: 1, is_active: true },
      { id: "cat_catering", type_id: "type_services_delivery", handle: "catering-services", name: "Catering", description: null, icon: "🍴", image_url: null, display_order: 2, is_active: true },
      { id: "cat_logistics", type_id: "type_services_delivery", handle: "logistics-fulfillment", name: "Logistics", description: null, icon: "🏭", image_url: null, display_order: 3, is_active: true },
    ],
  },
  {
    id: "type_organizations",
    handle: "organizations-partnerships",
    name: "Organizations",
    description: "Food banks, mutual aid, community gardens, and kitchens",
    icon: "🤝",
    display_order: 5,
    is_active: true,
    categories: [
      { id: "cat_food_banks", type_id: "type_organizations", handle: "food-banks-pantries", name: "Food Banks & Pantries", description: null, icon: "🏦", image_url: null, display_order: 1, is_active: true },
      { id: "cat_mutual_aid", type_id: "type_organizations", handle: "mutual-aid-networks", name: "Mutual Aid Networks", description: null, icon: "🤲", image_url: null, display_order: 2, is_active: true },
      { id: "cat_community_gardens", type_id: "type_organizations", handle: "community-gardens", name: "Community Gardens", description: null, icon: "🌱", image_url: null, display_order: 3, is_active: true },
      { id: "cat_commercial_kitchens", type_id: "type_organizations", handle: "commercial-kitchens", name: "Commercial Kitchens", description: null, icon: "👨‍🍳", image_url: null, display_order: 4, is_active: true },
      { id: "cat_religious_orgs", type_id: "type_organizations", handle: "religious-organizations", name: "Religious Organizations", description: null, icon: "⛪", image_url: null, display_order: 5, is_active: true },
      { id: "cat_nonprofits", type_id: "type_organizations", handle: "nonprofits-ngos", name: "Nonprofits & NGOs", description: null, icon: "💚", image_url: null, display_order: 6, is_active: true },
    ],
  },
  {
    id: "type_equipment_tools",
    handle: "equipment-tools",
    name: "Equipment",
    description: "Kitchen equipment, gardening tools, and machinery",
    icon: "🔧",
    display_order: 6,
    is_active: true,
    categories: [
      { id: "cat_kitchen_equipment", type_id: "type_equipment_tools", handle: "kitchen-equipment", name: "Kitchen Equipment", description: null, icon: "🍳", image_url: null, display_order: 1, is_active: true },
      { id: "cat_gardening_tools", type_id: "type_equipment_tools", handle: "gardening-tools", name: "Gardening Tools", description: null, icon: "🌿", image_url: null, display_order: 2, is_active: true },
      { id: "cat_storage_containers", type_id: "type_equipment_tools", handle: "storage-containers", name: "Storage & Containers", description: null, icon: "📦", image_url: null, display_order: 3, is_active: true },
      { id: "cat_processing_machinery", type_id: "type_equipment_tools", handle: "processing-machinery", name: "Processing Machinery", description: null, icon: "⚙️", image_url: null, display_order: 4, is_active: true },
    ],
  },
]
