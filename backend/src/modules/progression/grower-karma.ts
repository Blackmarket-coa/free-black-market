/**
 * Plant Network — Grower-node KARMA events (Section 7).
 *
 * KARMA/XP already exists; do NOT build a parallel system:
 *   - `modules/progression/service.ts` → soulbound XP (EIP-5192/4973),
 *     `recordXpEvent` / `recordAttestedXpEvent`, role tracks (CONSUMER, PRODUCER,
 *     INVESTOR, COALITION, CREATOR), level thresholds + earned titles.
 *   - `modules/hawala-ledger`          → the closed-loop **KARMA** rail
 *     (`rails.ts`, RailCode "KARMA") + KarmaEvent model.
 *
 * What is MISSING: grower-specific event *types* and a node→tier mapping. These
 * stubs translate grower activity into the EXISTING `recordXpEvent` on the
 * PRODUCER track (and/or a KARMA-rail entry), then read the tier back. The named
 * grower tiers below are an application-level ladder layered over progression
 * levels — keep them in sync with `GROWER_SPLIT_CONFIG` in
 * `payout-breakdown/grower-payout.ts`.
 */

export type GrowerKarmaEventType =
  | "units_sold" // +1 per unit sold
  | "rare_species_produced" // +10 per rare-species unit sold
  | "on_time_delivery" // +5 per fulfillment < 3 days after dispatch
  | "five_star_review" // +15 per 5-star review on the grower's products
  | "node_to_node_transfer" // +3 per inter-node cutting-stock transfer
  | "seasonal_deadline_met" // +20 for fulfilling an Order Cycle on time
  | "1099_threshold_reached" // tracking only; no KARMA

export interface GrowerKarmaEvent {
  grower_node: string
  event_type: GrowerKarmaEventType
  karma_delta: number
  reference_id: string // order_id / review_id / fulfillment_id ...
  metadata?: Record<string, unknown>
  created_at: Date
}

export const GROWER_TIERS = {
  Seedling: { min: 0, split_pct: 0.6, perks: ["Standard listing priority"] },
  Sprout: {
    min: 50,
    split_pct: 0.62,
    perks: ["Featured listing eligibility", "+2% split"],
  },
  Root: {
    min: 200,
    split_pct: 0.65,
    perks: ["Cutting stock subscription access", "+5% split"],
  },
  Canopy: {
    min: 500,
    split_pct: 0.68,
    perks: ["Governance voting rights", "+8% split", "Rare species allocation"],
  },
  Ancestor: {
    min: 1500,
    split_pct: 0.72,
    perks: [
      "Network co-owner stake",
      "+12% split",
      "Priority allocation of all species",
    ],
  },
} as const

export type GrowerTierName = keyof typeof GROWER_TIERS

export class GrowerKarmaService {
  /**
   * TODO: Translate a grower event into the EXISTING progression system:
   * resolve the node's customer/producer, call `recordXpEvent` on the PRODUCER
   * track with `karma_delta`, and/or write a hawala KARMA-rail entry. Tier
   * upgrades fall out of progression's level math + `checkAndGrantTitles`.
   */
  async emitGrowerKarmaEvent(
    _event: Omit<GrowerKarmaEvent, "created_at">
  ): Promise<void> {
    throw new Error("TODO: GrowerKarmaService.emitGrowerKarmaEvent not implemented")
  }

  /**
   * TODO: Read current KARMA total for a node (from progression aggregates /
   * hawala KARMA balance) and map it to the GROWER_TIERS ladder.
   */
  async getGrowerTier(_grower_node: string): Promise<{
    current_karma: number
    tier: GrowerTierName
    next_tier: GrowerTierName | null
    karma_to_next: number | null
    current_split_pct: number
  }> {
    throw new Error("TODO: GrowerKarmaService.getGrowerTier not implemented")
  }
}
