import { model } from "@medusajs/framework/utils"

/**
 * Food Producer Types
 * 
 * Supports all types of food producers in the solidarity economy:
 * - Commercial (restaurants, ghost kitchens)
 * - Home-based (cottage food, home bakers)
 * - Community (food banks, mutual aid, community kitchens)
 * - Agricultural (farms, CSAs)
 */
export enum ProducerType {
  // Commercial
  RESTAURANT = "RESTAURANT",
  GHOST_KITCHEN = "GHOST_KITCHEN",
  FOOD_TRUCK = "FOOD_TRUCK",
  CATERING = "CATERING",
  BAKERY = "BAKERY",
  
  // Cottage Food / Home-Based
  COTTAGE_FOOD = "COTTAGE_FOOD",
  HOME_BAKER = "HOME_BAKER",
  HOME_COOK = "HOME_COOK",
  
  // Community / Solidarity
  FOOD_BANK = "FOOD_BANK",
  MUTUAL_AID = "MUTUAL_AID",
  COMMUNITY_KITCHEN = "COMMUNITY_KITCHEN",
  COMMERCIAL_KITCHEN = "COMMERCIAL_KITCHEN", // Shared-use commercial kitchens
  COOPERATIVE = "COOPERATIVE",
  COLLECTIVE = "COLLECTIVE",
  
  // Agricultural
  FARM = "FARM",
  URBAN_FARM = "URBAN_FARM",
  COMMUNITY_GARDEN = "COMMUNITY_GARDEN",
  CSA = "CSA", // Community Supported Agriculture
  FOOD_HUB = "FOOD_HUB",
}

/**
 * License/Certification Types
 */
export enum LicenseType {
  // Commercial
  FOOD_SERVICE_LICENSE = "FOOD_SERVICE_LICENSE",
  HEALTH_DEPARTMENT = "HEALTH_DEPARTMENT",
  BUSINESS_LICENSE = "BUSINESS_LICENSE",
  
  // Cottage Food
  COTTAGE_FOOD_LICENSE = "COTTAGE_FOOD_LICENSE",
  HOME_KITCHEN_PERMIT = "HOME_KITCHEN_PERMIT",
  
  // Certifications
  ORGANIC_CERTIFIED = "ORGANIC_CERTIFIED",
  FOOD_HANDLER_CERT = "FOOD_HANDLER_CERT",
  SERVSAFE = "SERVSAFE",
  
  // Community
  NONPROFIT_501C3 = "NONPROFIT_501C3",
  COOP_REGISTRATION = "COOP_REGISTRATION",
}

/**
 * Operating Status
 */
export enum OperatingStatus {
  ACCEPTING_ORDERS = "ACCEPTING_ORDERS",
  PAUSED = "PAUSED",
  PREPARING_ONLY = "PREPARING_ONLY", // Not accepting new orders
  CLOSED = "CLOSED",
  SEASONAL = "SEASONAL",
}

/**
 * FoodProducer Model
 * 
 * Universal model for all food producers: restaurants, cottage food producers,
 * ghost kitchens, food banks, mutual aid orgs, farms, etc.
 */
