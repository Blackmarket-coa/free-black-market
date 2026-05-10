import { PLAYBOOK_RECIPES, PLAYBOOK_IDS, getRecipe } from "../recipes"
import { LISTING_TYPE_IDS } from "../../listing-type/catalog"
import type { ListingTypeId } from "../../listing-type/catalog"

describe("playbook recipe catalog", () => {
  it("exposes exactly ten playbooks", () => {
    expect(PLAYBOOK_IDS).toHaveLength(10)
  })

  it("every playbook id matches its recipe.id", () => {
    for (const id of PLAYBOOK_IDS) {
      expect(PLAYBOOK_RECIPES[id].id).toBe(id)
    }
  })

  it("every playbook has commission rate 0.03 (3 % under Posture A)", () => {
    for (const id of PLAYBOOK_IDS) {
      expect(PLAYBOOK_RECIPES[id].commission_rate).toBe(0.03)
    }
  })

  it("every allowed listing-type on a recipe is a valid catalog entry", () => {
    for (const id of PLAYBOOK_IDS) {
      const recipe = PLAYBOOK_RECIPES[id]
      for (const lt of recipe.allowed_listing_types) {
        expect(LISTING_TYPE_IDS).toContain(lt as ListingTypeId)
      }
    }
  })

  it("Stall does not allow sliding scale (zero-overhead invariant)", () => {
    expect(PLAYBOOK_RECIPES.stall.allow_sliding_scale).toBe(false)
  })

  it("Service defaults credits payout to opt-in (cash-flow predictability)", () => {
    expect(PLAYBOOK_RECIPES.service.allow_credits_payout).toBe("opt_in")
  })

  it("getRecipe throws on unknown id", () => {
    expect(() => getRecipe("nonexistent" as any)).toThrow()
  })

  it("Hub is the only recipe with hasAggregation default true", () => {
    for (const id of PLAYBOOK_IDS) {
      const recipe = PLAYBOOK_RECIPES[id]
      const aggregation = recipe.default_features.hasAggregation ?? false
      if (id === "hub") {
        expect(aggregation).toBe(true)
      } else {
        expect(aggregation).toBe(false)
      }
    }
  })

  it("every recipe has a non-empty storefront blurb", () => {
    for (const id of PLAYBOOK_IDS) {
      expect(PLAYBOOK_RECIPES[id].storefront_blurb_default.length).toBeGreaterThan(0)
    }
  })
})
