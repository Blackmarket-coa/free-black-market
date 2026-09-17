/**
 * The coalition KARMA ladder.
 *
 * This is a **different ladder from `GROWER_TIERS`**, and the distinction is
 * the whole reason this file exists. `GROWER_TIERS` is keyed on `seller_id`,
 * fed by PRODUCER-stance XP, and each of its rungs sets a payout `split_pct` —
 * it measures selling, and its numbers are money. A community organizer who
 * has never sold anything has no grower tier at all.
 *
 * Blackout asks a different question: has this person shown up for coalition
 * work? That is exactly what COALITION-stance XP already records, written by
 * `coalition-karma.ts` from Blackout's own events. Until now nothing read it
 * back, so Blackout's join gate read a field that did not exist and resolved
 * everyone to the floor.
 *
 * Two properties are deliberate and load-bearing:
 *
 *  1. **Not purchasable.** `effectiveGrowerTier` lets a paid plan floor raise a
 *     grower's tier without earning it. There is no plan floor here and there
 *     must never be one: a coalition deciding who may join is not a thing a
 *     subscription should be able to answer.
 *  2. **Not money.** Nothing downstream of this tier sets a rate, a price, or
 *     access to an offering — `thresholds.ts` records why reputation and
 *     capital are required to stay structurally separate. This tier is read by
 *     one consumer, Blackout's optional minimum-tier-to-join gate, and it
 *     decides only whether a join is admitted or sent to a steward.
 *
 * The rung names match `GROWER_TIERS` because they are the ecosystem's shared
 * vocabulary for standing, not because the two ladders agree — the thresholds
 * are scaled to the coalition deltas (5–30 per event), so Sprout is roughly one
 * completed drive rather than fifty units sold.
 */

/** Minimum COALITION-stance XP for each rung. */
export const COALITION_TIERS = {
  seedling: { min: 0 },
  sprout: { min: 25 },
  root: { min: 100 },
  canopy: { min: 300 },
  ancestor: { min: 750 },
} as const

export type CoalitionTierName = keyof typeof COALITION_TIERS

/** Lowest to highest. Index order is the comparison order. */
export const COALITION_TIER_ORDER: CoalitionTierName[] = [
  "seedling",
  "sprout",
  "root",
  "canopy",
  "ancestor",
]

/** Pure: map a COALITION-stance XP total to its rung. Floors at seedling. */
export function coalitionTierForXp(xp: number): CoalitionTierName {
  let tier: CoalitionTierName = "seedling"
  for (const name of COALITION_TIER_ORDER) {
    if (xp >= COALITION_TIERS[name].min) tier = name
  }
  return tier
}

/** Position in the ladder (0 = seedling); `-1` for an unknown name. */
export function coalitionTierIndex(tier: CoalitionTierName): number {
  return COALITION_TIER_ORDER.indexOf(tier)
}

/** Coerce an arbitrary string to a `CoalitionTierName`, or `null`. */
export function asCoalitionTierName(
  value: string | null | undefined
): CoalitionTierName | null {
  if (value && (COALITION_TIER_ORDER as readonly string[]).includes(value)) {
    return value as CoalitionTierName
  }
  return null
}
