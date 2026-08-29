import {
  ensureListingProduct,
  listingProductHandle,
} from "../blackout-listing-product"
import type { MedusaContainer } from "@medusajs/framework/types"

describe("listingProductHandle — deterministic shadow-product handle", () => {
  it("is deterministic and handle-safe", () => {
    expect(listingProductHandle("clist_01ABC")).toBe("blackout-listing-clist-01abc")
    expect(listingProductHandle("clist_01ABC")).toBe(listingProductHandle("clist_01ABC"))
    expect(listingProductHandle("X y/Z")).toBe("blackout-listing-x-y-z")
  })

  it("caps the handle length", () => {
    expect(listingProductHandle("a".repeat(300)).length).toBeLessThanOrEqual(128)
  })
})

describe("ensureListingProduct — guards", () => {
  // The early paths never touch the container, so an exploding stub proves it.
  const explodingContainer = {
    resolve: () => {
      throw new Error("container should not be touched")
    },
  } as unknown as MedusaContainer

  const base = {
    id: "clist_1",
    seller_id: "sel_1",
    title: "Signal",
  }

  it("returns the persisted ids without touching the container", async () => {
    await expect(
      ensureListingProduct(explodingContainer, {
        ...base,
        product_id: "prod_1",
        variant_id: "variant_1",
        price_cents: 500,
        currency: "USD",
      })
    ).resolves.toEqual({
      product_id: "prod_1",
      variant_id: "variant_1",
      created: false,
    })
  })

  it("rejects listings without a usable price before any I/O", async () => {
    await expect(
      ensureListingProduct(explodingContainer, { ...base, currency: "USD" })
    ).rejects.toThrow(/no price_cents\/currency/)
    await expect(
      ensureListingProduct(explodingContainer, {
        ...base,
        price_cents: -1,
        currency: "USD",
      })
    ).rejects.toThrow(/no price_cents\/currency/)
    await expect(
      ensureListingProduct(explodingContainer, { ...base, price_cents: 500 })
    ).rejects.toThrow(/no price_cents\/currency/)
  })
})
