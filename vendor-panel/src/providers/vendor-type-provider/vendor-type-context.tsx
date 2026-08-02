import { createContext, useContext, ReactNode, useMemo } from "react"
import { useMe } from "../../hooks/api/users"

/**
 * Vendor Types supported by the platform.
 *
 * Must stay in step with the backend `VendorType` enum
 * (`modules/seller-extension/models/seller-metadata.ts`). Note `"default"` is
 * NOT a backend value — it is this panel's sentinel for "unrecognized type",
 * which is why the backend's neutral archetype is named `general`.
 */
export type VendorType =
  | "producer"      // Farms, food producers
  | "garden"        // Community gardens
  | "kitchen"       // Commercial community kitchens
  | "maker"         // Artisans, crafters
  | "restaurant"    // Restaurants, ghost kitchens
  | "mutual_aid"    // Mutual aid networks
  | "creator"       // Creators monetizing an audience
  | "general"       // Archetype-neutral business
  | "default"       // Fallback (panel-only sentinel)

/**
 * Real backend archetypes, i.e. every `VendorType` except the local sentinel.
 *
 * The provider used to test incoming values against a hand-written string
 * array, which silently mapped any archetype missing from it onto `"default"`
 * — a vendor landing on the `default` feature set (products + inventory only)
 * regardless of what they actually signed up as. Deriving the allowlist from
 * this const means a new entry in the union above is enough.
 */
export const BACKEND_VENDOR_TYPES = [
  "producer",
  "garden",
  "kitchen",
  "maker",
  "restaurant",
  "mutual_aid",
  "creator",
  "general",
] as const satisfies readonly Exclude<VendorType, "default">[]

/**
 * Feature flags based on vendor type
 */
export interface VendorFeatures {
  hasProducts: boolean
  hasInventory: boolean
  hasSeasons: boolean
  hasVolunteers: boolean
  hasMenu: boolean
  hasDeliveryZones: boolean
  hasDonations: boolean
  hasSubscriptions: boolean
  hasSupport: boolean
  hasHarvests: boolean
  hasPlots: boolean
  hasRequests: boolean
  hasFarm: boolean
  hasShows: boolean
}

/**
 * All available feature keys with display metadata
 */
export const ALL_EXTENSION_OPTIONS: {
  key: keyof VendorFeatures
  label: string
  description: string
}[] = [
  { key: "hasProducts", label: "Products", description: "Manage and sell products from your dashboard" },
  { key: "hasInventory", label: "Inventory", description: "Track stock levels and manage inventory" },
  { key: "hasSeasons", label: "Seasons", description: "Organize products by growing seasons" },
  { key: "hasVolunteers", label: "Volunteers", description: "Manage volunteer sign-ups and schedules" },
  { key: "hasMenu", label: "Menu", description: "Create and manage food menus" },
  { key: "hasDeliveryZones", label: "Delivery Zones", description: "Define delivery areas and service zones" },
  { key: "hasDonations", label: "Donations", description: "Accept and track donations" },
  { key: "hasSubscriptions", label: "Subscriptions", description: "Offer recurring orders and subscription plans" },
  { key: "hasSupport", label: "Support", description: "Customer support and help desk" },
  { key: "hasHarvests", label: "Harvests", description: "Track and manage harvest records" },
  { key: "hasPlots", label: "Plots", description: "Manage garden plots and assignments" },
  { key: "hasRequests", label: "Requests", description: "Handle incoming requests and inquiries" },
  { key: "hasFarm", label: "Farm", description: "Farm profile, details, and harvest tracking" },
  { key: "hasShows", label: "Shows", description: "Manage events and show listings" },
]

/**
 * All feature keys for programmatic use
 */
export const ALL_FEATURE_KEYS: (keyof VendorFeatures)[] = ALL_EXTENSION_OPTIONS.map(o => o.key)

/**
 * Context value type
 */
type VendorTypeContextValue = {
  vendorType: VendorType
  isLoading: boolean
  features: VendorFeatures
  typeLabel: string
  typeLabelPlural: string
  /** The raw enabled_extensions array from the seller, or null if using type defaults */
  enabledExtensions: string[] | null
  /** The default features for this vendor type (before custom overrides) */
  defaultFeatures: VendorFeatures
}

