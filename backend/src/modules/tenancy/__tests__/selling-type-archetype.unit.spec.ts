/**
 * The selling-type → archetype mapping.
 *
 * This mapping used to live in the vendor panel as a field nothing read. The
 * tests here are the reason it is worth moving: they can only be written
 * against a backend map, and they are what makes the map's targets real
 * rather than plausible. docs/TRANSMUTATION_STRATEGY.md §4.1.
 */
import {
  SELLING_TYPE_ARCHETYPE,
  archetypeForSellingType,
} from "../selling-type-archetype"
import { OnboardingSellingType } from "../models/onboarding-state"
import { ProductArchetypeCode } from "../../product-archetype/models/product-archetype"

describe("SELLING_TYPE_ARCHETYPE", () => {
  it("covers every selling type", () => {
    // The Record type enforces this at compile time; this asserts it at run
    // time too, so a cast or a widened type cannot quietly open a hole.
    for (const sellingType of Object.values(OnboardingSellingType)) {
      expect(SELLING_TYPE_ARCHETYPE[sellingType]).toBeDefined()
    }
    expect(Object.keys(SELLING_TYPE_ARCHETYPE)).toHaveLength(
      Object.values(OnboardingSellingType).length
    )
  })

  it("maps only to archetype codes that actually exist", () => {
    const real = new Set<string>(Object.values(ProductArchetypeCode))
    for (const code of Object.values(SELLING_TYPE_ARCHETYPE)) {
      expect(real.has(code)).toBe(true)
    }
  })

  it("routes reclaimed goods to CIRCULAR_ECONOMY, not general goods", () => {
    // The whole point of the fifth selling type. CIRCULAR_ECONOMY carries
    // `requires_condition_grade`; NON_PERISHABLE does not, so routing salvage
    // there is what loses the condition grade.
    expect(SELLING_TYPE_ARCHETYPE[OnboardingSellingType.RECLAIMED]).toBe(
      ProductArchetypeCode.CIRCULAR_ECONOMY
    )
    expect(SELLING_TYPE_ARCHETYPE[OnboardingSellingType.PHYSICAL]).toBe(
      ProductArchetypeCode.NON_PERISHABLE
    )
  })

  it("gives each selling type a distinct archetype", () => {
    const codes = Object.values(SELLING_TYPE_ARCHETYPE)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe("archetypeForSellingType", () => {
  it("resolves a known selling type", () => {
    expect(archetypeForSellingType("reclaimed")).toBe(
      ProductArchetypeCode.CIRCULAR_ECONOMY
    )
  })

  it.each([null, undefined, "", "not_a_selling_type"])(
    "returns null for %p rather than guessing an archetype",
    (input) => {
      expect(archetypeForSellingType(input as string | null)).toBeNull()
    }
  )
})
