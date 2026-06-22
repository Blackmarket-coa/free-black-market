import { XpRewardKind } from "./models/xp-redemption"

/**
 * Catalog of rewards a customer can redeem with spendable XP.
 *
 * Kept as a static table (like `DEFAULT_TITLES`) so the economy is auditable at
 * a glance and easy to tune. Every reward grants an *entitlement*:
 *  - ENTITLEMENT rewards unlock a perk (theme, emoji pack, access pass, …).
 *  - DIGITAL_DOWNLOAD rewards unlock a digital-product download (the actual
 *    file delivery is handled by the digital-product module, gated on the
 *    entitlement granted here).
 *
 * `feature_key` is the entitlement key granted on redemption. `entitlementKind`
 * is the entitlement module's `EntitlementKind` value (kept as a string here to
 * avoid coupling the two modules).
 */
export type XpReward = {
  key: string
  name: string
  description: string
  /** XP price. Must be a positive integer. */
  xpCost: number
  kind: XpRewardKind
  /** Entitlement feature_key granted on redemption. */
  featureKey: string
  /** Entitlement module `EntitlementKind` string. */
  entitlementKind: string
  /** Optional access duration; omit for a permanent grant. */
  durationDays?: number
  icon?: string
  /**
   * Real-world mutual-aid impact this redemption funds, if any. Used to tally
   * community impact (e.g. trees planted) from the redemption ledger.
   */
  impact?: "tree"
  /** How many units of `impact` one redemption funds (e.g. trees planted). */
  impactUnits?: number
}

export const XP_REWARDS: XpReward[] = [
  {
    key: "theme-solarpunk-dusk",
    name: "Solarpunk Dusk Theme",
    description: "A warm dusk color theme for your storefront profile.",
    xpCost: 500,
    kind: XpRewardKind.ENTITLEMENT,
    featureKey: "theme.solarpunk-dusk",
    entitlementKind: "theme",
    icon: "palette",
  },
  {
    key: "emoji-pack-harvest",
    name: "Harvest Emoji Pack",
    description: "A set of seasonal harvest emojis for community chat.",
    xpCost: 750,
    kind: XpRewardKind.ENTITLEMENT,
    featureKey: "emoji_pack.harvest",
    entitlementKind: "emoji_pack",
    icon: "smile",
  },
  {
    key: "access-pass-market-day",
    name: "Market Day Access Pass",
    description: "30 days of early access to market-day drops and events.",
    xpCost: 1500,
    kind: XpRewardKind.ENTITLEMENT,
    featureKey: "access_pass.market-day",
    entitlementKind: "access_pass",
    durationDays: 30,
    icon: "ticket",
  },
  {
    key: "download-growers-handbook",
    name: "Grower's Handbook (PDF)",
    description: "A downloadable handbook on cooperative small-scale growing.",
    xpCost: 1000,
    kind: XpRewardKind.DIGITAL_DOWNLOAD,
    featureKey: "download.growers-handbook",
    entitlementKind: "digital",
    icon: "book",
  },
  {
    key: "download-seasonal-recipes",
    name: "Seasonal Recipes Pack (PDF)",
    description: "A downloadable pack of seasonal, local-first recipes.",
    xpCost: 600,
    kind: XpRewardKind.DIGITAL_DOWNLOAD,
    featureKey: "download.seasonal-recipes",
    entitlementKind: "digital",
    icon: "book",
  },
  // ── Mutual-aid impact: spend XP to plant trees ──────────────────────────
  {
    key: "plant-one-tree",
    name: "Plant a Tree 🌳",
    description:
      "Put your XP to work in the soil: fund the planting of one tree through the coalition's reforestation partners.",
    xpCost: 400,
    kind: XpRewardKind.ENTITLEMENT,
    featureKey: "mutual_aid.tree-planted",
    entitlementKind: "service",
    icon: "tree",
    impact: "tree",
    impactUnits: 1,
  },
  {
    key: "plant-grove",
    name: "Plant a Grove (5 trees) 🌲",
    description:
      "Fund a small grove — five trees planted — and earn a Grove Steward keepsake on your profile.",
    xpCost: 1800,
    kind: XpRewardKind.ENTITLEMENT,
    featureKey: "mutual_aid.grove-planted",
    entitlementKind: "service",
    icon: "tree",
    impact: "tree",
    impactUnits: 5,
  },
]

const REWARD_BY_KEY = new Map(XP_REWARDS.map((r) => [r.key, r]))

/** Look up a reward by catalog key. Returns undefined for unknown keys. */
export function getXpReward(key: string): XpReward | undefined {
  return REWARD_BY_KEY.get(key)
}

/**
 * How many trees a single redemption of `rewardKey` funds. Returns 0 for
 * rewards with no tree impact (or unknown keys), so it can be summed safely.
 */
export function treesForRewardKey(key: string): number {
  const reward = REWARD_BY_KEY.get(key)
  return reward?.impact === "tree" ? reward.impactUnits ?? 1 : 0
}