const VendorTypeContext = createContext<VendorTypeContextValue | null>(null)

/**
 * Get default feature flags for a specific vendor type
 */
export function getFeaturesByType(type: VendorType): VendorFeatures {
  const featureMap: Record<VendorType, VendorFeatures> = {
    producer: {
      hasProducts: true,
      hasInventory: true,
      hasSeasons: true,
      hasVolunteers: false,
      hasMenu: false,
      hasDeliveryZones: false,
      hasDonations: false,
      hasSubscriptions: true,
      hasSupport: true,
      hasHarvests: true,
      hasPlots: false,
      hasRequests: false,
      hasFarm: true,
      hasShows: false,
    },
    garden: {
      hasProducts: true,
      hasInventory: false,
      hasSeasons: true,
      hasVolunteers: true,
      hasMenu: false,
      hasDeliveryZones: false,
      hasDonations: true,
      hasSubscriptions: true,
      hasSupport: true,
      hasHarvests: true,
      hasPlots: true,
      hasRequests: false,
      hasFarm: true,
      hasShows: false,
    },
    kitchen: {
      hasProducts: true,
      hasInventory: true,
      hasSeasons: false,
      hasVolunteers: true,
      hasMenu: true,
      hasDeliveryZones: true,
      hasDonations: true,
      hasSubscriptions: true,
      hasSupport: true,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: true,
      hasFarm: false,
      hasShows: false,
    },
    maker: {
      hasProducts: true,
      hasInventory: true,
      hasSeasons: false,
      hasVolunteers: false,
      hasMenu: false,
      hasDeliveryZones: false,
      hasDonations: false,
      hasSubscriptions: false,
      hasSupport: true,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: false,
      hasFarm: false,
      hasShows: false,
    },
    restaurant: {
      hasProducts: false,
      hasInventory: false,
      hasSeasons: false,
      hasVolunteers: false,
      hasMenu: true,
      hasDeliveryZones: true,
      hasDonations: false,
      hasSubscriptions: false,
      hasSupport: false,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: false,
      hasFarm: false,
      hasShows: true,
    },
    mutual_aid: {
      hasProducts: false,
      hasInventory: true,
      hasSeasons: false,
      hasVolunteers: true,
      hasMenu: false,
      hasDeliveryZones: true,
      hasDonations: true,
      hasSubscriptions: false,
      hasSupport: false,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: true,
      hasFarm: false,
      hasShows: false,
    },
    // Mirrors the backend `stall` playbook recipe, which is what
    // `general` maps to server-side — products, inventory, support.
    general: {
      hasProducts: true,
      hasInventory: true,
      hasSeasons: false,
      hasVolunteers: false,
      hasMenu: false,
      hasDeliveryZones: false,
      hasDonations: false,
      hasSubscriptions: false,
      hasSupport: true,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: false,
      hasFarm: false,
      hasShows: false,
    },
    // Creators sell digital goods and services; no inventory or food surfaces.
    creator: {
      hasProducts: true,
      hasInventory: false,
      hasSeasons: false,
      hasVolunteers: false,
      hasMenu: false,
      hasDeliveryZones: false,
      hasDonations: false,
      hasSubscriptions: true,
      hasSupport: true,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: false,
      hasFarm: false,
      hasShows: false,
    },
    default: {
      hasProducts: true,
      hasInventory: true,
      hasSeasons: false,
      hasVolunteers: false,
      hasMenu: false,
      hasDeliveryZones: false,
      hasDonations: false,
      hasSubscriptions: false,
      hasSupport: false,
      hasHarvests: false,
      hasPlots: false,
      hasRequests: false,
      hasFarm: false,
      hasShows: false,
    },
  }

  // Fall back to the sentinel rather than returning `undefined` for a value
  // that slipped past the allowlist — every consumer dereferences this.
  return featureMap[type] ?? featureMap.default
}

/**
 * Build VendorFeatures from an array of enabled extension keys.
 * Any key in the array is true; all others are false.
 */