export const FoodProducer = model.define("food_producer", {
  id: model.id().primaryKey(),
  
  // Link to MercurJS seller (if commercial)
  seller_id: model.text().nullable(),
  
  // Basic Identity
  name: model.text().searchable(),
  handle: model.text().unique(),
  producer_type: model.enum(ProducerType).default(ProducerType.RESTAURANT),
  description: model.text().nullable(),
  tagline: model.text().nullable(),
  
  // Contact Information
  email: model.text(),
  phone: model.text().nullable(),
  secondary_phone: model.text().nullable(),
  
  // Location
  address_line_1: model.text().nullable(),
  address_line_2: model.text().nullable(),
  city: model.text().nullable(),
  state: model.text().nullable(),
  postal_code: model.text().nullable(),
  country_code: model.text().default("US"),
  latitude: model.float().nullable(),
  longitude: model.float().nullable(),
  
  // For cottage food / privacy - don't show exact address
  hide_address: model.boolean().default(false),
  service_area_radius_miles: model.float().nullable(), // Delivery radius
  
  // Operating Hours (stored as JSON)
  // Format: { monday: { open: "09:00", close: "17:00", closed: false }, ... }
  operating_hours: model.json().nullable(),
  
  // Timezone for operating hours
  timezone: model.text().default("America/New_York"),
  
  // Current Status
  operating_status: model.enum(OperatingStatus).default(OperatingStatus.CLOSED),
  
  // Transaction Types Supported
  accepts_orders: model.boolean().default(true),      // Commercial sales
  accepts_trades: model.boolean().default(false),     // Barter/trade
  accepts_donations: model.boolean().default(false),  // Free/charitable
  donation_only: model.boolean().default(false),      // Food bank mode
  
  // Delivery Capabilities
  offers_delivery: model.boolean().default(true),
  offers_pickup: model.boolean().default(true),
  delivery_fee: model.bigNumber().nullable(),
  minimum_order: model.bigNumber().nullable(),
  free_delivery_threshold: model.bigNumber().nullable(),
  estimated_prep_time_minutes: model.number().default(30),
  
  // Licensing & Compliance
  // JSON array: [{ type: LicenseType, number: string, issuer: string, expires_at: Date, document_url?: string }]
  licenses: model.json().nullable(),
  cottage_food_state: model.text().nullable(), // State where cottage food license is valid
  
  // Verification
  verified: model.boolean().default(false),
  verified_at: model.dateTime().nullable(),
  verification_notes: model.text().nullable(),
  
  // Media
  logo_url: model.text().nullable(),
  cover_image_url: model.text().nullable(),
  gallery: model.json().nullable(), // string[]
  
  // Social & Web
  website: model.text().nullable(),
  social_links: model.json().nullable(), // { instagram?, facebook?, twitter?, tiktok? }
  
  // Community Features
  story: model.text().nullable(),         // Producer story/about
  mission: model.text().nullable(),       // For mutual aid/food banks
  accepting_volunteers: model.boolean().default(false),
  volunteer_info: model.text().nullable(),
  
  // Food Specialties / Tags
  cuisine_types: model.json().nullable(),  // ["Mexican", "Soul Food", "Vegan"]
  dietary_options: model.json().nullable(), // ["vegan", "gluten-free", "halal", "kosher"]
  specialties: model.json().nullable(),     // ["Birthday Cakes", "Catering", "Meal Prep"]
  
  // Ratings & Reviews (aggregate)
  average_rating: model.float().nullable(),
  total_reviews: model.number().default(0),
  total_orders: model.number().default(0),
  
  // Community Trust Metrics
  community_vouches: model.number().default(0), // Other producers who vouch for this one
  years_active: model.number().nullable(),
  
  // Payment & Finance
  accepts_cash: model.boolean().default(true),
  accepts_card: model.boolean().default(true),
  accepts_ebt_snap: model.boolean().default(false),
  accepts_mutual_credit: model.boolean().default(false), // Hawala/community currency
  
  // Hawala Integration
  hawala_account_id: model.text().nullable(), // Link to hawala ledger account

  // Ownership — the account (customer/seller) that created this producer.
  // Authorizes update / deactivate + producer-side order actions on the
  // /store/food-producers routes so one account can't manage another's
  // producer. Nullable for producers created before ownership tracking
  // (grandfathered — any authenticated actor may still manage those).
  owner_id: model.text().nullable(),
  owner_type: model.text().nullable(), // "customer" | "seller" | "driver"

  // Visibility
  public_profile: model.boolean().default(true),
  featured: model.boolean().default(false),
  
  // Metadata
  metadata: model.json().nullable(),
  
  // Relation to admins (hasMany)
  admins: model.hasMany(() => FoodProducerAdmin, { mappedBy: "producer" }),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_food_producer_seller" },
    { on: ["handle"], name: "IDX_food_producer_handle" },
    { on: ["producer_type"], name: "IDX_food_producer_type" },
    { on: ["city", "state"], name: "IDX_food_producer_location" },
    { on: ["operating_status"], name: "IDX_food_producer_status" },
    { on: ["public_profile"], name: "IDX_food_producer_public" },
    { on: ["featured"], name: "IDX_food_producer_featured" },
    { on: ["accepts_donations"], name: "IDX_food_producer_donations" },
    { on: ["donation_only"], name: "IDX_food_producer_donation_only" },
  ])
  .cascades({
    delete: ["admins"],
  })

/**
 * Food Producer Admin
 * 
 * People who can manage a food producer account
 */
export const FoodProducerAdmin = model.define("food_producer_admin", {
  id: model.id().primaryKey(),
  
  producer: model.belongsTo(() => FoodProducer, { mappedBy: "admins" }),
  
  // User info
  first_name: model.text(),
  last_name: model.text(),
  email: model.text(),
  phone: model.text().nullable(),
  
  // Role within the producer
  role: model.enum(["OWNER", "MANAGER", "STAFF", "VOLUNTEER"]).default("STAFF"),
  
  // Permissions (JSON for flexibility)
  permissions: model.json().nullable(), // ["manage_orders", "manage_menu", "manage_deliveries"]
  
  // Status
  active: model.boolean().default(true),
  
  // Avatar
  avatar_url: model.text().nullable(),
})
