import { EARNING_DESCRIPTIONS, GET, TIER_UNLOCKS } from "../route"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import {
  GROWER_KARMA_DELTAS,
  GROWER_TIERS,
  TIER_ORDER,
} from "../../../../modules/progression/grower-karma"
import { VENDOR_PLAN_CATALOG } from "../../../../modules/vendor-plan/catalog"
import { limitsForPlan } from "../../../../modules/vendor-plan/limits"

/**
 * `/store/karma-ladder` publishes the tier system to people who have not signed
 * up yet, which is the only place a progression ladder does any persuading.
 * The numbers come from `GROWER_TIERS` directly, so what needs pinning is the
 * prose that wraps them: a tier or an earning rule with no description renders
 * as a blank cell on a page whose whole job is to be legible.
 */
describe("published KARMA ladder", () => {
  it("describes what every tier unlocks", () => {
    const undescribed = TIER_ORDER.filter(
      (tier) => !TIER_UNLOCKS[tier]?.trim()
    )
    expect(undescribed).toEqual([])
  })

  it("describes every way KARMA can be earned", () => {
    // GROWER_KARMA_DELTAS is what the subscriber actually awards against, so an
    // event missing here is a way to earn KARMA that the page never mentions.
    const undescribed = Object.keys(GROWER_KARMA_DELTAS).filter(
      (event) =>
        !EARNING_DESCRIPTIONS[event as keyof typeof GROWER_KARMA_DELTAS]?.trim()
    )
    expect(undescribed).toEqual([])
  })

  it("does not describe events that cannot be earned", () => {
    const phantom = Object.keys(EARNING_DESCRIPTIONS).filter(
      (event) => !(event in GROWER_KARMA_DELTAS)
    )
    expect(phantom).toEqual([])
  })

  it("converts stored fractions to whole-ish percentages", () => {
    // GROWER_TIERS stores 0.62; the page must publish 62, not 0.62 or
    // 62.000000000000004.
    const published = TIER_ORDER.map(
      (tier) => Math.round(GROWER_TIERS[tier].split_pct * 10000) / 100
    )

    expect(published[0]).toBe(60)
    expect(published[published.length - 1]).toBe(72)
    for (const pct of published) {
      expect(pct).toBeGreaterThan(1)
      expect(pct).toBeLessThanOrEqual(100)
    }
  })

  it("rises monotonically in both threshold and split", () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const prev = GROWER_TIERS[TIER_ORDER[i - 1]]
      const curr = GROWER_TIERS[TIER_ORDER[i]]
      expect(curr.min).toBeGreaterThan(prev.min)
      expect(curr.split_pct).toBeGreaterThan(prev.split_pct)
    }
  })

  it("finds the plan floors the page is supposed to disclose", () => {
    // If plans stop flooring tiers this test should be deleted along with the
    // disclosure — but silently publishing an empty list while plans still
    // grant tiers would turn the honest section into a misleading one.
    const floors = VENDOR_PLAN_CATALOG.map(
      (plan) => limitsForPlan(plan.code).grower_tier_floor
    ).filter(Boolean)

    expect(floors.length).toBeGreaterThan(0)
    for (const floor of floors) {
      expect(TIER_ORDER).toContain(floor)
    }
  })
})

describe("published plan floors (FF_ALL_ACCESS_PLAN_V1)", () => {
  const ENV = PHASE0_FEATURE_FLAGS.ALL_ACCESS_PLAN_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  const floors = async () => {
    const res = {
      body: undefined as unknown as { plan_floors: Array<{ code: string; grower_tier_floor: string }> },
      set() {
        return res
      },
      json(payload: unknown) {
        res.body = payload as typeof res.body
        return res
      },
    }
    await GET({} as never, res as never)
    return res.body.plan_floors
  }

  it("publishes the pre-F8 floors with the flag off", async () => {
    expect(await floors()).toEqual([
      { code: "pro", display_name: "Pro", grower_tier_floor: "Root" },
      { code: "scale", display_name: "Scale", grower_tier_floor: "Canopy" },
    ])
  })

  it("publishes no floor once the flooring tiers are no longer sold", async () => {
    // all_access makes no tier claim (F7; L27), and a floor on a plan nobody
    // can buy is not something to advertise. The storefront hides the section
    // when the list is empty.
    process.env[ENV] = "true"
    expect(await floors()).toEqual([])
  })
})
