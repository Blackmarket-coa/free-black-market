/**
 * Phase 1: Domain Architecture Types
 * 
 * Shared types for vendor classification and product archetypes.
 */

/**
 * Vendor Type Enum
 * 
 * Defines the category of seller for feature gating,
 * UI specialization, and commission logic.
 */
export enum VendorType {
  PRODUCER = "producer",
  GARDEN = "garden",
  KITCHEN = "kitchen",
  MAKER = "maker",
  RESTAURANT = "restaurant",
  MUTUAL_AID = "mutual_aid",
}

export const VendorTypeLabels: Record<VendorType, string> = {
  [VendorType.PRODUCER]: "Growers & Producers",
  [VendorType.GARDEN]: "Community Growing Spaces",
  [VendorType.KITCHEN]: "Shared Kitchens",
  [VendorType.MAKER]: "Makers & Brands",
  [VendorType.RESTAURANT]: "Food Businesses",
  [VendorType.MUTUAL_AID]: "Community Organizations",
}

/**
 * Product Archetype Enum
 * 
 * Defines the behavioral category of a product.
 */
export enum ProductArchetypeCode {
  AGRICULTURAL_RAW = "AGRICULTURAL_RAW",
  AGRICULTURAL_PROCESSED = "AGRICULTURAL_PROCESSED",
  RESTAURANT_PREPARED = "RESTAURANT_PREPARED",
  NON_PERISHABLE = "NON_PERISHABLE",
  DIGITAL = "DIGITAL",
  TICKET = "TICKET",
  SUBSCRIPTION = "SUBSCRIPTION",
}

export const ProductArchetypeLabels: Record<ProductArchetypeCode, string> = {
  [ProductArchetypeCode.AGRICULTURAL_RAW]: "Raw Agricultural Products",
  [ProductArchetypeCode.AGRICULTURAL_PROCESSED]: "Processed Agricultural Products",
  [ProductArchetypeCode.RESTAURANT_PREPARED]: "Restaurant Prepared Food",
  [ProductArchetypeCode.NON_PERISHABLE]: "Non-Perishable Goods",
  [ProductArchetypeCode.DIGITAL]: "Digital Products",
  [ProductArchetypeCode.TICKET]: "Event Tickets",
  [ProductArchetypeCode.SUBSCRIPTION]: "Subscription Products",
}

/**
 * Inventory Strategy
 */
export enum InventoryStrategy {
  STANDARD = "STANDARD",
  LOT_BASED = "LOT_BASED",
  UNLIMITED = "UNLIMITED",
  CAPACITY = "CAPACITY",
  NONE = "NONE",
}

/**
 * Seller Metadata DTO
 * 
 * Extended seller information including vendor_type.
 */
export interface SellerMetadataDTO {
  id: string
  seller_id: string
  vendor_type: VendorType
  business_registration_number?: string | null
  tax_classification?: string | null
  farm_practices?: Record<string, any> | null
  certifications?: Record<string, any>[] | null
  growing_region?: string | null
  cuisine_types?: string[] | null
  service_types?: string[] | null
  featured: boolean
  verified: boolean
  rating?: number | null
  review_count: number
  enabled_extensions?: string[] | null
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
}

/**
 * Product Archetype DTO
 */
export interface ProductArchetypeDTO {
  id: string
  code: ProductArchetypeCode
  name: string
  description?: string | null
  inventory_strategy: InventoryStrategy
  requires_availability_window: boolean
  supports_preorder: boolean
  perishable: boolean
  perishable_shelf_days?: number | null
  requires_shipping: boolean
  supports_pickup: boolean
  supports_delivery: boolean
  fulfillment_lead_time_hours?: number | null
  refundable: boolean
  return_window_days?: number | null
  tax_category?: string | null
  requires_lot_tracking: boolean
  supports_surplus_pricing: boolean
  requires_producer_link: boolean
  metadata?: Record<string, any> | null
}

/**
 * Product Archetype Assignment DTO
 */
export interface ProductArchetypeAssignmentDTO {
  id: string
  product_id: string
  archetype_id: string
  archetype?: ProductArchetypeDTO
  override_refundable?: boolean | null
  override_return_window_days?: number | null
  override_fulfillment_lead_time_hours?: number | null
  metadata?: Record<string, any> | null
}

/**
 * Extended Seller DTO (includes metadata)
 */
