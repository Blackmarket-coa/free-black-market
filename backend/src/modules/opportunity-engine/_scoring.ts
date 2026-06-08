/**
 * Opportunity Engine scoring (v1, no ML).
 *
 * Pure, deterministic, unit-testable functions — mirroring the design of
 * `src/api/v1/seller/matching/_ranking.ts`. The service layer assembles raw
 * signals from existing modules (demand-pool, wishlist, cooperative, the
 * product catalog, startup-guide catalog, price observations) and calls these
 * functions. No DB access here.
 *
 * The composite is reported on a 0..10 scale so it reads like the spec's
 * worked example ("Compost … Opportunity Score: 9.1").
 */

export type OpportunitySignals = {
  /** 0..1 normalized market demand (higher = more wanted). */
  demand: number
  /** 0..1 normalized competition (higher = more crowded). Inverted in the score. */
  competition: number
  /** 0..1 normalized startup cost (higher = more expensive). Inverted in the score. */
  startupCost: number
}

export const OPPORTUNITY_WEIGHTS = {
  demand: 0.5,
  competition: 0.3, // contributes (1 - competition)
  startupCost: 0.2, // contributes (1 - startupCost)
} as const

export type OpportunityBand = "Low" | "Medium" | "High"

export type OpportunityScore = {
  /** 0..10 composite, rounded to one decimal. */
  composite: number
  breakdown: {
    demand: number
    competitionInverse: number
    startupCostInverse: number
  }
  bands: {
    demand: OpportunityBand
    competition: OpportunityBand
    startupCost: OpportunityBand
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v) || v <= 0) {
    return 0
  }
  return v >= 1 ? 1 : v
}

/** Bucket a 0..1 value into Low/Medium/High for human-readable opportunity pages. */
export function band(v: number): OpportunityBand {
  const x = clamp01(v)
  if (x >= 0.66) {
    return "High"
  }
  if (x >= 0.33) {
    return "Medium"
  }
  return "Low"
}

/**
 * Compose the 0..10 opportunity score. High demand + low competition + low
 * startup cost ⇒ high score. Deterministic and bounded.
 */
export function computeOpportunityScore(s: OpportunitySignals): OpportunityScore {
  const demand = clamp01(s.demand)
  const competition = clamp01(s.competition)
  const startupCost = clamp01(s.startupCost)

  const competitionInverse = 1 - competition
  const startupCostInverse = 1 - startupCost

  const weighted =
    demand * OPPORTUNITY_WEIGHTS.demand +
    competitionInverse * OPPORTUNITY_WEIGHTS.competition +
    startupCostInverse * OPPORTUNITY_WEIGHTS.startupCost

  const composite = Math.round(weighted * 10 * 10) / 10

  return {
    composite,
    breakdown: {
      demand: Math.round(demand * 1000) / 1000,
      competitionInverse: Math.round(competitionInverse * 1000) / 1000,
      startupCostInverse: Math.round(startupCostInverse * 1000) / 1000,
    },
    bands: {
      demand: band(demand),
      // A crowded market is a "High" competition band even though it lowers
      // the score; the band describes the signal, not its contribution.
      competition: band(competition),
      startupCost: band(startupCost),
    },
  }
}

/** Saturating log normalizer mapping 0..10^scale onto 0..1. Shared shape with _ranking. */
export function logSaturate(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.min(1, Math.log10(1 + value) / scale)
}

export type DemandInputs = {
  /** Count of open demand posts in the category/subject. */
  openDemandPosts: number
  /** Sum of committed quantity across those posts. */
  committedQuantity: number
  /** Sum of target quantity across those posts. */
  targetQuantity: number
  /** Total bounty dollars attached (major units). */
  bountyDollars: number
  /** Wishlist references for the subject. */
  wishlistCount: number
  /** Coalition (cooperative) needs referencing the subject. */
  coalitionNeeds: number
}

/**
 * Normalize raw demand signals to 0..1. A blend of breadth (how many distinct
 * signals) and intensity (fill progress + money on the table).
 */
export function normalizeDemand(d: DemandInputs): number {
  const breadth = logSaturate(
    d.openDemandPosts + d.wishlistCount + d.coalitionNeeds,
    2 // ~100 distinct signals saturates breadth
  )
  const fill =
    d.targetQuantity > 0
      ? Math.min(1, d.committedQuantity / d.targetQuantity)
      : 0
  const money = logSaturate(d.bountyDollars, 4) // ~$10k bounty saturates
  // Weighted blend; breadth dominates, intensity refines.
  return clamp01(breadth * 0.5 + fill * 0.3 + money * 0.2)
}

export type CompetitionInputs = {
  /** Distinct active sellers offering in the subject. */
  activeSellers: number
  /** Distinct active products/listings in the subject. */
  activeListings: number
}

/** Normalize competition to 0..1 (higher = more crowded). */
export function normalizeCompetition(c: CompetitionInputs): number {
  const sellers = logSaturate(c.activeSellers, 2) // ~100 sellers saturates
  const listings = logSaturate(c.activeListings, 3) // ~1000 listings saturates
  return clamp01(sellers * 0.6 + listings * 0.4)
}

/**
 * Normalize startup cost to 0..1 (higher = more expensive) from a dollar
 * figure. $0 → 0, ~$50k → ~1 on a log curve so low-cost businesses stand out.
 */
export function normalizeStartupCost(startupCostDollars: number): number {
  return logSaturate(startupCostDollars, 4.7) // 10^4.7 ≈ $50k saturates
}

export type PriceObservation = {
  price_cents: number
  observed_at: Date | string | number
}

export type PriceTrend = {
  direction: "rising" | "falling" | "flat"
  /** Signed percentage change from earliest to latest, rounded to one decimal. */
  pctChange: number
  latestCents: number | null
  earliestCents: number | null
  samples: number
}

/**
 * Summarize a price-observation series into a trend. Sorts by time, compares
 * the mean of the oldest third against the mean of the newest third to damp
 * single-point noise. "flat" when |pctChange| < 1%.
 */
export function priceTrend(observations: PriceObservation[]): PriceTrend {
  const points = (observations || [])
    .filter((o) => o && Number.isFinite(Number(o.price_cents)))
    .map((o) => ({
      cents: Number(o.price_cents),
      t: new Date(o.observed_at).getTime(),
    }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)

  if (points.length === 0) {
    return {
      direction: "flat",
      pctChange: 0,
      latestCents: null,
      earliestCents: null,
      samples: 0,
    }
  }

  const third = Math.max(1, Math.floor(points.length / 3))
  const head = points.slice(0, third)
  const tail = points.slice(points.length - third)
  const mean = (arr: { cents: number }[]) =>
    arr.reduce((s, p) => s + p.cents, 0) / arr.length

  const earliest = mean(head)
  const latest = mean(tail)
  const pctChange =
    earliest > 0 ? Math.round(((latest - earliest) / earliest) * 1000) / 10 : 0

  let direction: PriceTrend["direction"] = "flat"
  if (pctChange >= 1) {
    direction = "rising"
  } else if (pctChange <= -1) {
    direction = "falling"
  }

  return {
    direction,
    pctChange,
    latestCents: Math.round(points[points.length - 1].cents),
    earliestCents: Math.round(points[0].cents),
    samples: points.length,
  }
}
