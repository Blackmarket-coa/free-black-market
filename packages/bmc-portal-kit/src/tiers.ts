// KARMA tier ladder + TierKey, shared across the FBM portal family (nursery,
// wellness, botanical, creator). Split % rises with tier.
//
// THIS FILE FOLLOWS THE BACKEND. `GROWER_TIERS` in
// `backend/src/modules/progression/grower-karma.ts` is the source of truth:
// it feeds `effectiveGrowerTier`, which sets the split that
// `modules/payout-breakdown/grower-payout.ts` posts as a real COMMISSION
// transfer. Numbers here are display only, so when the two disagree it is this
// file that is wrong — and a grower is being shown a split nobody will pay.
//
// That is not hypothetical. Until this was corrected, the header of this file
// claimed the backend "seeds the same plant-themed ladder" while listing
// Ancestor at 1000 KARMA / 85%, against the backend's 1500 / 72%. `KarmaBar`
// renders `"{remaining} to {next.name} ({next.split_pct}% split)"`, so a
// Canopy grower on the nursery portal's Payouts page was told "500 to Ancestor
// (85% split)" — wrong threshold, wrong rate, on a page about their earnings.
//
// `tiers.parity.spec.ts` now reads the backend ladder and fails on divergence.
// Change the backend first, then mirror it here.
//
// The 60 → 72% ladder is confirmed, not provisional — these are the intended
// rates, and they match what is paid. Changing them is a revenue decision: make
// it in `grower-karma.ts` first, then mirror here.
//
// `unlocks` is display copy; the ladder fields (key/name/icon/karma_required/
// split_pct/color) are the contract. If a portal ever needs its own `unlocks`
// wording it can override per key — see `buildTiers`.

export type TierKey = "seedling" | "sprout" | "root" | "canopy" | "ancestor"

export interface Tier {
  key: TierKey
  name: string
  icon: string
  karma_required: number
  split_pct: number
  color: string // tailwind text/bg friendly hex
  unlocks: string
}

export const TIERS: Tier[] = [
  {
    key: "seedling",
    name: "Seedling",
    icon: "🌱",
    karma_required: 0,
    split_pct: 60,
    color: "#7EC850",
    unlocks: "Listing on FBM, node room access",
  },
  {
    key: "sprout",
    name: "Sprout",
    icon: "🌿",
    karma_required: 50,
    split_pct: 62,
    color: "#48bb78",
    unlocks: "Order Cycles, demand pool activation",
  },
  {
    key: "root",
    name: "Root",
    icon: "🪴",
    karma_required: 200,
    split_pct: 65,
    color: "#34a362",
    unlocks: "Governance voting, wholesale listings",
  },
  {
    key: "canopy",
    name: "Canopy",
    icon: "🌳",
    karma_required: 500,
    split_pct: 68,
    color: "#268751",
    unlocks: "Inter-node transfers, restoration contracts",
  },
  {
    key: "ancestor",
    name: "Ancestor",
    icon: "🌲",
    karma_required: 1500,
    split_pct: 72,
    color: "#164429",
    unlocks: "Hub co-governance, node mentorship",
  },
]

// Return the ladder with portal-specific `unlocks` copy substituted in.
export function buildTiers(
  unlocksByKey: Partial<Record<TierKey, string>>
): Tier[] {
  return TIERS.map((t) => ({ ...t, unlocks: unlocksByKey[t.key] ?? t.unlocks }))
}

export function getTier(key: TierKey): Tier {
  return TIERS.find((t) => t.key === key) ?? TIERS[0]
}

export function getNextTier(key: TierKey): Tier | null {
  const idx = TIERS.findIndex((t) => t.key === key)
  return idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : null
}

// Tier whose threshold the given karma total currently satisfies.
export function tierForKarma(karma: number): Tier {
  let current = TIERS[0]
  for (const t of TIERS) {
    if (karma >= t.karma_required) current = t
  }
  return current
}

// Root+ unlocks governance.
export function canAccessGovernance(key: TierKey): boolean {
  const order: TierKey[] = ["seedling", "sprout", "root", "canopy", "ancestor"]
  return order.indexOf(key) >= order.indexOf("root")
}
