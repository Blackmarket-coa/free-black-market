import { describe, expect, it } from "vitest"

import {
  ALL_EXTENSION_OPTIONS,
  ALL_FEATURE_KEYS,
  getFeaturesByType,
  type VendorFeatures,
  type VendorType,
} from "./vendor-type-context"

const ALL_TYPES: VendorType[] = [
  "producer",
  "garden",
  "kitchen",
  "maker",
  "restaurant",
  "mutual_aid",
  "default",
]

describe("getFeaturesByType", () => {
  it("returns a fully-populated feature map for every vendor type", () => {
    // Guards against a new feature key being added to the interface but
    // forgotten in one of the per-type maps (which would surface as
    // `undefined` and silently disable/enable a surface).
    for (const type of ALL_TYPES) {
      const features = getFeaturesByType(type)
      for (const key of ALL_FEATURE_KEYS) {
        expect(
          typeof features[key],
          `${type}.${key} should be a boolean`
        ).toBe("boolean")
      }
    }
  })

  it("keeps `default` as the safe minimal set (products + inventory only)", () => {
    const features = getFeaturesByType("default")
    const enabled = ALL_FEATURE_KEYS.filter((key) => features[key])
    expect(enabled.sort()).toEqual(["hasInventory", "hasProducts"].sort())
  })

  it("disables products for restaurants (menu-driven, not catalog-driven)", () => {
    const features = getFeaturesByType("restaurant")
    expect(features.hasProducts).toBe(false)
    expect(features.hasMenu).toBe(true)
    expect(features.hasShows).toBe(true)
  })

  it("enables grower surfaces for producers", () => {
    const features = getFeaturesByType("producer")
    expect(features.hasFarm).toBe(true)
    expect(features.hasHarvests).toBe(true)
    expect(features.hasSeasons).toBe(true)
  })

  it("enables community-garden surfaces (plots + volunteers) for gardens", () => {
    const features = getFeaturesByType("garden")
    expect(features.hasPlots).toBe(true)
    expect(features.hasVolunteers).toBe(true)
    expect(features.hasHarvests).toBe(true)
  })

  it("returns an independent object per call (no shared mutable map)", () => {
    const a = getFeaturesByType("producer")
    const b = getFeaturesByType("producer")
    expect(a).not.toBe(b)
    a.hasProducts = false
    expect(getFeaturesByType("producer").hasProducts).toBe(true)
  })
})

describe("extension key declarations", () => {
  it("ALL_FEATURE_KEYS is derived from ALL_EXTENSION_OPTIONS", () => {
    expect(ALL_FEATURE_KEYS).toEqual(ALL_EXTENSION_OPTIONS.map((o) => o.key))
  })

  it("every declared option key is a real VendorFeatures key", () => {
    const sample: VendorFeatures = getFeaturesByType("default")
    for (const option of ALL_EXTENSION_OPTIONS) {
      expect(option.key in sample).toBe(true)
    }
  })

  it("has no duplicate option keys", () => {
    const keys = ALL_EXTENSION_OPTIONS.map((o) => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
