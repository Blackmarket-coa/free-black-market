/**
 * Deterministic producer <-> creator matching (v1, no ML).
 *
 * Pure functions so the ranking is unit-testable in isolation from the data
 * layer. The route assembles `ProducerSignal` / `CreatorSignal` from existing
 * modules (producer, creator-program, creator-attribution) and calls
 * `rankCreators` / `scoreCreator`.
 */

export type ProducerSignal = {
  /** Product categories + any explicit niche tags for the producer. */
  categories: string[]
  /** Region/geo the producer serves (free text or ISO-2). */
  region: string | null
}

export type CreatorSignal = {
  creator_seller_id: string
  /** Platforms/categories the creator covers. */
  niches: string[]
  /** Geos the creator serves (free text or ISO-2). */
  regions: string[]
  /** Total reach across platforms. */
  follower_total: number
  /** Lifetime attributed sales in cents (track record). */
  attributed_cents: number
  /** Lifetime affiliate clicks (track record). */
  clicks: number
}

export type RankedCreator = {
  creator_seller_id: string
  /** 0..1 composite score. */
  score: number
  reasons: string[]
}

export const MATCHING_WEIGHTS = {
  niche: 0.4,
  region: 0.2,
  engagement: 0.25,
  trackRecord: 0.15,
} as const

function norm(values: string[]): Set<string> {
  return new Set(
    values
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** Jaccard similarity of two string sets, 0..1. Empty-vs-empty is 0. */
export function jaccard(a: string[], b: string[]): number {
  const sa = norm(a)
  const sb = norm(b)
  if (sa.size === 0 || sb.size === 0) {
    return 0
  }
  let inter = 0
  for (const v of sa) {
    if (sb.has(v)) {
      inter++
    }
  }
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Saturating log normalizer mapping 0..10^scale onto 0..1. */
function logSaturate(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.min(1, Math.log10(1 + value) / scale)
}

export function scoreCreator(
  producer: ProducerSignal,
  creator: CreatorSignal
): { score: number; reasons: string[] } {
  const reasons: string[] = []

  const nicheScore = jaccard(producer.categories, creator.niches)
  if (nicheScore > 0) {
    reasons.push(`shares ${Math.round(nicheScore * 100)}% niche overlap`)
  }

  const regionScore =
    producer.region && norm(creator.regions).has(producer.region.trim().toLowerCase())
      ? 1
      : 0
  if (regionScore > 0) {
    reasons.push(`serves ${producer.region}`)
  }

  // 1M followers saturates engagement.
  const engagementScore = logSaturate(creator.follower_total, 6)
  if (creator.follower_total > 0) {
    reasons.push(`${creator.follower_total.toLocaleString()} total reach`)
  }

  // ~$1M attributed saturates track record; clicks give a small lift.
  const salesScore = logSaturate(creator.attributed_cents, 8)
  const clickScore = logSaturate(creator.clicks, 5)
  const trackScore = Math.min(1, salesScore * 0.8 + clickScore * 0.2)
  if (creator.attributed_cents > 0) {
    reasons.push(
      `$${Math.round(creator.attributed_cents / 100).toLocaleString()} attributed sales`
    )
  }

  const score =
    nicheScore * MATCHING_WEIGHTS.niche +
    regionScore * MATCHING_WEIGHTS.region +
    engagementScore * MATCHING_WEIGHTS.engagement +
    trackScore * MATCHING_WEIGHTS.trackRecord

  return { score: Math.round(score * 1000) / 1000, reasons }
}

export function rankCreators(
  producer: ProducerSignal,
  creators: CreatorSignal[],
  opts: { limit?: number } = {}
): RankedCreator[] {
  const ranked = creators.map((creator) => {
    const { score, reasons } = scoreCreator(producer, creator)
    return { creator_seller_id: creator.creator_seller_id, score, reasons }
  })

  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    // Stable, deterministic tiebreak.
    return a.creator_seller_id.localeCompare(b.creator_seller_id)
  })

  return typeof opts.limit === "number" ? ranked.slice(0, opts.limit) : ranked
}