export interface ExtendedSellerDTO {
  id: string
  name: string
  handle: string
  description?: string | null
  email?: string | null
  phone?: string | null
  photo?: string | null
  address_line?: string | null
  postal_code?: string | null
  city?: string | null
  state?: string | null
  country_code?: string | null
  tax_id?: string | null
  store_status: "ACTIVE" | "INACTIVE" | "SUSPENDED"
  created_at: string
  updated_at: string
  // Extended fields from seller_metadata
  seller_metadata?: SellerMetadataDTO | null
}

// =============================================================================
// Phase 2-4: Barn-to-Door Agricultural Types
// =============================================================================

/**
 * Growing Practice Enum
 */
export enum GrowingPractice {
  ORGANIC = "ORGANIC",
  CERTIFIED_ORGANIC = "CERTIFIED_ORGANIC",
  REGENERATIVE = "REGENERATIVE",
  CONVENTIONAL = "CONVENTIONAL",
  BIODYNAMIC = "BIODYNAMIC",
  PERMACULTURE = "PERMACULTURE",
  HYDROPONIC = "HYDROPONIC",
  AQUAPONIC = "AQUAPONIC",
  NO_SPRAY = "NO_SPRAY",
  IPM = "IPM",
}

export const GrowingPracticeLabels: Record<GrowingPractice, string> = {
  [GrowingPractice.ORGANIC]: "Organic",
  [GrowingPractice.CERTIFIED_ORGANIC]: "Certified Organic",
  [GrowingPractice.REGENERATIVE]: "Regenerative",
  [GrowingPractice.CONVENTIONAL]: "Conventional",
  [GrowingPractice.BIODYNAMIC]: "Biodynamic",
  [GrowingPractice.PERMACULTURE]: "Permaculture",
  [GrowingPractice.HYDROPONIC]: "Hydroponic",
  [GrowingPractice.AQUAPONIC]: "Aquaponic",
  [GrowingPractice.NO_SPRAY]: "No Spray",
  [GrowingPractice.IPM]: "Integrated Pest Management",
}

/**
 * Producer DTO
 */
export interface ProducerDTO {
  id: string
  seller_id: string
  name: string
  handle: string
  description?: string | null
  region?: string | null
  state?: string | null
  country_code?: string | null
  latitude?: number | null
  longitude?: number | null
  farm_size_acres?: number | null
  year_established?: number | null
  practices?: GrowingPractice[] | null
  certifications?: CertificationDTO[] | null
  story?: string | null
  photo?: string | null
  cover_image?: string | null
  gallery?: string[] | null
  website?: string | null
  social_links?: Record<string, string> | null
  public_profile_enabled: boolean
  featured: boolean
  verified: boolean
  verified_at?: string | null
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
}

export interface CertificationDTO {
  name: string
  issuer: string
  valid_until?: string | null
  document_url?: string | null
}

/**
 * Season Enum
 */
export enum Season {
  SPRING = "SPRING",
  SUMMER = "SUMMER",
  FALL = "FALL",
  WINTER = "WINTER",
  YEAR_ROUND = "YEAR_ROUND",
}

export const SeasonLabels: Record<Season, string> = {
  [Season.SPRING]: "Spring",
  [Season.SUMMER]: "Summer",
  [Season.FALL]: "Fall",
  [Season.WINTER]: "Winter",
  [Season.YEAR_ROUND]: "Year Round",
}

/**
 * Harvest Visibility Enum
 */
export enum HarvestVisibility {
  DRAFT = "DRAFT",
  PREVIEW = "PREVIEW",
  PUBLIC = "PUBLIC",
  ARCHIVED = "ARCHIVED",
}

export const HarvestVisibilityLabels: Record<HarvestVisibility, string> = {
  [HarvestVisibility.DRAFT]: "Draft",
  [HarvestVisibility.PREVIEW]: "Preview",
  [HarvestVisibility.PUBLIC]: "Public",
  [HarvestVisibility.ARCHIVED]: "Archived",
}

/**
 * Harvest DTO
 */
export interface HarvestDTO {
  id: string
  producer_id: string
  crop_name: string
  variety?: string | null
  category?: string | null
  harvest_date?: string | null
  planted_date?: string | null
  season: Season
  year: number
  growing_method?: string | null
  field_name?: string | null
  farmer_notes?: string | null
  weather_notes?: string | null
  taste_notes?: string | null
  usage_tips?: string | null
  photo?: string | null
  gallery?: string[] | null
  expected_yield_quantity?: number | null
  expected_yield_unit?: string | null
  visibility_status: HarvestVisibility
  published_at?: string | null
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  // Relations
  producer?: ProducerDTO | null
  lots?: LotDTO[] | null
}

