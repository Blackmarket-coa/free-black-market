import { describe, expect, it } from "vitest"

import type { VendorFeatures } from "../../providers/vendor-type-provider"
import { getVendorNavigationForTest } from "./use-vendor-navigation"

const baseFeatures: VendorFeatures = {
  hasProducts: false,
  hasInventory: false,
  hasSeasons: false,
  hasVolunteers: false,
  hasMenu: false,
  hasDeliveryZones: false,
  hasDonations: false,
  hasSubscriptions: false,
  hasSupport: false,
  hasHarvests: false,
  hasPlots: false,
  hasRequests: false,
  hasFarm: false,
  hasShows: false,
}

describe("getVendorNavigationForTest extension gating", () => {
  it("includes and excludes order cycles route based on hasSeasons", () => {
    const withoutSeasons = getVendorNavigationForTest({
      vendorType: "producer",
      features: baseFeatures,
    })

    expect(withoutSeasons.coreRoutes.some((route) => route.to === "/order-cycles")).toBe(false)

    const withSeasons = getVendorNavigationForTest({
      vendorType: "producer",
      features: {
        ...baseFeatures,
        hasSeasons: true,
      },
    })

    expect(withSeasons.coreRoutes.some((route) => route.to === "/order-cycles")).toBe(true)
  })

  it("includes and excludes messages route based on hasSupport", () => {
    const withoutSupport = getVendorNavigationForTest({
      vendorType: "maker",
      features: baseFeatures,
    })

    expect(withoutSupport.coreRoutes.some((route) => route.to === "/messages")).toBe(false)

    const withSupport = getVendorNavigationForTest({
      vendorType: "maker",
      features: {
        ...baseFeatures,
        hasSupport: true,
      },
    })

    expect(withSupport.coreRoutes.some((route) => route.to === "/messages")).toBe(true)
  })

  it("includes and excludes farm harvest child route based on hasHarvests", () => {
    const withoutHarvests = getVendorNavigationForTest({
      vendorType: "producer",
      features: {
        ...baseFeatures,
        hasFarm: true,
      },
    })

    const farmWithoutHarvests = withoutHarvests.coreRoutes.find((route) => route.to === "/farm")
    expect(farmWithoutHarvests?.items?.some((item) => item.to === "/farm/harvests")).toBe(false)

    const withHarvests = getVendorNavigationForTest({
      vendorType: "producer",
      features: {
        ...baseFeatures,
        hasFarm: true,
        hasHarvests: true,
      },
    })

    const farmWithHarvests = withHarvests.coreRoutes.find((route) => route.to === "/farm")
    expect(farmWithHarvests?.items?.some((item) => item.to === "/farm/harvests")).toBe(true)
  })
})

describe("the cottage-food dashboard (SD-152 (8))", () => {
  const targets = (features: VendorFeatures) =>
    getVendorNavigationForTest({ vendorType: "maker", features }).coreRoutes

  it("is in the sidebar for a seller with products, with its three pages", () => {
    const entry = targets({ ...baseFeatures, hasProducts: true }).find(
      (route) => route.to === "/cottage-food"
    )

    expect(entry?.label).toBe("Cottage Food")
    expect(entry?.items?.map((item) => item.to)).toEqual([
      "/cottage-food/profile",
      "/cottage-food/sales",
      "/cottage-food/labels",
    ])
  })

  it("is not shown to a seller without products", () => {
    expect(
      targets(baseFeatures).some((route) => route.to === "/cottage-food")
    ).toBe(false)
  })
})

