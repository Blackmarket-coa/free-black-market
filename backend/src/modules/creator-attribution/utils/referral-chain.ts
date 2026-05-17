/**
 * Pure-function utilities for multi-level referral chain math. Kept free
 * of MedusaService imports so they can be unit-tested without the
 * container.
 */

export const ABSOLUTE_MAX_LEVELS = 3

export type LevelSplits = Record<string, number>

export const DEFAULT_LEVEL_SPLITS: LevelSplits = { L1: 80, L2: 15, L3: 5 }

/**
 * Parse the FBM_REFERRAL_DEFAULT_SPLITS env var, falling back to
 * DEFAULT_LEVEL_SPLITS on any parse error. Exported so the service and
 * its tests can share the same resolution logic.
 */
export function parseLevelSplitsEnv(raw: string | undefined): LevelSplits {
  if (!raw) return DEFAULT_LEVEL_SPLITS
  try {
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === "object" &&
      Object.values(parsed).every((v) => typeof v === "number" && v >= 0)
    ) {
      return parsed as LevelSplits
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_LEVEL_SPLITS
}

/**
 * Cap requested levels at ABSOLUTE_MAX_LEVELS. Programs that request more
 * than 3 are silently clamped — the cap exists so we never accidentally
 * ship a recursive payout chain too deep to reason about.
 */
export function capLevels(requested: number | null | undefined): number {
  const n = requested ?? 1
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(Math.floor(n), ABSOLUTE_MAX_LEVELS)
}

/**
 * Compute per-level commission cents from a total commission and the
 * configured splits. Returns an array indexed 0..levels-1; entry i
 * corresponds to level i+1 (L1 is the primary creator).
 *
 * Splits are normalized: missing levels default to 0, sums >100 are
 * clamped proportionally so the total of all level amounts never
 * exceeds totalCents. Any rounding remainder is added back to L1 so the
 * commission isn't silently lost.
 */
export function allocateCommission(args: {
  totalCents: number
  levels: number
  splits: LevelSplits
}): number[] {
  const levels = capLevels(args.levels)
  const out: number[] = new Array(levels).fill(0)

  const requested: number[] = []
  for (let i = 0; i < levels; i++) {
    const key = `L${i + 1}`
    const v = args.splits[key]
    requested.push(typeof v === "number" && v >= 0 ? v : 0)
  }

  const sum = requested.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    out[0] = args.totalCents
    return out
  }
  const scale = sum > 100 ? 100 / sum : 1

  let allocated = 0
  for (let i = 0; i < levels; i++) {
    const pct = requested[i] * scale
    const amount = Math.floor((args.totalCents * pct) / 100)
    out[i] = amount
    allocated += amount
  }
  // Push any rounding remainder back to L1 so the totals reconcile.
  const remainder = args.totalCents - allocated
  if (remainder > 0) {
    out[0] += remainder
  }
  return out
}

/**
 * Walk the referrer chain. `lookupReferrer(sellerId)` returns the parent
 * seller's id or null when no further parent exists. Returns the chain
 * starting with the primary seller at index 0.
 *
 * Stops at maxLevels (capped) or at a cycle (a seller appearing twice).
 */
export async function walkReferrerChain(args: {
  primarySellerId: string
  maxLevels: number
  lookupReferrer: (sellerId: string) => Promise<string | null>
}): Promise<string[]> {
  const cap = capLevels(args.maxLevels)
  const chain: string[] = [args.primarySellerId]
  const seen = new Set<string>([args.primarySellerId])

  let current: string | null = args.primarySellerId
  while (chain.length < cap) {
    const next = await args.lookupReferrer(current)
    if (!next) break
    if (seen.has(next)) break
    chain.push(next)
    seen.add(next)
    current = next
  }
  return chain
}
