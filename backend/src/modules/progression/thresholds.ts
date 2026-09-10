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
  /**
   * Whether anything in the tree actually honours this key.
   *
   * A privilege is a *promise* to the member: the catalog's `label` and `blurb`
   * are member-facing copy. Until some route, service or screen reads the key
   * and changes behaviour, publishing it as unlocked tells someone they have a
   * benefit they do not have. So the character-sheet summary reports only the
   * keys marked here, and `__tests__/threshold-enforcement.unit.spec.ts` fails
   * the build if a key is marked without a consumer.
   *
   * Every privilege is currently unmarked: none of the four has a reader
   * anywhere outside this file. Mark one **in the same change** that wires its
   * consumer, never before. See docs/TRANSMUTATION_STRATEGY.md §1a.
   */
  enforced?: boolean
}

/**
 * Two privileges are deliberately absent, and should not be re-added.
 *
 * `producer.reduced-commission` (Producer L5, "a lower cooperative commission
 * rate") and `investor.priority-campaigns` (Investor L3, "early access to new
 * campaigns") together formed a closed loop with the XP awarded for backing a
 * campaign: deploy capital, gain XP, gain a lower fee and earlier access to the
 * next raise. Reputation and capital are required to stay structurally
 * separate, and preferential access to an offering conditioned on prior
 * investment is a distribution practice, not a loyalty perk.
 *
 * The commission ladder already lives in `vendor-plan`, where it is bought
 * rather than earned; a second, earned path to the same benefit also
 * contradicts the public "3% is the ceiling" claim. See
 * docs/TRANSMUTATION_STRATEGY.md §3.4, and the matching half of the fix in
 * `subscribers/progression-campaign-backed.ts`.
 */
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

/**
 * The featureKeys currently unlocked for a sheet.
 *
 * A privilege unlocks when it is *either* earned (its XP threshold met) *or*
 * bought (its `featureKey` present in `planGrantedKeys`) — the same
 * earned-vs-bought duality the grower tier ladder uses. Earned privileges still
 * auto-lapse when XP drops below the threshold; a plan-granted one holds for as
 * long as the plan grants it. `planGrantedKeys` defaults to empty, so existing
 * callers keep pure-XP behavior unchanged.
 */
export function unlockedFeatures(
  tracks: TrackSnapshot[],
  totalXp: number,
  planGrantedKeys: readonly string[] = []
): string[] {
  const granted = new Set(planGrantedKeys)
  return THRESHOLD_PRIVILEGES.filter(
    (t) => granted.has(t.featureKey) || isMet(t, tracks, totalXp)
  ).map((t) => t.featureKey)
}

/**
 * The featureKeys that something actually honours.
 *
 * Deliberately separate from `unlockedFeatures`, which answers a different and
 * still-useful question — "which thresholds has this member crossed?" — and is
 * what the engine's own tests exercise. This is the member-facing answer:
 * "which benefits does this member actually have?"
 */
export const ENFORCED_PRIVILEGE_KEYS: ReadonlySet<string> = new Set(
  THRESHOLD_PRIVILEGES.filter((t) => t.enforced === true).map((t) => t.featureKey)
)

/** Narrow a met-threshold list to the privileges that are actually honoured. */
export function enforcedOnly(featureKeys: readonly string[]): string[] {
  return featureKeys.filter((key) => ENFORCED_PRIVILEGE_KEYS.has(key))
}

/**
 * The closest not-yet-unlocked privilege, for "you're close" guidance.
 *
 * A privilege the plan already grants is not "next to earn" — the seller has it
 * — so plan-granted keys are excluded from the guidance the same way met ones
 * are.
 */
export function nextUnlock(
  tracks: TrackSnapshot[],
  totalXp: number,
  planGrantedKeys: readonly string[] = []
): (ThresholdPrivilege & { xpToGo: number }) | null {
  const granted = new Set(planGrantedKeys)
  const unmet = THRESHOLD_PRIVILEGES.filter(
    (t) => !granted.has(t.featureKey) && !isMet(t, tracks, totalXp)
  )
    .map((t) => ({ ...t, xpToGo: xpToGo(t, tracks, totalXp) }))
    .filter((t) => Number.isFinite(t.xpToGo))
    .sort((a, b) => a.xpToGo - b.xpToGo)
  return unmet[0] ?? null
}
