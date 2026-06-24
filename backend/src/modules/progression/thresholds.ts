import { Stance } from "./stance"
import { xpForLevel } from "./leveling"

/**
 * Threshold privileges (Stack Overflow model).
 *
 * Internal benefits unlock **instantly** when a customer crosses an XP
 * threshold, and **lapse** if XP later drops below it — so privileges are
 * *derived* from the current character sheet, never stored. A threshold gates on
 * either a per-role level (`role` + `minLevel`) or lifetime `minTotalXp`.
 *
 * Kept as a static, auditable table like `rewards.ts` / `DEFAULT_TITLES`. The
 * `featureKey` is what consuming surfaces check; `blurb` is the just-in-time
 * "you're close" guidance shown as the next unlock approaches.
 */
export type ThresholdPrivilege = {
  /** Stable key consuming surfaces gate on. */
  featureKey: string
  /** Human label for the privilege. */
  label: string
  /** Just-in-time guidance shown as the threshold approaches. */
  blurb: string
  /** Role track this gates on (with `minLevel`). Omit for a lifetime gate. */
  role?: Stance
  /** Level in `role` required to unlock. */
  minLevel?: number
  /** Lifetime total XP required to unlock (role-agnostic). */
  minTotalXp?: number
  icon?: string
}

export const THRESHOLD_PRIVILEGES: ThresholdPrivilege[] = [
  {
    featureKey: "producer.featured-listing",
    label: "Featured Listing Slot",
    blurb: "Reach Producer level 3 to feature a listing on the market home.",
    role: Stance.PRODUCER,
    minLevel: 3,
    icon: "star",
  },
  {
    featureKey: "producer.reduced-commission",
    label: "Reduced Commission",
    blurb: "Reach Producer level 5 for a lower cooperative commission rate.",
    role: Stance.PRODUCER,
    minLevel: 5,
    icon: "tag",
  },
  {
    featureKey: "investor.priority-campaigns",
    label: "Priority Campaign Access",
    blurb: "Reach Investor level 3 for early access to new campaigns.",
    role: Stance.INVESTOR,
    minLevel: 3,
    icon: "trending-up",
  },
  {
    featureKey: "coalition.proposal-authoring",
    label: "Proposal Authoring",
    blurb: "Reach Coalition level 3 to author governance proposals.",
    role: Stance.COALITION,
    minLevel: 3,
    icon: "edit",
  },
  {
    featureKey: "coalition.den-moderation",
    label: "Den Moderation",
    blurb: "Reach Coalition level 5 to help moderate community dens.",
    role: Stance.COALITION,
    minLevel: 5,
    icon: "shield",
  },
  {
    featureKey: "member.market-day-queue",
    label: "Market-Day Priority Queue",
    blurb: "Earn 2,000 lifetime XP for priority in market-day drops.",
    minTotalXp: 2000,
    icon: "ticket",
  },
]

export type TrackSnapshot = { role: Stance | string; level: number; xp: number }

const isMet = (
  t: ThresholdPrivilege,
  tracks: TrackSnapshot[],
  totalXp: number
): boolean => {
  if (t.minTotalXp !== undefined) return totalXp >= t.minTotalXp
  if (t.role !== undefined && t.minLevel !== undefined) {
    const track = tracks.find((tr) => tr.role === t.role)
    return !!track && track.level >= t.minLevel
  }
  return false
}

/** XP still needed to cross a threshold (0 if already met). */
export function xpToGo(
  t: ThresholdPrivilege,
  tracks: TrackSnapshot[],
  totalXp: number
): number {
  if (t.minTotalXp !== undefined) return Math.max(0, t.minTotalXp - totalXp)
  if (t.role !== undefined && t.minLevel !== undefined) {
    const track = tracks.find((tr) => tr.role === t.role)
    const have = track?.xp ?? 0
    return Math.max(0, xpForLevel(t.minLevel) - have)
  }
  return Infinity
}

/** The featureKeys currently unlocked for a sheet (auto-lapsing). */
export function unlockedFeatures(
  tracks: TrackSnapshot[],
  totalXp: number
): string[] {
  return THRESHOLD_PRIVILEGES.filter((t) => isMet(t, tracks, totalXp)).map(
    (t) => t.featureKey
  )
}

/** The closest not-yet-unlocked privilege, for "you're close" guidance. */
export function nextUnlock(
  tracks: TrackSnapshot[],
  totalXp: number
): (ThresholdPrivilege & { xpToGo: number }) | null {
  const unmet = THRESHOLD_PRIVILEGES.filter((t) => !isMet(t, tracks, totalXp))
    .map((t) => ({ ...t, xpToGo: xpToGo(t, tracks, totalXp) }))
    .filter((t) => Number.isFinite(t.xpToGo))
    .sort((a, b) => a.xpToGo - b.xpToGo)
  return unmet[0] ?? null
}