function buildFeaturesFromExtensions(enabledExtensions: string[]): VendorFeatures {
  const features: VendorFeatures = {
    hasProducts: false,
    hasInventory: false,
    hasSeasons: false,
    hasVolunteers: false,
    hasMenu: false,
    hasDeliveryZones: false,
    hasDonations: false,
    hasSubscriptions: false,
    hasSupport: false,
    hasHarvests: false,
    hasPlots: false,
    hasRequests: false,
    hasFarm: false,
    hasShows: false,
  }

  for (const key of enabledExtensions) {
    if (key in features) {
      features[key as keyof VendorFeatures] = true
    }
  }

  return features
}

/**
 * Get human-readable labels for vendor types
 */
function getTypeLabels(type: VendorType): { label: string; plural: string } {
  const labels: Record<VendorType, { label: string; plural: string }> = {
    producer: { label: "Grower & Producer", plural: "Growers & Producers" },
    garden: { label: "Community Growing Space", plural: "Community Growing Spaces" },
    kitchen: { label: "Shared Kitchen", plural: "Shared Kitchens" },
    maker: { label: "Maker & Brand", plural: "Makers & Brands" },
    restaurant: { label: "Food Business", plural: "Food Businesses" },
    mutual_aid: { label: "Community Organization", plural: "Community Organizations" },
    creator: { label: "Creator", plural: "Creators" },
    general: { label: "Business", plural: "Businesses" },
    default: { label: "Vendor", plural: "Vendors" },
  }
  return labels[type] ?? labels.default
}

/**
 * Provider component that wraps the app and provides vendor type context.
 *
 * When a vendor has custom `enabled_extensions` saved, those override
 * the default features for their vendor type. When null, defaults apply.
 */
export function VendorTypeProvider({ children }: { children: ReactNode }) {
  const { seller, isPending } = useMe()

  // Get vendor type from seller or default
  const vendorType: VendorType = useMemo(() => {
    const type = seller?.vendor_type as VendorType
    if (type && (BACKEND_VENDOR_TYPES as readonly string[]).includes(type)) {
      return type
    }
    return "default"
  }, [seller?.vendor_type])

  // Get the raw enabled_extensions from the seller.
  // An empty array means "custom selection with everything disabled" and
  // must not fall back to vendor-type defaults.
  const enabledExtensions = useMemo(() => {
    const directExtensions = seller?.enabled_extensions
    if (Array.isArray(directExtensions)) {
      return directExtensions as string[]
    }

    const metadataExtensions = seller?.metadata?.enabled_extensions
    if (Array.isArray(metadataExtensions)) {
      return metadataExtensions as string[]
    }

    return null
  }, [seller?.enabled_extensions, seller?.metadata?.enabled_extensions])

  // Default features for this vendor type (before custom overrides)
  const defaultFeatures = useMemo(() => getFeaturesByType(vendorType), [vendorType])

  // Resolved features: use custom selections if set, otherwise type defaults
  const features = useMemo(() => {
    if (enabledExtensions) {
      return buildFeaturesFromExtensions(enabledExtensions)
    }
    return defaultFeatures
  }, [enabledExtensions, defaultFeatures])

  const { label: typeLabel, plural: typeLabelPlural } = useMemo(
    () => getTypeLabels(vendorType),
    [vendorType]
  )

  const value: VendorTypeContextValue = {
    vendorType,
    isLoading: isPending,
    features,
    typeLabel,
    typeLabelPlural,
    enabledExtensions,
    defaultFeatures,
  }

  return (
    <VendorTypeContext.Provider value={value}>
      {children}
    </VendorTypeContext.Provider>
  )
}

/**
 * Hook to access vendor type context
 */
export function useVendorType() {
  const context = useContext(VendorTypeContext)
  if (!context) {
    throw new Error("useVendorType must be used within VendorTypeProvider")
  }
  return context
}

/**
 * Hook for conditional rendering based on vendor type
 */
export function useIsVendorType(...types: VendorType[]) {
  const { vendorType } = useVendorType()
  return types.includes(vendorType)
}
