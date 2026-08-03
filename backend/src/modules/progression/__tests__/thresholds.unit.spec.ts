/**
 * Threshold-privilege unit tests.
 *
 * Privileges are *derived* from the current sheet (auto-lapsing), so the pure
 * helpers must be coherent: catalog integrity, correct met/unmet detection,
 * xp-to-go math, and a sensible "closest next unlock".
 */
import {
  THRESHOLD_PRIVILEGES,
  unlockedFeatures,
  nextUnlock,
  xpToGo,
  type TrackSnapshot,
} from "../thresholds"
import { Stance } from "../stance"
import { xpForLevel } from "../leveling"

const tracks = (over: Partial<Record<Stance, { level: number; xp: number }>>): TrackSnapshot[] =>
  (Object.values(Stance) as Stance[]).map((role) => ({
    role,
    level: over[role]?.level ?? 0,
    xp: over[role]?.xp ?? 0,
  }))

describe("threshold privileges catalog", () => {
  it("has unique feature keys", () => {
    const keys = THRESHOLD_PRIVILEGES.map((t) => t.featureKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("gates each privilege on exactly one of role-level or total-xp", () => {
    for (const t of THRESHOLD_PRIVILEGES) {
      const roleGate = t.role !== undefined && t.minLevel !== undefined
      const xpGate = t.minTotalXp !== undefined
      expect(roleGate !== xpGate).toBe(true) // exactly one
    }
  })
})

describe("unlockedFeatures", () => {
  it("unlocks a role-level privilege once the track level is reached", () => {
    const unlocked = unlockedFeatures(tracks({ [Stance.PRODUCER]: { level: 3, xp: xpForLevel(3) } }), 0)
    expect(unlocked).toContain("producer.featured-listing")
    expect(unlocked).not.toContain("producer.reduced-commission") // needs level 5
  })

  it("lapses (excludes) a privilege when the level drops back below it", () => {
    const unlocked = unlockedFeatures(tracks({ [Stance.PRODUCER]: { level: 2, xp: xpForLevel(2) } }), 0)
    expect(unlocked).not.toContain("producer.featured-listing")
  })

  it("unlocks a lifetime-xp privilege at the total-xp threshold", () => {
    expect(unlockedFeatures(tracks({}), 2000)).toContain("member.market-day-queue")
    expect(unlockedFeatures(tracks({}), 1999)).not.toContain("member.market-day-queue")
  })

  it("unlocks a plan-granted privilege even with no XP earned toward it", () => {
    // Bought half of the duality: the plan grants the key outright.
    const unlocked = unlockedFeatures(tracks({}), 0, [
      "producer.reduced-commission",
    ])
    expect(unlocked).toContain("producer.reduced-commission")
  })

  it("keeps an earned privilege that the plan does not grant", () => {
    const unlocked = unlockedFeatures(
      tracks({ [Stance.PRODUCER]: { level: 3, xp: xpForLevel(3) } }),
      0,
      ["member.market-day-queue"]
    )
    // Earned one and bought a different one — both present.
    expect(unlocked).toContain("producer.featured-listing")
    expect(unlocked).toContain("member.market-day-queue")
  })
})

describe("nextUnlock", () => {
  it("returns the closest unmet privilege by xp-to-go", () => {
    // Close to the lifetime queue (needs 100 more) vs. all role gates from 0.
    const next = nextUnlock(tracks({}), 1900)
    expect(next?.featureKey).toBe("member.market-day-queue")
    expect(next?.xpToGo).toBe(100)
  })

  it("is null when everything is unlocked", () => {
    const everything = tracks({
      [Stance.PRODUCER]: { level: 5, xp: xpForLevel(5) },
      [Stance.INVESTOR]: { level: 3, xp: xpForLevel(3) },
      [Stance.COALITION]: { level: 5, xp: xpForLevel(5) },
    })
    expect(nextUnlock(everything, 5000)).toBeNull()
  })

  it("does not point at a privilege the plan already grants", () => {
    // From zero, the nearest earnable is the lifetime queue at 1900 XP; but if
    // the plan grants it, guidance skips to the next actually-unearned one.
    const withoutPlan = nextUnlock(tracks({}), 1900)
    expect(withoutPlan?.featureKey).toBe("member.market-day-queue")

    const withPlan = nextUnlock(tracks({}), 1900, ["member.market-day-queue"])
    expect(withPlan?.featureKey).not.toBe("member.market-day-queue")
  })
})

describe("xpToGo", () => {
  it("is 0 for an already-met threshold", () => {
    const t = THRESHOLD_PRIVILEGES.find((p) => p.featureKey === "member.market-day-queue")!
    expect(xpToGo(t, tracks({}), 3000)).toBe(0)
  })
})
