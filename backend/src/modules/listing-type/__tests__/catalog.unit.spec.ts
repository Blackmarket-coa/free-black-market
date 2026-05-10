import {
  LISTING_TYPE_CATALOG,
  LISTING_TYPE_IDS,
  getListingType,
} from "../catalog"

describe("listing-type catalog", () => {
  it("exposes the v1 ship list of nine listing types", () => {
    expect(LISTING_TYPE_IDS).toHaveLength(9)
  })

  it("physical_product is the only universal default (requires_shipping=true, no specials)", () => {
    const def = LISTING_TYPE_CATALOG.physical_product
    expect(def.requires_shipping).toBe(true)
    expect(def.requires_capacity).toBe(false)
    expect(def.requires_recurrence).toBe(false)
    expect(def.requires_escrow).toBe(false)
    expect(def.unique_inventory).toBe(false)
  })

  it("unique_inventory has unique_inventory=true (lock to qty=1)", () => {
    expect(LISTING_TYPE_CATALOG.unique_inventory.unique_inventory).toBe(true)
  })

  it("campaign requires escrow (crowdfund all-or-nothing pattern)", () => {
    expect(LISTING_TYPE_CATALOG.campaign.requires_escrow).toBe(true)
  })

  it("recurring requires recurrence", () => {
    expect(LISTING_TYPE_CATALOG.recurring.requires_recurrence).toBe(true)
  })

  it("event and bookable require capacity", () => {
    expect(LISTING_TYPE_CATALOG.event.requires_capacity).toBe(true)
    expect(LISTING_TYPE_CATALOG.bookable.requires_capacity).toBe(true)
  })

  it("digital does NOT require shipping", () => {
    expect(LISTING_TYPE_CATALOG.digital.requires_shipping).toBe(false)
  })

  it("every catalog entry has a non-empty description", () => {
    for (const id of LISTING_TYPE_IDS) {
      expect(LISTING_TYPE_CATALOG[id].description.length).toBeGreaterThan(0)
    }
  })

  it("getListingType throws on unknown id", () => {
    expect(() => getListingType("nonexistent" as any)).toThrow()
  })
})
