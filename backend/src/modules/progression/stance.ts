import { VendorType } from "../seller-extension/models/seller-metadata"

/**
 * Stance — the active "role" a user is playing in the economy.
 *
 * The Solarpunk-MMORPG vision organizes the marketplace around people and the
 * role they're taking on right now rather than around products. A user can
 * switch stance instantly (like changing class in an RPG). Stance is a superset
 * alignment of the seller-side `VendorType` enum:
 *
 *   - PRODUCER / CREATOR map 1:1 onto VendorType (seller-side roles).
 *   - CONSUMER / INVESTOR / COALITION are buyer/community-side roles that have
 *     no VendorType equivalent.
 *
 * Stance is stored per-customer on the character sheet (single source of truth)
 * and mirrored into a storefront cookie for instant SSR theming.
 */
export enum Stance {
  PRODUCER = "producer",
  CONSUMER = "consumer",
  INVESTOR = "investor",
  COALITION = "coalition",
  CREATOR = "creator",
}

export const ALL_STANCES: Stance[] = Object.values(Stance)

/** The XP tracks tracked on a character sheet (one per stance). */
export const XP_TRACKS = ALL_STANCES

/**
 * Map a seller's VendorType to the stance it most naturally aligns with.
 * Most vendor types are PRODUCER-flavored; CREATOR maps 1:1.
 */
export function vendorTypeToStance(vendorType: VendorType | string): Stance {
  switch (vendorType) {
    case VendorType.CREATOR:
      return Stance.CREATOR
    case VendorType.MUTUAL_AID:
      return Stance.COALITION
    case VendorType.PRODUCER:
    case VendorType.GARDEN:
    case VendorType.KITCHEN:
    case VendorType.MAKER:
    case VendorType.RESTAURANT:
    // A `general` vendor sells goods or services, so it earns on the producer
    // track. Listed explicitly rather than left to the default so that adding
    // an archetype is a deliberate decision here rather than a silent one.
    case VendorType.GENERAL:
      return Stance.PRODUCER
    default:
      return Stance.PRODUCER
  }
}

/**
 * Map a stance back to a representative VendorType where one exists. Returns
 * null for buyer-side stances (CONSUMER / INVESTOR / COALITION) that have no
 * seller classification.
 */
export function stanceToVendorType(stance: Stance): VendorType | null {
  switch (stance) {
    case Stance.PRODUCER:
      return VendorType.PRODUCER
    case Stance.CREATOR:
      return VendorType.CREATOR
    case Stance.COALITION:
      return VendorType.MUTUAL_AID
    default:
      return null
  }
}

export function isStance(value: unknown): value is Stance {
  return typeof value === "string" && ALL_STANCES.includes(value as Stance)
}
