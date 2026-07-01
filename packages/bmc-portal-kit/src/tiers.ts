// Canonical KARMA tier ladder + TierKey, shared across the FBM portal family
// (nursery, wellness, botanical, creator). The backend `progression` module
// seeds the same plant-themed ladder. Split % rises with tier.
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
    split_pct: 70,
    color: "#7EC850",
    unlocks: "Listing on FBM, node room access",
  },
  {
    key: "sprout",
    name: "Sprout",
    icon: "🌿",
    karma_required: 50,
    split_pct: 73,
    color: "#48bb78",
    unlocks: "Order Cycles, demand pool activation",
  },
  {
    key: "root",
    name: "Root",
    icon: "🪴",
    karma_required: 200,
    split_pct: 76,
    color: "#34a362",
    unlocks: "Governance voting, wholesale listings",
  },
  {
    key: "canopy",
    name: "Canopy",
    icon: "🌳",
    karma_required: 500,
    split_pct: 80,
    color: "#268751",
    unlocks: "Inter-node transfers, restoration contracts",
  },
  {
    key: "ancestor",
    name: "Ancestor",
    icon: "🌲",
    karma_required: 1000,
    split_pct: 85,
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
