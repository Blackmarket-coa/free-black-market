/**
 * Progression leveling curve.
 *
 * Pure, I/O-free functions so they can be unit-tested in isolation and reused
 * by the service, subscribers, and any future workflow steps. The curve is a
 * standard quadratic RPG curve:
 *
 *   xpForLevel(n) = XP_PER_LEVEL * n^2   (cumulative XP required to *reach* level n)
 *   levelForXp(xp) = floor(sqrt(xp / XP_PER_LEVEL))
 *
 * So with XP_PER_LEVEL = 100: level 1 = 100 XP, level 2 = 400, level 3 = 900…
 * Each successive level costs more, which keeps high levels meaningful without
 * ever capping progression.
 */

import { Stance } from "./stance"

/** Base XP scalar. Level n requires XP_PER_LEVEL * n^2 cumulative XP. */
export const XP_PER_LEVEL = 100

/**
 * Per-role XP multipliers. A unit of "effort" in each track is weighted so the
 * tracks level at comparable rates despite very different underlying events
 * (a single investment deploys far more capital than a single order is worth).
 * Multipliers are applied at *ingestion* time in the service, not here, so this
 * map is the single source of truth for tuning.
 */
export const ROLE_XP_WEIGHTS: Record<Stance, number> = {
  [Stance.CONSUMER]: 1,
  [Stance.PRODUCER]: 1,
  [Stance.INVESTOR]: 1,
  [Stance.COALITION]: 1,
  [Stance.CREATOR]: 1,
}

/** Cumulative XP required to reach a given level (level >= 0). */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0
  return XP_PER_LEVEL * level * level
}

/** Level for a given cumulative XP total. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 0
  return Math.floor(Math.sqrt(xp / XP_PER_LEVEL))
}

/**
 * Progress within the current level, as XP-into-level and XP-needed-for-next.
 * Useful for rendering a progress bar without re-deriving the math client-side.
 */
export function levelProgress(xp: number): {
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
  pct: number
} {
  const level = levelForXp(xp)
  const floor = xpForLevel(level)
  const ceiling = xpForLevel(level + 1)
  const span = ceiling - floor
  const into = Math.max(0, xp - floor)
  return {
    level,
    xpIntoLevel: into,
    xpForNextLevel: span,
    pct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0,
  }
}
