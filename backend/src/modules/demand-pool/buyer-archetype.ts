import { DemandPostVisibility } from "./models/demand-post"

/**
 * Buyer archetypes — behavioural categories for demand, with defaults.
 *
 * The demand-side mirror of `product-archetype`: a category that supplies
 * sensible defaults, which any explicitly-provided field overrides. Code is the
 * source of truth, following `vendor-plan/catalog.ts` — these are referenced as
 * literals by callers, so a typo should be a compile error rather than a
 * silently-wrong default at runtime.
 *
 * The point of the set is `GENERAL`. Posting a want must not require a
 * cooperative, a buyer network, a vertical, or any other FBM-specific concept —
 * otherwise the Buyer Hub cannot be used outside FBM, which is the whole
 * premise of it being a standalone product. Every other archetype here is an
 * opt-in refinement of that baseline, never a prerequisite.
 *
 * Deliberately NOT persisted. These are defaults applied at creation time, not
 * state carried on the post: a stored archetype would drift from the values it
 * produced the moment the catalog changed, and nothing reads it afterwards.
 * A per-buyer stored assignment (à la `product_archetype_assignment`) is the
 * natural follow-up if archetypes ever need to be overridden per account.
 */
export const BUYER_ARCHETYPE_CODES = [
  "GENERAL",
  "HOUSEHOLD",
  "BUYING_CLUB",
  "ORGANIZATION",
  "MUTUAL_AID",
] as const

export type BuyerArchetypeCode = (typeof BUYER_ARCHETYPE_CODES)[number]

const CODE_SET: ReadonlySet<string> = new Set(BUYER_ARCHETYPE_CODES)

export function isBuyerArchetypeCode(v: unknown): v is BuyerArchetypeCode {
  return typeof v === "string" && CODE_SET.has(v)
}

export type BuyerArchetypeDefaults = {
  /** How long the pool stays open when the caller gives no deadline. */
  deadline_days: number
  /** Whether the deadline is a hard cutoff or advisory. */
  deadline_type: "HARD" | "SOFT"
  visibility: DemandPostVisibility
  /**
   * Fraction of `target_quantity` that must be committed to unlock the buy,
   * used only when the caller does not state `min_quantity` outright.
   */
  min_quantity_ratio: number
  unit_of_measure: string
}

export const BUYER_ARCHETYPES: Record<BuyerArchetypeCode, BuyerArchetypeDefaults> = {
  /**
   * The generic baseline, and the fallback for anything unrecognised. Assumes
   * nothing about who is buying or what network they belong to.
   */
  GENERAL: {
    deadline_days: 30,
    deadline_type: "SOFT",
    visibility: DemandPostVisibility.PUBLIC,
    min_quantity_ratio: 0.5,
    unit_of_measure: "units",
  },

  /** One person or family. Small, and usually wanted sooner than later. */
  HOUSEHOLD: {
    deadline_days: 14,
    deadline_type: "SOFT",
    visibility: DemandPostVisibility.PUBLIC,
    min_quantity_ratio: 0.5,
    unit_of_measure: "units",
  },

  /**
   * A standing group buying together. Higher unlock threshold because the
   * point is aggregate leverage, not any single member's order.
   */
  BUYING_CLUB: {
    deadline_days: 30,
    deadline_type: "SOFT",
    visibility: DemandPostVisibility.NETWORK_ONLY,
    min_quantity_ratio: 0.75,
    unit_of_measure: "units",
  },

  /**
   * A business or institution procuring. Hard deadline: procurement windows
   * are usually real dates, not aspirations.
   */
  ORGANIZATION: {
    deadline_days: 45,
    deadline_type: "HARD",
    visibility: DemandPostVisibility.PUBLIC,
    min_quantity_ratio: 1,
    unit_of_measure: "units",
  },

  /**
   * Demand posted on behalf of people in need. The lowest threshold in the
   * set, because partial fulfilment still helps someone — waiting for a full
   * pool would be the wrong failure mode here.
   */
  MUTUAL_AID: {
    deadline_days: 21,
    deadline_type: "SOFT",
    visibility: DemandPostVisibility.PUBLIC,
    min_quantity_ratio: 0.25,
    unit_of_measure: "units",
  },
}

export function resolveBuyerArchetype(code?: string | null): BuyerArchetypeDefaults {
  return isBuyerArchetypeCode(code) ? BUYER_ARCHETYPES[code] : BUYER_ARCHETYPES.GENERAL
}

type DemandPostDefaultable = {
  target_quantity: number
  min_quantity?: number
  unit_of_measure?: string
  deadline?: Date
  deadline_type?: string
  visibility?: string
  buyer_archetype?: string | null
}

/**
 * Fill in whatever the caller left out, from the archetype's defaults.
 *
 * Explicit input always wins — this only supplies absent values. An archetype
 * that could overwrite what someone actually typed would be a trap rather than
 * a convenience.
 */
export function applyBuyerArchetypeDefaults<T extends DemandPostDefaultable>(
  input: T,
  now: Date = new Date()
): T & {
  min_quantity: number
  unit_of_measure: string
  deadline: Date
  deadline_type: string
  visibility: string
} {
  const defaults = resolveBuyerArchetype(input.buyer_archetype)

  const minQuantity =
    input.min_quantity ??
    // At least 1: a ratio that rounds to zero would make the pool unlock
    // before anyone had committed anything.
    Math.max(1, Math.round(input.target_quantity * defaults.min_quantity_ratio))

  const deadline =
    input.deadline ??
    new Date(now.getTime() + defaults.deadline_days * 24 * 60 * 60 * 1000)

  return {
    ...input,
    min_quantity: minQuantity,
    unit_of_measure: input.unit_of_measure ?? defaults.unit_of_measure,
    deadline,
    deadline_type: input.deadline_type ?? defaults.deadline_type,
    visibility: input.visibility ?? defaults.visibility,
  }
}
