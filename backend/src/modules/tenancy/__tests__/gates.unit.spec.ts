import {
  TENANCY_GATES,
  TENANCY_GATE_KEYS,
  TIER_ORDER,
  featureGatesForTier,
  gatesGrantedByTier,
  hasMinimumTier,
  highestTier,
  isTenancyGate,
  isTierFlag,
  vendorFeatureKeysForTier,
  type TierFlag,
} from "../gates"
import { VENDOR_FEATURE_KEYS } from "../../vendor-plan/catalog"

describe("tier ordering", () => {
  it("ranks the ladder in the declared order", () => {
    expect(hasMinimumTier("tier2_aligned_org", "tier0_public")).toBe(true)
    expect(hasMinimumTier("tier1_verified", "tier1_verified")).toBe(true)
    expect(hasMinimumTier("tier0_public", "tier1_verified")).toBe(false)
  })

  it("fails closed on a tier this build does not know", () => {
    // A rolled-back deploy or a hand-edited row must not 500 every request
    // that touches the storefront — it must read as the lowest tier.
    expect(hasMinimumTier("tier_from_the_future" as TierFlag, "tier1_verified")).toBe(
      false
    )
    expect(isTierFlag("tier_from_the_future")).toBe(false)
    expect(isTierFlag("tier2_aligned_org")).toBe(true)
  })
})

describe("the gate table", () => {
  it("declares every gate against a real tier", () => {
    for (const gate of TENANCY_GATE_KEYS) {
      expect(isTierFlag(TENANCY_GATES[gate])).toBe(true)
      expect(isTenancyGate(gate)).toBe(true)
    }
    expect(TENANCY_GATE_KEYS.length).toBeGreaterThan(0)
  })

  it("preserves the two gates the admin donation routes already depend on", () => {
    // Non-regression: four live admin routes gate on these, and extracting the
    // table must not have moved either of them.
    expect(TENANCY_GATES.donation_routing).toBe("tier1_verified")
    expect(TENANCY_GATES.advanced_automation).toBe("tier2_aligned_org")

    const tier1 = featureGatesForTier("tier1_verified")
    expect(tier1.donation_routing).toBe(true)
    expect(tier1.advanced_automation).toBe(false)
    expect(featureGatesForTier("tier0_public").donation_routing).toBe(false)
    expect(featureGatesForTier("tier2_aligned_org").advanced_automation).toBe(true)
  })

  it("reports every gate, held or not, so the payload shape is stable", () => {
    for (const tier of TIER_ORDER) {
      const gates = featureGatesForTier(tier)
      expect(Object.keys(gates).sort()).toEqual([...TENANCY_GATE_KEYS].sort())
    }
  })

  it("grants monotonically up the ladder", () => {
    // A higher tier must never lose a gate a lower one holds — the property
    // that makes "minimum tier" a meaningful thing to ask for at all.
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lower = new Set(gatesGrantedByTier(TIER_ORDER[i - 1]))
      const higher = new Set(gatesGrantedByTier(TIER_ORDER[i]))
      for (const gate of lower) {
        expect(higher.has(gate)).toBe(true)
      }
    }
  })
})

describe("the vendor feature floor", () => {
  it("grants nothing on the public tier", () => {
    // Creating an organization must not hand out the paid catalog.
    expect(vendorFeatureKeysForTier("tier0_public")).toEqual([])
  })

  it("only ever raises up the ladder", () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lower = vendorFeatureKeysForTier(TIER_ORDER[i - 1])
      const higher = new Set(vendorFeatureKeysForTier(TIER_ORDER[i]))
      for (const key of lower) {
        expect(higher.has(key)).toBe(true)
      }
    }
  })

  it("only floors keys the plan catalog actually defines", () => {
    // Drift guard: a floor naming a key no gate registration uses would be a
    // grant of nothing, and would read to an operator as a delivered feature.
    const known = new Set<string>(VENDOR_FEATURE_KEYS)
    for (const tier of TIER_ORDER) {
      for (const key of vendorFeatureKeysForTier(tier)) {
        expect(known.has(key)).toBe(true)
      }
    }
  })

  it("falls back to granting nothing for an unknown tier", () => {
    expect(vendorFeatureKeysForTier("tier_from_the_future" as TierFlag)).toEqual([])
  })
})

describe("highestTier", () => {
  it("takes the maximum across a seller's memberships", () => {
    // The only choice consistent with a floor: one organization deliberately
    // granted the higher tier, and taking the minimum would revoke it.
    expect(highestTier(["tier0_public", "tier2_aligned_org", "tier1_verified"])).toBe(
      "tier2_aligned_org"
    )
  })

  it("is the public tier for a seller with no memberships", () => {
    expect(highestTier([])).toBe("tier0_public")
  })

  it("ignores values that are not tiers rather than throwing", () => {
    expect(highestTier([null, undefined, "", "nonsense"])).toBe("tier0_public")
    expect(highestTier([null, "tier1_verified", "nonsense"])).toBe("tier1_verified")
  })
})
