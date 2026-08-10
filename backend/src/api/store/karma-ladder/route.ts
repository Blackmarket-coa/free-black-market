import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  GROWER_KARMA_DELTAS,
  GROWER_TIERS,
  TIER_ORDER,
  type GrowerTierName,
} from "../../../modules/progression/grower-karma"
import { VENDOR_PLAN_CATALOG } from "../../../modules/vendor-plan/catalog"
import { limitsForPlan } from "../../../modules/vendor-plan/limits"

/**
 * GET /store/karma-ladder
 *
 * The KARMA ladder, published: what each tier pays, what it takes to get
 * there, how KARMA is earned, and — the part a marketing page would omit —
 * which paid plans skip a seller up the ladder without earning it.
 *
 * Served from `GROWER_TIERS`, the table `effectiveGrowerTier` reads and
 * `payout-breakdown/grower-payout.ts` pays against. The storefront is a
 * separate workspace from `@bmc/portal-kit`, so rather than a third copy of
 * these numbers the page reads the same source the money does.
 *
 * Both `/character` and `/rewards` are login-gated, so before this route no
 * prospective vendor could see the benefit ladder — which is precisely where
 * a tier system needs to be visible to do any work.
 */

/**
 * Public description of what a tier unlocks.
 *
 * Deliberately not imported from `@bmc/portal-kit`'s `unlocks` strings: those
 * are documented there as portal display copy that any portal may override,
 * whereas this is the platform's published statement. The split percentages
 * and thresholds, which must not diverge, do come from the shared source.
 */
const TIER_UNLOCKS: Record<GrowerTierName, string> = {
  Seedling: "List and sell, join a node room, take part in order cycles.",
  Sprout: "Activate demand pools and run recurring order cycles of your own.",
  Root: "Governance voting and wholesale listings.",
  Canopy: "Inter-node transfers and restoration contracts.",
  Ancestor: "Hub co-governance and mentoring newer nodes.",
}

/** How KARMA is earned, in the language a vendor would use. */
const EARNING_DESCRIPTIONS: Record<keyof typeof GROWER_KARMA_DELTAS, string> = {
  units_sold: "Each unit sold",
  rare_species_produced: "Producing a rare species",
  on_time_delivery: "Delivering on time",
  five_star_review: "Earning a five-star review",
  node_to_node_transfer: "Supplying another node",
  seasonal_deadline_met: "Hitting a seasonal deadline",
}

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const tiers = TIER_ORDER.map((name, index) => {
    const next = TIER_ORDER[index + 1]
    return {
      name,
      karma_required: GROWER_TIERS[name].min,
      // Stored as a fraction; published as the percentage vendors see.
      split_pct: Math.round(GROWER_TIERS[name].split_pct * 10000) / 100,
      unlocks: TIER_UNLOCKS[name],
      karma_to_next: next ? GROWER_TIERS[next].min - GROWER_TIERS[name].min : null,
    }
  })

  // Which plans floor a seller to a tier they haven't earned. Publishing this
  // is the difference between a progression system and a disguised price list:
  // a vendor grinding toward Root deserves to know it is also purchasable.
  const plan_floors = VENDOR_PLAN_CATALOG.map((plan) => ({
    code: plan.code,
    display_name: plan.display_name,
    grower_tier_floor: limitsForPlan(plan.code).grower_tier_floor,
  })).filter((plan) => plan.grower_tier_floor !== null)

  res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  res.json({
    tiers,
    earning: Object.entries(GROWER_KARMA_DELTAS).map(([event, karma]) => ({
      event,
      karma,
      description:
        EARNING_DESCRIPTIONS[event as keyof typeof GROWER_KARMA_DELTAS],
    })),
    plan_floors,
  })
}

export { TIER_UNLOCKS, EARNING_DESCRIPTIONS }