/**
 * Lot Grade Enum
 */
export enum LotGrade {
  PREMIUM = "PREMIUM",
  GRADE_A = "GRADE_A",
  GRADE_B = "GRADE_B",
  PROCESSING = "PROCESSING",
  IMPERFECT = "IMPERFECT",
  SECONDS = "SECONDS",
}

export const LotGradeLabels: Record<LotGrade, string> = {
  [LotGrade.PREMIUM]: "Premium",
  [LotGrade.GRADE_A]: "Grade A",
  [LotGrade.GRADE_B]: "Grade B",
  [LotGrade.PROCESSING]: "Processing Grade",
  [LotGrade.IMPERFECT]: "Imperfect / Ugly",
  [LotGrade.SECONDS]: "Seconds",
}

/**
 * Lot Allocation Enum
 */
export enum LotAllocation {
  KITCHEN = "kitchen",
  RESTAURANT = "restaurant",
  WHOLESALE = "WHOLESALE",
  CSA = "CSA",
  COOPERATIVE = "COOPERATIVE",
  DONATION = "DONATION",
  PROCESSING = "PROCESSING",
}

export const LotAllocationLabels: Record<LotAllocation, string> = {
  [LotAllocation.KITCHEN]: "Kitchen (DTC)",
  [LotAllocation.RESTAURANT]: "Restaurant (B2B)",
  [LotAllocation.WHOLESALE]: "Wholesale",
  [LotAllocation.CSA]: "CSA Share",
  [LotAllocation.COOPERATIVE]: "Cooperative",
  [LotAllocation.DONATION]: "Donation",
  [LotAllocation.PROCESSING]: "Processing",
}

/**
 * Lot DTO
 */
export interface LotDTO {
  id: string
  harvest_id: string
  lot_number?: string | null
  batch_date?: string | null
  grade: LotGrade
  size_class?: string | null
  quantity_total: number
  quantity_available: number
  quantity_reserved: number
  quantity_sold: number
  unit: string
  suggested_price_per_unit?: number | null
  cost_per_unit?: number | null
  allocation_type: LotAllocation
  surplus_flag: boolean
  surplus_declared_at?: string | null
  surplus_reason?: string | null
  best_by_date?: string | null
  use_by_date?: string | null
  storage_location?: string | null
  storage_requirements?: string | null
  external_lot_id?: string | null
  is_active: boolean
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  // Relations
  harvest?: HarvestDTO | null
  availability_windows?: AvailabilityWindowDTO[] | null
}

/**
 * Sales Channel Enum
 */
export enum SalesChannel {
  DTC = "DTC",
  B2B = "B2B",
  CSA = "CSA",
  WHOLESALE = "WHOLESALE",
  FARMERS_MARKET = "FARMERS_MARKET",
}

export const SalesChannelLabels: Record<SalesChannel, string> = {
  [SalesChannel.DTC]: "Direct to Consumer",
  [SalesChannel.B2B]: "Business to Business",
  [SalesChannel.CSA]: "CSA Share",
  [SalesChannel.WHOLESALE]: "Wholesale",
  [SalesChannel.FARMERS_MARKET]: "Farmers Market",
}

/**
 * Pricing Strategy Enum
 */
export enum PricingStrategy {
  FIXED = "FIXED",
  TIERED = "TIERED",
  DYNAMIC = "DYNAMIC",
  AUCTION = "AUCTION",
  NEGOTIATED = "NEGOTIATED",
}

export const PricingStrategyLabels: Record<PricingStrategy, string> = {
  [PricingStrategy.FIXED]: "Fixed Price",
  [PricingStrategy.TIERED]: "Volume Tiers",
  [PricingStrategy.DYNAMIC]: "Dynamic",
  [PricingStrategy.AUCTION]: "Auction",
  [PricingStrategy.NEGOTIATED]: "Negotiated",
}

/**
 * Availability Window DTO
 */
export interface AvailabilityWindowDTO {
  id: string
  lot_id: string
  product_id?: string | null
  available_from: string
  available_until?: string | null
  sales_channel: SalesChannel
  pricing_strategy: PricingStrategy
  unit_price: number
  currency_code: string
  price_tiers?: PriceTierDTO[] | null
  min_order_quantity?: number | null
  max_order_quantity?: number | null
  quantity_increment?: number | null
  preorder_enabled: boolean
  preorder_deposit_percent?: number | null
  estimated_ship_date?: string | null
  pickup_enabled: boolean
  delivery_enabled: boolean
  shipping_enabled: boolean
  pickup_locations?: PickupLocationDTO[] | null
  fulfillment_lead_time_hours?: number | null
  surplus_discount_percent?: number | null
  featured: boolean
  sort_order: number
  is_active: boolean
  paused_at?: string | null
  pause_reason?: string | null
  view_count: number
  order_count: number
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  // Relations
  lot?: LotDTO | null
}

