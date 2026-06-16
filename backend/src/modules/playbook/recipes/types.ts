/**
 * Playbook recipe types.
 *
 * A playbook recipe describes the cooperative-economic shape of a vendor.
 * Recipes are constants in code (source of truth) and seeded into the
 * `playbook` table at boot for query convenience.
 *
 * See `docs/PLAYBOOK_SYSTEM.md` for the ten playbooks and the matrix of
 * features each enables.
 */

export type PlaybookId =
  | "stall"
  | "atelier"
  | "grove"
  | "workshop"
  | "commons"
  | "cycle"
  | "kitchen"
  | "harvest"
  | "hub"
  | "service"
  | "creator"

export type MemberModel =
  | "solo"
  | "flat"
  | "sociocratic"
  | "multi_stakeholder"
  | "federation"

/**
 * Subset of `VendorFeatures` (vendor-panel) that recipes default.
 *
 * Keep in sync with vendor-panel/src/providers/vendor-type-provider/
 * vendor-type-context.tsx (now mirrored by playbook-provider). The 14
 * keys below are the canonical extension-key set; a follow-up branch
 * may add governance-specific keys (hasMembers, hasGovernance,
 * hasBookings) once the governance module v2 lands.
 */
export type PlaybookFeatureDefaults = {
  hasProducts?: boolean
  hasInventory?: boolean
  hasSeasons?: boolean
  hasVolunteers?: boolean
  hasMenu?: boolean
  hasDeliveryZones?: boolean
  hasDonations?: boolean
  hasSubscriptions?: boolean
  hasSupport?: boolean
  hasHarvests?: boolean
  hasPlots?: boolean
  hasRequests?: boolean
  hasFarm?: boolean
  hasShows?: boolean
}

export type ListingTypeId =
  | "physical_product"
  | "event"
  | "digital"
  | "recurring"
  | "wholesale"
  | "consignment"
  | "unique_inventory"
  | "bookable"
  | "campaign"

export type PlaybookRecipe = {
  id: PlaybookId
  display_name: string
  social_form: string
  /** Default 0.03 (3 %) across all playbooks under Posture A. */
  commission_rate: number
  /**
   * Three-tier sliding-scale (Supporter / Standard / Solidarity).
   * Stall opts out by default to keep solo-seller overhead at zero.
   */
  allow_sliding_scale: boolean
  /**
   * Whether vendors on this playbook can elect Coalition Credits payout
   * with bonus. Service defaults to opt-in for cash-flow predictability.
   */
  allow_credits_payout: boolean | "opt_in"
  member_model: MemberModel
  default_features: PlaybookFeatureDefaults
  allowed_listing_types: ListingTypeId[]
  storefront_blurb_default: string
}
