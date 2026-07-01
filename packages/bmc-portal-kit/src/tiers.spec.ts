import { describe, expect, it } from "vitest"

import {
  TIERS,
  buildTiers,
  canAccessGovernance,
  getNextTier,
  getTier,
  tierForKarma,
  type TierKey,
} from "./tiers"

describe("tier ladder", () => {
  it("is ordered by ascending karma threshold and split %", () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].karma_required).toBeGreaterThan(TIERS[i - 1].karma_required)
      expect(TIERS[i].split_pct).toBeGreaterThanOrEqual(TIERS[i - 1].split_pct)
    }
  })

  it("starts at seedling (0 karma) and ends at ancestor", () => {
    expect(TIERS[0].key).toBe("seedling")
    expect(TIERS[0].karma_required).toBe(0)
    expect(TIERS[TIERS.length - 1].key).toBe("ancestor")
  })
})

describe("getTier / getNextTier", () => {
  it("resolves a tier by key", () => {
    expect(getTier("root").name).toBe("Root")
  })

  it("falls back to the first tier for an unknown key", () => {
    expect(getTier("bogus" as TierKey)).toBe(TIERS[0])
  })

  it("returns the next tier, and null at the top", () => {
    expect(getNextTier("seedling")?.key).toBe("sprout")
    expect(getNextTier("ancestor")).toBeNull()
  })
})

describe("tierForKarma", () => {
  it("maps a karma total to the highest satisfied tier", () => {
    expect(tierForKarma(0).key).toBe("seedling")
    expect(tierForKarma(49).key).toBe("seedling")
    expect(tierForKarma(50).key).toBe("sprout")
    expect(tierForKarma(9999).key).toBe("ancestor")
  })
})

describe("canAccessGovernance", () => {
  it("is true only for root and above", () => {
    expect(canAccessGovernance("seedling")).toBe(false)
    expect(canAccessGovernance("sprout")).toBe(false)
    expect(canAccessGovernance("root")).toBe(true)
    expect(canAccessGovernance("ancestor")).toBe(true)
  })
})

describe("buildTiers", () => {
  it("substitutes per-portal unlocks copy without mutating the canonical ladder", () => {
    const custom = buildTiers({ seedling: "Custom copy" })
    expect(custom[0].unlocks).toBe("Custom copy")
    // other keys keep canonical copy
    expect(custom[1].unlocks).toBe(TIERS[1].unlocks)
    // canonical TIERS is untouched
    expect(TIERS[0].unlocks).not.toBe("Custom copy")
  })
})
