import type { TierKey } from "@/types"

export interface Tier {
  key: TierKey
  name: string
  icon: string
  karma_required: number
  split_pct: number
  color: string // tailwind text/bg friendly hex
  unlocks: string
}

// The KARMA tier ladder shared across the FBM portal family (progression
// module). Split % rises with tier. Creators climb the same plant-themed ladder
// as nursery/wellness vendors.
export const TIERS: Tier[] = [
  {
    key: "seedling",
    name: "Seedling",
    icon: "🌱",
    karma_required: 0,
    split_pct: 70,
    color: "#7EC850",
    unlocks: "FBM listing, Space room access",
  },
  {
    key: "sprout",
    name: "Sprout",
    icon: "🌿",
    karma_required: 50,
    split_pct: 73,
    color: "#48bb78",
    unlocks: "Memberships, Governance Boosts",
  },
  {
    key: "root",
    name: "Root",
    icon: "🪴",
    karma_required: 200,
    split_pct: 76,
    color: "#34a362",
    unlocks: "Smart Splits, governance voting",
  },
  {
    key: "canopy",
    name: "Canopy",
    icon: "🌳",
    karma_required: 500,
    split_pct: 80,
    color: "#268751",
    unlocks: "Dead-drops, coalition co-launches",
  },
  {
    key: "ancestor",
    name: "Ancestor",
    icon: "🌲",
    karma_required: 1000,
    split_pct: 85,
    color: "#164429",
    unlocks: "Hub co-governance, creator mentorship",
  },
]

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
