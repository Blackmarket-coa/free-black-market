/**
 * Plant Network — Grower-node KARMA events (Section 7).
 *
 * Built on the existing `progression` module — XP is recorded via
 * `recordXpEvent` on the PRODUCER track (soulbound, keyed by customer_id). A
 * grower is a MercurJS seller; we resolve its character-sheet subject the same
 * way `subscribers/progression-vendor-verified.ts` does: the seller's primary
 * member id. Tier is read back from the PRODUCER track XP and mapped onto the
 * named grower ladder.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "./index"
import type ProgressionModuleService from "./service"
import { Stance } from "./stance"
import { getSellerPlanLimits } from "../../shared/seller-plan"

export type GrowerKarmaEventType =
  | "units_sold"
  | "rare_species_produced"
  | "on_time_delivery"
  | "five_star_review"
  | "node_to_node_transfer"
  | "seasonal_deadline_met"

/** KARMA delta per event (per unit, where applicable). */
export const GROWER_KARMA_DELTAS: Record<GrowerKarmaEventType, number> = {
  units_sold: 1,
  rare_species_produced: 10,
  on_time_delivery: 5,
  five_star_review: 15,
  node_to_node_transfer: 3,
  seasonal_deadline_met: 20,
}

/**
 * The KARMA ladder — **the source of truth for what growers are actually paid.**
 *
 * `split_pct` is the grower's share of a node sale. `effectiveGrowerTier` reads
 * this table, and `modules/payout-breakdown/grower-payout.ts` posts the result
 * as a real `COMMISSION` transfer. A number changed here changes money.
 *
 * The 60 → 72% ladder is deliberate and confirmed, not a placeholder. It was
 * briefly ambiguous: `packages/bmc-portal-kit/src/tiers.ts` carried a second,
 * higher ladder (Ancestor at 1000 KARMA / 85%) whose header wrongly asserted the
 * two agreed. `KarmaBar` renders that ladder, so growers on the nursery portal
 * were shown a threshold they would not be promoted at and a split nobody would
 * pay. The portal now mirrors this table.
 *
 * **Changing the ladder:** edit here first, then mirror into
 * `packages/bmc-portal-kit/src/tiers.ts` (percentages there, fractions here) —
 * `tiers.parity.spec.ts` parses this table and fails if they diverge. Note that
 * a raise applies to every future payout immediately, and that the public
 * `/karma` page and `GET /store/karma-ladder` publish these numbers.
 */
export const GROWER_TIERS = {
  Seedling: { min: 0, split_pct: 0.6 },
  Sprout: { min: 50, split_pct: 0.62 },
  Root: { min: 200, split_pct: 0.65 },
  Canopy: { min: 500, split_pct: 0.68 },
  Ancestor: { min: 1500, split_pct: 0.72 },
} as const

export type GrowerTierName = keyof typeof GROWER_TIERS

export const TIER_ORDER: GrowerTierName[] = [
  "Seedling",
  "Sprout",
  "Root",
  "Canopy",
  "Ancestor",
]

/** Pure: map a PRODUCER-track XP total to its grower tier. Extracted for testing. */
export function growerTierForXp(xp: number): GrowerTierName {
  let tier: GrowerTierName = "Seedling"
  for (const name of TIER_ORDER) {
    if (xp >= GROWER_TIERS[name].min) tier = name
  }
  return tier
}

/** Position of a tier in the ladder (0 = Seedling). `-1` for an unknown name. */
export function growerTierIndex(tier: GrowerTierName): number {
  return TIER_ORDER.indexOf(tier)
}

/** Coerce an arbitrary string to a `GrowerTierName`, or `null` if it isn't one. */
export function asGrowerTierName(
  value: string | null | undefined
): GrowerTierName | null {
  if (value && (TIER_ORDER as readonly string[]).includes(value)) {
    return value as GrowerTierName
  }
  return null
}

/**
 * A grower's effective tier: the higher of what their KARMA earned and what
 * their billing plan floors them to.
 *
 * This is the earned-vs-bought duality at the center of Phase 3. A plan floor
 * can only ever RAISE a grower's tier — buying a plan skips them ahead — never
 * lower it, so a grower who earned Canopy through activity keeps Canopy even on
 * the free plan. `floored_by_plan` records which half won, so a surface can say
 * "included with your plan" instead of implying the tier was earned.
 *
 * An absent or unrecognized `planFloor` makes no tier claim: the grower's tier
 * is exactly what their karma earned. Pure — no I/O — so the rule can be
 * asserted directly, mirroring `growerTierForXp`.
 */
