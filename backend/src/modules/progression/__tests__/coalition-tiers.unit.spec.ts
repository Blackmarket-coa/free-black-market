/**
 * The coalition KARMA ladder, and the read path Blackout's join gate uses.
 *
 * Two things are being pinned here. The ladder itself is pure arithmetic, but
 * it is the answer to "may this person join this coalition?", so the boundary
 * behaviour matters. And `getCoalitionKarmaTier` must read COALITION-stance XP
 * and nothing else: reading PRODUCER by mistake would gate coalition
 * membership on vendor sales, which is the bug this ladder exists to fix.
 */
import ProgressionModuleService from "../service"
import { Stance } from "../stance"
import {
  COALITION_TIERS,
  COALITION_TIER_ORDER,
  asCoalitionTierName,
  coalitionTierForXp,
  coalitionTierIndex,
} from "../coalition-tiers"
import { GROWER_TIERS } from "../grower-karma"

describe("coalitionTierForXp", () => {
  it("floors at seedling for zero and for negatives", () => {
    expect(coalitionTierForXp(0)).toBe("seedling")
    expect(coalitionTierForXp(-500)).toBe("seedling")
  })

  it("promotes exactly at each threshold, not one past it", () => {
    for (const name of COALITION_TIER_ORDER) {
      const min = COALITION_TIERS[name].min
      expect(coalitionTierForXp(min)).toBe(name)
      if (min > 0) {
        expect(coalitionTierForXp(min - 1)).not.toBe(name)
      }
    }
  })

  it("tops out at ancestor", () => {
    expect(coalitionTierForXp(1_000_000)).toBe("ancestor")
  })

  it("orders the rungs lowest to highest", () => {
    const mins = COALITION_TIER_ORDER.map((t) => COALITION_TIERS[t].min)
    expect([...mins].sort((a, b) => a - b)).toEqual(mins)
    expect(coalitionTierIndex("seedling")).toBe(0)
    expect(coalitionTierIndex("ancestor")).toBe(COALITION_TIER_ORDER.length - 1)
  })

  it("coerces only real rung names", () => {
    expect(asCoalitionTierName("root")).toBe("root")
    expect(asCoalitionTierName("Root")).toBeNull()
    expect(asCoalitionTierName("legend")).toBeNull()
    expect(asCoalitionTierName(null)).toBeNull()
  })

  it("is a distinct ladder from the grower one, not a copy of it", () => {
    // Same vocabulary, different measurement. If these ever converge by
    // accident, coalition membership starts tracking vendor sales volume.
    const coalitionMins = COALITION_TIER_ORDER.map((t) => COALITION_TIERS[t].min)
    const growerMins = COALITION_TIER_ORDER.map(
      (t) => GROWER_TIERS[(t[0].toUpperCase() + t.slice(1)) as keyof typeof GROWER_TIERS].min
    )
    expect(coalitionMins).not.toEqual(growerMins)
  })
})

describe("getCoalitionKarmaTier", () => {
  const makeService = (sheets: Array<Record<string, unknown>>) => {
    // Prototype instance so the real method runs against stubbed persistence,
    // the same shape attestation.unit.spec.ts uses. Typed `any` while the
    // stubs are assigned: the repo-wide `tsc --noEmit` type-checks test files
    // too, and a jest.fn returning partial sheet rows is not assignable to the
    // generated `listCharacterSheets` signature.
    const svc: any = Object.create(ProgressionModuleService.prototype)
    svc.listCharacterSheets = jest.fn(async () => sheets)
    svc.createCharacterSheets = jest.fn(async () => {
      throw new Error("a read must not create a character sheet")
    })
    return svc as ProgressionModuleService & Record<string, jest.Mock>
  }

  it("reads coalition_xp, not producer_xp", async () => {
    const svc = makeService([{ coalition_xp: 120, producer_xp: 5000 }])
    await expect(svc.getCoalitionKarmaTier("cus_1")).resolves.toEqual({
      tier: "root",
      xp: 120,
    })
  })

  it("answers seedling without creating a sheet for a customer who has none", async () => {
    const svc = makeService([])
    await expect(svc.getCoalitionKarmaTier("cus_none")).resolves.toEqual({
      tier: "seedling",
      xp: 0,
    })
    expect(svc.createCharacterSheets).not.toHaveBeenCalled()
  })

  it("clamps a negative or non-numeric balance rather than throwing", async () => {
    await expect(
      makeService([{ coalition_xp: -40 }]).getCoalitionKarmaTier("cus_2")
    ).resolves.toEqual({ tier: "seedling", xp: 0 })
    await expect(
      makeService([{ coalition_xp: "nonsense" }]).getCoalitionKarmaTier("cus_3")
    ).resolves.toEqual({ tier: "seedling", xp: 0 })
  })

  it("scopes the read to the customer asked about", async () => {
    const svc = makeService([{ coalition_xp: 800 }])
    await svc.getCoalitionKarmaTier("cus_9")
    expect(svc.listCharacterSheets).toHaveBeenCalledWith({ customer_id: "cus_9" })
  })

  it("uses the stance the coalition writer writes to", async () => {
    // Guards against the column map drifting: coalition-karma.ts records on
    // Stance.COALITION, so this read has to follow that key.
    expect(Stance.COALITION).toBe("coalition")
  })
})
