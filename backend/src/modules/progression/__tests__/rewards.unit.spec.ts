/**
 * XP reward catalog unit tests.
 *
 * The catalog is the spendable-XP economy's price list, so it must be coherent:
 *   - keys are unique and resolvable
 *   - every reward has a positive integer cost and an entitlement to grant
 *   - both reward kinds (perk + download) are offered
 */

import { XP_REWARDS, getXpReward, treesForRewardKey } from "../rewards"
import { XpRewardKind } from "../models/xp-redemption"

describe("XP reward catalog", () => {
  it("has unique, resolvable keys", () => {
    const keys = XP_REWARDS.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(getXpReward(key)?.key).toBe(key)
    }
  })

  it("returns undefined for an unknown key", () => {
    expect(getXpReward("does-not-exist")).toBeUndefined()
  })

  it("prices every reward as a positive integer", () => {
    for (const r of XP_REWARDS) {
      expect(Number.isInteger(r.xpCost)).toBe(true)
      expect(r.xpCost).toBeGreaterThan(0)
    }
  })

  it("gives every reward an entitlement to grant", () => {
    for (const r of XP_REWARDS) {
      expect(r.featureKey).toBeTruthy()
      expect(r.entitlementKind).toBeTruthy()
    }
  })

  it("offers both perk and download reward kinds", () => {
    const kinds = new Set(XP_REWARDS.map((r) => r.kind))
    expect(kinds.has(XpRewardKind.ENTITLEMENT)).toBe(true)
    expect(kinds.has(XpRewardKind.DIGITAL_DOWNLOAD)).toBe(true)
  })

  it("maps digital downloads onto a digital entitlement kind", () => {
    for (const r of XP_REWARDS) {
      if (r.kind === XpRewardKind.DIGITAL_DOWNLOAD) {
        expect(r.entitlementKind).toBe("digital")
      }
    }
  })

  describe("tree-planting impact rewards", () => {
    it("offers at least one tree reward with positive impact units", () => {
      const trees = XP_REWARDS.filter((r) => r.impact === "tree")
      expect(trees.length).toBeGreaterThan(0)
      for (const r of trees) {
        expect(r.impactUnits).toBeGreaterThan(0)
      }
    })

    it("counts trees for tree rewards and zero for everything else", () => {
      for (const r of XP_REWARDS) {
        if (r.impact === "tree") {
          expect(treesForRewardKey(r.key)).toBe(r.impactUnits ?? 1)
        } else {
          expect(treesForRewardKey(r.key)).toBe(0)
        }
      }
    })

    it("returns 0 trees for an unknown reward key", () => {
      expect(treesForRewardKey("nope")).toBe(0)
    })
  })
})
