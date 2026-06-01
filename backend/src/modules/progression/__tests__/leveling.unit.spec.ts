/**
 * Leveling-curve unit tests.
 *
 * The curve is the gamification backbone, so it must be exact and reversible:
 *   - xpForLevel / levelForXp are inverses at level boundaries.
 *   - levelForXp is monotonic and never negative.
 *   - levelProgress reports sane in-level progress.
 */

import {
  xpForLevel,
  levelForXp,
  levelProgress,
  XP_PER_LEVEL,
} from "../leveling"

describe("progression leveling curve", () => {
  it("xpForLevel follows the quadratic curve", () => {
    expect(xpForLevel(0)).toBe(0)
    expect(xpForLevel(1)).toBe(XP_PER_LEVEL)
    expect(xpForLevel(2)).toBe(XP_PER_LEVEL * 4)
    expect(xpForLevel(3)).toBe(XP_PER_LEVEL * 9)
  })

  it("levelForXp is the inverse of xpForLevel at boundaries", () => {
    for (let n = 1; n <= 20; n++) {
      expect(levelForXp(xpForLevel(n))).toBe(n)
    }
  })

  it("levelForXp never goes negative and clamps at zero XP", () => {
    expect(levelForXp(0)).toBe(0)
    expect(levelForXp(-50)).toBe(0)
    expect(levelForXp(XP_PER_LEVEL - 1)).toBe(0)
  })

  it("levelForXp is monotonic non-decreasing", () => {
    let prev = 0
    for (let xp = 0; xp <= 10000; xp += 137) {
      const lvl = levelForXp(xp)
      expect(lvl).toBeGreaterThanOrEqual(prev)
      prev = lvl
    }
  })

  it("levelProgress reports in-level progress correctly", () => {
    // Exactly at level 2 boundary => 0% into level 2.
    const atBoundary = levelProgress(xpForLevel(2))
    expect(atBoundary.level).toBe(2)
    expect(atBoundary.xpIntoLevel).toBe(0)
    expect(atBoundary.pct).toBe(0)

    // Halfway between level 2 and 3.
    const span = xpForLevel(3) - xpForLevel(2)
    const half = levelProgress(xpForLevel(2) + Math.floor(span / 2))
    expect(half.level).toBe(2)
    expect(half.pct).toBeGreaterThanOrEqual(49)
    expect(half.pct).toBeLessThanOrEqual(51)
  })
})
