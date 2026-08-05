import {
  BUYER_ARCHETYPES,
  BUYER_ARCHETYPE_CODES,
  applyBuyerArchetypeDefaults,
  isBuyerArchetypeCode,
  resolveBuyerArchetype,
} from "../buyer-archetype"

const NOW = new Date("2026-08-05T00:00:00.000Z")
const daysFrom = (n: number) =>
  new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

describe("buyer archetypes", () => {
  it("falls back to GENERAL for unknown, missing or null codes", () => {
    // GENERAL is the point of the set: posting a want must work with no
    // archetype, no cooperative, and no FBM-specific concept at all.
    expect(resolveBuyerArchetype(undefined)).toBe(BUYER_ARCHETYPES.GENERAL)
    expect(resolveBuyerArchetype(null)).toBe(BUYER_ARCHETYPES.GENERAL)
    expect(resolveBuyerArchetype("NOT_A_CODE")).toBe(BUYER_ARCHETYPES.GENERAL)
    expect(resolveBuyerArchetype("")).toBe(BUYER_ARCHETYPES.GENERAL)
  })

  it("recognises exactly the declared codes", () => {
    for (const code of BUYER_ARCHETYPE_CODES) {
      expect(isBuyerArchetypeCode(code)).toBe(true)
    }
    expect(isBuyerArchetypeCode("household")).toBe(false) // case-sensitive
    expect(isBuyerArchetypeCode(42)).toBe(false)
  })

  it("defines every declared code, with sane ratios", () => {
    for (const code of BUYER_ARCHETYPE_CODES) {
      const d = BUYER_ARCHETYPES[code]
      expect(d).toBeDefined()
      // A ratio above 1 would demand more commitment than the pool targets;
      // at or below 0 would unlock before anyone committed.
      expect(d.min_quantity_ratio).toBeGreaterThan(0)
      expect(d.min_quantity_ratio).toBeLessThanOrEqual(1)
      expect(d.deadline_days).toBeGreaterThan(0)
    }
  })

  describe("applyBuyerArchetypeDefaults", () => {
    const base = { target_quantity: 100 }

    it("derives min_quantity from the archetype ratio", () => {
      const general = applyBuyerArchetypeDefaults({ ...base }, NOW)
      expect(general.min_quantity).toBe(50) // GENERAL = 0.5

      const club = applyBuyerArchetypeDefaults(
        { ...base, buyer_archetype: "BUYING_CLUB" },
        NOW
      )
      expect(club.min_quantity).toBe(75)

      const aid = applyBuyerArchetypeDefaults(
        { ...base, buyer_archetype: "MUTUAL_AID" },
        NOW
      )
      // Lowest threshold in the set: partial fulfilment still helps someone.
      expect(aid.min_quantity).toBe(25)
    })

    it("never derives a min_quantity of zero", () => {
      // 1 unit at a 0.25 ratio rounds to 0, which would unlock the pool before
      // a single commitment.
      const tiny = applyBuyerArchetypeDefaults(
        { target_quantity: 1, buyer_archetype: "MUTUAL_AID" },
        NOW
      )
      expect(tiny.min_quantity).toBe(1)
    })

    it("leaves an explicit min_quantity alone", () => {
      const out = applyBuyerArchetypeDefaults(
        { ...base, min_quantity: 7, buyer_archetype: "ORGANIZATION" },
        NOW
      )
      // An archetype that overwrote what someone actually typed would be a
      // trap, not a convenience.
      expect(out.min_quantity).toBe(7)
    })

    it("derives a deadline from the archetype window", () => {
      const out = applyBuyerArchetypeDefaults({ ...base }, NOW)
      expect(out.deadline).toEqual(daysFrom(30))

      const household = applyBuyerArchetypeDefaults(
        { ...base, buyer_archetype: "HOUSEHOLD" },
        NOW
      )
      expect(household.deadline).toEqual(daysFrom(14))
    })

    it("leaves an explicit deadline alone", () => {
      const explicit = new Date("2027-01-01T00:00:00.000Z")
      const out = applyBuyerArchetypeDefaults(
        { ...base, deadline: explicit },
        NOW
      )
      expect(out.deadline).toBe(explicit)
    })

    it("supplies deadline_type, visibility and unit_of_measure", () => {
      const org = applyBuyerArchetypeDefaults(
        { ...base, buyer_archetype: "ORGANIZATION" },
        NOW
      )
      // Procurement windows are real dates, not aspirations.
      expect(org.deadline_type).toBe("HARD")

      const club = applyBuyerArchetypeDefaults(
        { ...base, buyer_archetype: "BUYING_CLUB" },
        NOW
      )
      expect(club.visibility).toBe("NETWORK_ONLY")

      const general = applyBuyerArchetypeDefaults({ ...base }, NOW)
      expect(general.deadline_type).toBe("SOFT")
      expect(general.visibility).toBe("PUBLIC")
      expect(general.unit_of_measure).toBe("units")
    })

    it("lets every explicit field win over the archetype", () => {
      const out = applyBuyerArchetypeDefaults(
        {
          ...base,
          buyer_archetype: "ORGANIZATION",
          deadline_type: "SOFT",
          visibility: "INVITE_ONLY",
          unit_of_measure: "kg",
        },
        NOW
      )

      expect(out.deadline_type).toBe("SOFT")
      expect(out.visibility).toBe("INVITE_ONLY")
      expect(out.unit_of_measure).toBe("kg")
    })

    it("passes unrelated fields through untouched", () => {
      const out = applyBuyerArchetypeDefaults(
        { ...base, buyer_archetype: "GENERAL", title: "Oats" } as any,
        NOW
      )
      expect((out as any).title).toBe("Oats")
    })
  })
})
