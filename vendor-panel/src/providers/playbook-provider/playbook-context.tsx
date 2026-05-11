import { createContext, useContext, ReactNode, useMemo } from "react"
import { useMe } from "../../hooks/api/users"

/**
 * Playbook is the cooperative-economic shape a vendor picks at setup.
 * Replaces the legacy `vendor-type` concept; see
 * `docs/PLAYBOOK_SYSTEM.md` for the matrix.
 *
 * Backend source of truth lives in
 * `backend/src/modules/playbook/recipes/<id>.ts`.
 */
export type Playbook =
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
  | "default"

/**
 * Feature flags surfaced on the vendor-panel for a playbook. These keys
 * are the canonical 14-key extension set declared by the legacy
 * `vendor-type-provider`. They carry forward unchanged so existing
 * navigation / dashboard guards keep working through the rename.
 */
export interface PlaybookFeatures {
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

export const ALL_EXTENSION_OPTIONS: {
  key: keyof PlaybookFeatures
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

export const ALL_FEATURE_KEYS: (keyof PlaybookFeatures)[] =
  ALL_EXTENSION_OPTIONS.map((o) => o.key)

type PlaybookContextValue = {
  playbook: Playbook
  isLoading: boolean
  features: PlaybookFeatures
  typeLabel: string
  typeLabelPlural: string
  enabledExtensions: string[] | null
  defaultFeatures: PlaybookFeatures
}

const PlaybookContext = createContext<PlaybookContextValue | null>(null)

const EMPTY_FEATURES: PlaybookFeatures = {
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

/**
 * Map legacy `vendor_type` values to the new playbook ids. The seller
 * row may carry either field while migration progresses; this lookup
 * is non-destructive — `vendor_type` stays as a denormalized read
 * cache, the source of truth is the `playbook_assignment` row keyed
 * to the seller_id.
 */
const LEGACY_VENDOR_TYPE_MAP: Record<string, Playbook> = {
  producer: "cycle",
  garden: "harvest",
  kitchen: "kitchen",
  restaurant: "kitchen",
  maker: "stall",
  mutual_aid: "grove",
}

const VALID_PLAYBOOKS: Playbook[] = [
  "stall",
  "atelier",
  "grove",
  "workshop",
  "commons",
  "cycle",
  "kitchen",
  "harvest",
  "hub",
  "service",
]

/**
 * Default feature flags for each playbook.
 *
 * Keep this matrix in sync with the recipe `default_features` blocks at
 * `backend/src/modules/playbook/recipes/*.ts` and the documented
 * matrix in `docs/PLAYBOOK_SYSTEM.md`.
 */
export function getFeaturesByPlaybook(playbook: Playbook): PlaybookFeatures {
  const map: Record<Playbook, PlaybookFeatures> = {
    stall: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasSupport: true,
    },
    atelier: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasSupport: true,
    },
    grove: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasVolunteers: true,
      hasDonations: true,
      hasSupport: true,
      hasRequests: true,
    },
    workshop: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasSupport: true,
      hasRequests: true,
    },
    commons: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasVolunteers: true,
      hasDonations: true,
      hasSupport: true,
      hasRequests: true,
    },
    cycle: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasSeasons: true,
      hasSubscriptions: true,
      hasHarvests: true,
      hasFarm: true,
      hasSupport: true,
    },
    kitchen: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasMenu: true,
      hasDeliveryZones: true,
      hasShows: true,
      hasRequests: true,
    },
    harvest: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasSeasons: true,
      hasVolunteers: true,
      hasDonations: true,
      hasSubscriptions: true,
      hasHarvests: true,
      hasPlots: true,
      hasFarm: true,
      hasSupport: true,
    },
    hub: {
      ...EMPTY_FEATURES,
      hasProducts: true,
      hasInventory: true,
      hasDeliveryZones: true,
      hasSupport: true,
      hasRequests: true,
    },
    service: {
      ...EMPTY_FEATURES,
      hasSubscriptions: true,
      hasSupport: true,
      hasRequests: true,
    },
    default: { ...EMPTY_FEATURES, hasProducts: true, hasInventory: true },
  }
  return map[playbook]
}

