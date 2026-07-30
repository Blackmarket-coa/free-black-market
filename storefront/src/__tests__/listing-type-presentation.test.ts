import { describe, expect, it } from "vitest"
import {
  LISTING_TYPE_PRESENTATIONS,
  selectListingTypePresentation,
} from "@/lib/listing/listing-type-presentation"

describe("selectListingTypePresentation", () => {
  it("covers all nine catalog ids", () => {
    expect(Object.keys(LISTING_TYPE_PRESENTATIONS).sort()).toEqual(
      [
        "bookable",
        "campaign",
        "consignment",
        "digital",
        "event",
        "physical_product",
        "recurring",
        "unique_inventory",
        "wholesale",
      ].sort()
    )
  })

  it("each descriptor echoes its own catalog id", () => {
    for (const [id, descriptor] of Object.entries(LISTING_TYPE_PRESENTATIONS)) {
      expect(descriptor.catalogId).toBe(id)
    }
  })

  it("falls back to physical_product for null, undefined, and unknown ids", () => {
    expect(selectListingTypePresentation(null)).toBe(
      LISTING_TYPE_PRESENTATIONS.physical_product
    )
    expect(selectListingTypePresentation(undefined)).toBe(
      LISTING_TYPE_PRESENTATIONS.physical_product
    )
    expect(selectListingTypePresentation("")).toBe(
      LISTING_TYPE_PRESENTATIONS.physical_product
    )
    expect(selectListingTypePresentation("not_a_type")).toBe(
      LISTING_TYPE_PRESENTATIONS.physical_product
    )
  })

  it("physical products keep the default shipping + quantity chrome", () => {
    const physical = selectListingTypePresentation("physical_product")
    expect(physical.showShipping).toBe(true)
    expect(physical.showQuantity).toBe(true)
    expect(physical.detailSlot).toBe("none")
  })

  it("events expose the ticket-panel extension slot and skip shipping", () => {
    const event = selectListingTypePresentation("event")
    expect(event.detailSlot).toBe("event")
    expect(event.showShipping).toBe(false)
  })

  it("digital listings skip shipping and use the digital slot", () => {
    const digital = selectListingTypePresentation("digital")
    expect(digital.showShipping).toBe(false)
    expect(digital.detailSlot).toBe("digital")
  })

  it("subscriptions use the subscription slot", () => {
    const recurring = selectListingTypePresentation("recurring")
    expect(recurring.showShipping).toBe(false)
    expect(recurring.detailSlot).toBe("subscription")
  })

  it("bookable listings use the booking slot", () => {
    const bookable = selectListingTypePresentation("bookable")
    expect(bookable.showShipping).toBe(false)
    expect(bookable.detailSlot).toBe("booking")
  })

  it("one-of-a-kind listings hide the quantity control but still ship", () => {
    const unique = selectListingTypePresentation("unique_inventory")
    expect(unique.showQuantity).toBe(false)
    expect(unique.showShipping).toBe(true)
  })

  it("only unique_inventory hides the quantity control", () => {
    for (const descriptor of Object.values(LISTING_TYPE_PRESENTATIONS)) {
      expect(descriptor.showQuantity).toBe(
        descriptor.catalogId !== "unique_inventory"
      )
    }
  })

  it("shipping chrome matches the backend catalog's requires_shipping flags", () => {
    const shipping = Object.values(LISTING_TYPE_PRESENTATIONS)
      .filter((d) => d.showShipping)
      .map((d) => d.catalogId)
      .sort()
    expect(shipping).toEqual(
      ["consignment", "physical_product", "unique_inventory", "wholesale"].sort()
    )
  })
})