export interface PriceTierDTO {
  min_quantity: number
  max_quantity?: number | null
  price_per_unit: number
}

export interface PickupLocationDTO {
  name: string
  address: string
  city: string
  state: string
  postal_code: string
  instructions?: string | null
  available_days?: string[] | null
  available_hours?: string | null
}

// =============================================================================
// Cooperative Types
// =============================================================================

/**
 * Cooperative Type Enum
 */
export enum CooperativeType {
  FARM_COOP = "FARM_COOP",
  FOOD_HUB = "FOOD_HUB",
  CSA = "CSA",
  BUYING_CLUB = "BUYING_CLUB",
  INDIGENOUS = "INDIGENOUS",
  WORKER_OWNED = "WORKER_OWNED",
}

export const CooperativeTypeLabels: Record<CooperativeType, string> = {
  [CooperativeType.FARM_COOP]: "Farm Cooperative",
  [CooperativeType.FOOD_HUB]: "Food Hub",
  [CooperativeType.CSA]: "Community Supported Agriculture",
  [CooperativeType.BUYING_CLUB]: "Buying Club",
  [CooperativeType.INDIGENOUS]: "Indigenous Collective",
  [CooperativeType.WORKER_OWNED]: "Worker Owned",
}

/**
 * Cooperative Member Role Enum
 */
export enum CooperativeMemberRole {
  ADMIN = "ADMIN",
  COORDINATOR = "COORDINATOR",
  PRODUCER = "PRODUCER",
  MEMBER = "MEMBER",
}

export const CooperativeMemberRoleLabels: Record<CooperativeMemberRole, string> = {
  [CooperativeMemberRole.ADMIN]: "Administrator",
  [CooperativeMemberRole.COORDINATOR]: "Coordinator",
  [CooperativeMemberRole.PRODUCER]: "Producer",
  [CooperativeMemberRole.MEMBER]: "Member",
}

/**
 * Aggregation Method Enum
 */
export enum AggregationMethod {
  POOLED = "POOLED",
  INDIVIDUAL = "INDIVIDUAL",
  HYBRID = "HYBRID",
}

export const AggregationMethodLabels: Record<AggregationMethod, string> = {
  [AggregationMethod.POOLED]: "Pooled Inventory",
  [AggregationMethod.INDIVIDUAL]: "Individual Listings",
  [AggregationMethod.HYBRID]: "Hybrid",
}

/**
 * Cooperative DTO
 */
export interface CooperativeDTO {
  id: string
  name: string
  handle: string
  description?: string | null
  cooperative_type: CooperativeType
  region?: string | null
  state?: string | null
  country_code?: string | null
  address_line?: string | null
  postal_code?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  logo?: string | null
  cover_image?: string | null
  default_platform_commission: number
  default_coop_fee: number
  public_storefront_enabled: boolean
  featured: boolean
  governance_model?: string | null
  membership_requirements?: string | null
  is_active: boolean
  verified: boolean
  verified_at?: string | null
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  // Relations
  members?: CooperativeMemberDTO[] | null
  listings?: CooperativeListingDTO[] | null
}

/**
 * Cooperative Member DTO
 */
export interface CooperativeMemberDTO {
  id: string
  cooperative_id: string
  producer_id: string
  role: CooperativeMemberRole
  revenue_share_percent?: number | null
  joined_at: string
  membership_number?: string | null
  max_products?: number | null
  max_monthly_revenue?: number | null
  is_active: boolean
  suspended_at?: string | null
  suspension_reason?: string | null
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  // Relations
  cooperative?: CooperativeDTO | null
  producer?: ProducerDTO | null
}

/**
 * Cooperative Listing DTO
 */
export interface CooperativeListingDTO {
  id: string
  cooperative_id: string
  product_id?: string | null
  name: string
  description?: string | null
  aggregation_method: AggregationMethod
  unified_price?: number | null
  currency_code: string
  availability_window_ids?: string[] | null
  total_quantity_available: number
  unit?: string | null
  aggregation_point?: string | null
  aggregation_deadline?: string | null
  featured: boolean
  sort_order: number
  is_active: boolean
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  // Relations
  cooperative?: CooperativeDTO | null
}