export function effectiveGrowerTier(
  xp: number,
  planFloor: string | null | undefined
): { tier: GrowerTierName; floored_by_plan: boolean } {
  const earned = growerTierForXp(xp)
  const floor = asGrowerTierName(planFloor)
  if (floor && growerTierIndex(floor) > growerTierIndex(earned)) {
    return { tier: floor, floored_by_plan: true }
  }
  return { tier: earned, floored_by_plan: false }
}

export interface EmitGrowerKarmaInput {
  seller_id: string
  event_type: GrowerKarmaEventType
  /** Multiplier for per-unit events (e.g. quantity sold). Default 1. */
  units?: number
  reference_id: string
  metadata?: Record<string, unknown>
}

type QueryLike = { graph: (args: Record<string, unknown>) => Promise<{ data: any[] }> }

export class GrowerKarmaService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get query(): QueryLike {
    return this.container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  }

  private get progression(): ProgressionModuleService {
    return this.container.resolve(PROGRESSION_MODULE) as ProgressionModuleService
  }

  /**
   * Resolve the progression subject (customer_id) for a grower seller: its
   * primary member id. Returns null if unresolved (caller should skip, not throw)
   * — mirrors the fuzziness handled in progression-vendor-verified.
   */
  async resolveGrowerCustomerId(sellerId: string): Promise<string | null> {
    try {
      const { data: sellers } = await this.query.graph({
        entity: "seller",
        fields: ["id", "members.id"],
        filters: { id: sellerId },
      })
      return sellers?.[0]?.members?.[0]?.id ?? null
    } catch {
      return null
    }
  }

  /**
   * Award grower KARMA (PRODUCER-track XP). No-op (returns false) if the subject
   * can't be resolved, so callers in subscribers stay non-fatal.
   */
  async emitGrowerKarmaEvent(input: EmitGrowerKarmaInput): Promise<boolean> {
    const customerId = await this.resolveGrowerCustomerId(input.seller_id)
    if (!customerId) return false

    const units = input.units && input.units > 0 ? input.units : 1
    const amount = GROWER_KARMA_DELTAS[input.event_type] * units

    await this.progression.recordXpEvent({
      customer_id: customerId,
      role: Stance.PRODUCER,
      amount,
      reason: `grower:${input.event_type}`,
      source_module: "plant_network",
      source_id: input.reference_id,
      metadata: { ...input.metadata, grower_seller_id: input.seller_id, event_type: input.event_type },
    })
    return true
  }

  /**
   * Current grower tier + progress.
   *
   * The tier is the higher of what PRODUCER-track KARMA earned and what the
   * seller's billing plan floors them to (`effectiveGrowerTier`) — a Pro/Scale
   * seller starts partway up the ladder, while a free seller who has earned a
   * higher tier through activity keeps it. `tier_floored_by_plan` says which
   * half won. The plan read never fails the request: `getSellerPlanLimits`
   * degrades to the free tier (which floors nothing) on error, so a plan-service
   * blip leaves the grower on their earned tier rather than 500-ing a payout
   * page.
   */
  async getGrowerTier(sellerId: string): Promise<{
    current_karma: number
    tier: GrowerTierName
    next_tier: GrowerTierName | null
    karma_to_next: number | null
    current_split_pct: number
    tier_floored_by_plan: boolean
  }> {
    const customerId = await this.resolveGrowerCustomerId(sellerId)
    let producerXp = 0
    if (customerId) {
      const summary = await this.progression.getCharacterSheetSummary(customerId)
      producerXp = summary.tracks.find((t) => t.role === Stance.PRODUCER)?.xp ?? 0
    }

    const { limits } = await getSellerPlanLimits(this.container, sellerId)
    const { tier, floored_by_plan } = effectiveGrowerTier(
      producerXp,
      limits.grower_tier_floor
    )

    const idx = TIER_ORDER.indexOf(tier)
    const nextTier = idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null
    // Karma still needed to earn PAST the current (possibly plan-floored) tier.
    // When a plan floored them above their earned karma this is the distance to
    // the next rung on their own steam — honest about what activity still buys.
    const karmaToNext = nextTier ? GROWER_TIERS[nextTier].min - producerXp : null

    return {
      current_karma: producerXp,
      tier,
      next_tier: nextTier,
      karma_to_next: karmaToNext,
      current_split_pct: GROWER_TIERS[tier].split_pct,
      tier_floored_by_plan: floored_by_plan,
    }
  }
}