function buildFeaturesFromExtensions(enabledExtensions: string[]): PlaybookFeatures {
  const features: PlaybookFeatures = { ...EMPTY_FEATURES }
  for (const key of enabledExtensions) {
    if (key in features) {
      features[key as keyof PlaybookFeatures] = true
    }
  }
  return features
}

function getTypeLabels(playbook: Playbook): { label: string; plural: string } {
  const labels: Record<Playbook, { label: string; plural: string }> = {
    stall: { label: "Stall", plural: "Stalls" },
    atelier: { label: "Atelier", plural: "Ateliers" },
    grove: { label: "Grove", plural: "Groves" },
    workshop: { label: "Workshop", plural: "Workshops" },
    commons: { label: "Commons", plural: "Commons" },
    cycle: { label: "Cycle", plural: "Cycles" },
    kitchen: { label: "Kitchen", plural: "Kitchens" },
    harvest: { label: "Harvest", plural: "Harvests" },
    hub: { label: "Hub", plural: "Hubs" },
    service: { label: "Service", plural: "Services" },
    default: { label: "Vendor", plural: "Vendors" },
  }
  return labels[playbook]
}

function resolvePlaybookFromSeller(seller: any): Playbook {
  // Prefer the new explicit playbook field (will be set once
  // playbook-assignment is written via the picker).
  const direct = seller?.playbook
  if (typeof direct === "string" && (VALID_PLAYBOOKS as string[]).includes(direct)) {
    return direct as Playbook
  }
  // Fall back to legacy vendor_type mapping for unmigrated sellers.
  const legacy = seller?.vendor_type
  if (typeof legacy === "string" && legacy in LEGACY_VENDOR_TYPE_MAP) {
    return LEGACY_VENDOR_TYPE_MAP[legacy]
  }
  return "default"
}

/**
 * Provider component that wraps the app and exposes the seller's
 * playbook. Reads from the seller record; falls back to legacy
 * `vendor_type` for unmigrated sellers.
 */
export function PlaybookProvider({ children }: { children: ReactNode }) {
  const { seller, isPending } = useMe()

  const playbook: Playbook = useMemo(
    () => resolvePlaybookFromSeller(seller),
    [seller]
  )

  const enabledExtensions = useMemo(() => {
    const direct = seller?.enabled_extensions
    if (Array.isArray(direct)) {
      return direct as string[]
    }
    const meta = seller?.metadata?.enabled_extensions
    if (Array.isArray(meta)) {
      return meta as string[]
    }
    return null
  }, [seller?.enabled_extensions, seller?.metadata?.enabled_extensions])

  const defaultFeatures = useMemo(
    () => getFeaturesByPlaybook(playbook),
    [playbook]
  )

  const features = useMemo(() => {
    if (enabledExtensions) {
      return buildFeaturesFromExtensions(enabledExtensions)
    }
    return defaultFeatures
  }, [enabledExtensions, defaultFeatures])

  const { label: typeLabel, plural: typeLabelPlural } = useMemo(
    () => getTypeLabels(playbook),
    [playbook]
  )

  const value: PlaybookContextValue = {
    playbook,
    isLoading: isPending,
    features,
    typeLabel,
    typeLabelPlural,
    enabledExtensions,
    defaultFeatures,
  }

  return (
    <PlaybookContext.Provider value={value}>
      {children}
    </PlaybookContext.Provider>
  )
}

export function usePlaybook() {
  const context = useContext(PlaybookContext)
  if (!context) {
    throw new Error("usePlaybook must be used within PlaybookProvider")
  }
  return context
}

/**
 * Conditional-rendering helper. True when the seller's playbook is one
 * of the supplied values.
 */
export function useIsPlaybook(...playbooks: Playbook[]) {
  const { playbook } = usePlaybook()
  return playbooks.includes(playbook)
}
