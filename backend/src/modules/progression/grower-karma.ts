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

  /** Current grower tier + progress, derived from PRODUCER-track XP. */
  async getGrowerTier(sellerId: string): Promise<{
    current_karma: number
    tier: GrowerTierName
    next_tier: GrowerTierName | null
    karma_to_next: number | null
    current_split_pct: number
  }> {
    const customerId = await this.resolveGrowerCustomerId(sellerId)
    let producerXp = 0
    if (customerId) {
      const summary = await this.progression.getCharacterSheetSummary(customerId)
      producerXp = summary.tracks.find((t) => t.role === Stance.PRODUCER)?.xp ?? 0
    }

    const tier = growerTierForXp(producerXp)
    const idx = TIER_ORDER.indexOf(tier)
    const nextTier = idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null
    const karmaToNext = nextTier ? GROWER_TIERS[nextTier].min - producerXp : null

    return {
      current_karma: producerXp,
      tier,
      next_tier: nextTier,
      karma_to_next: karmaToNext,
      current_split_pct: GROWER_TIERS[tier].split_pct,
    }
  }
}
