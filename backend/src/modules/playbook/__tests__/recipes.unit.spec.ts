import { PLAYBOOK_RECIPES, PLAYBOOK_IDS, getRecipe } from "../recipes"
import { LISTING_TYPE_IDS } from "../../listing-type/catalog"
import type { ListingTypeId } from "../../listing-type/catalog"

describe("playbook recipe catalog", () => {
  it("exposes exactly eleven playbooks", () => {
    expect(PLAYBOOK_IDS).toHaveLength(11)
  })

  it("includes the creator playbook with audience-monetization features", () => {
    expect(PLAYBOOK_IDS).toContain("creator")
    expect(PLAYBOOK_RECIPES.creator.default_features.hasSubscriptions).toBe(true)
    expect(PLAYBOOK_RECIPES.creator.default_features.hasShows).toBe(true)
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

  it("Hub recipe enables hasDeliveryZones (aggregation defaults vary while playbook features stabilize)", () => {
    expect(PLAYBOOK_RECIPES.hub.default_features.hasDeliveryZones).toBe(true)
  })

  it("Kitchen recipe enables hasMenu and hasDeliveryZones", () => {
    expect(PLAYBOOK_RECIPES.kitchen.default_features.hasMenu).toBe(true)
    expect(PLAYBOOK_RECIPES.kitchen.default_features.hasDeliveryZones).toBe(true)
  })

  it("Cycle recipe enables hasSeasons, hasHarvests, hasSubscriptions (CSA core)", () => {
    expect(PLAYBOOK_RECIPES.cycle.default_features.hasSeasons).toBe(true)
    expect(PLAYBOOK_RECIPES.cycle.default_features.hasHarvests).toBe(true)
    expect(PLAYBOOK_RECIPES.cycle.default_features.hasSubscriptions).toBe(true)
  })

  it("every recipe has a non-empty storefront blurb", () => {
    for (const id of PLAYBOOK_IDS) {
      expect(PLAYBOOK_RECIPES[id].storefront_blurb_default.length).toBeGreaterThan(0)
    }
  })
})
