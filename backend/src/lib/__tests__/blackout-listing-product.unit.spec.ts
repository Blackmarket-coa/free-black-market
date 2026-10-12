import {
  ensureListingProduct,
  listingProductHandle,
} from "../blackout-listing-product"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { MARKETPLACE_LISTING_MODULE } from "../../modules/marketplace-listing"

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

describe("ensureListingProduct — the shadow product's seller link (SD-48)", () => {
  // A seller-less shadow product is refused by every checkout that settles to
  // the seller, so every path that hands a product back links it again; the
  // link module makes a repeat of the same pair harmless.
  const base = {
    id: "clist_1",
    seller_id: "sel_1",
    title: "Signal",
    price_cents: 500,
    currency: "USD",
  }
  const sellerLink = (productId: string) => ({
    [SELLER_MODULE]: { seller_id: "sel_1" },
    [Modules.PRODUCT]: { product_id: productId },
  })

  /** A container serving only the keys a path may use; any other key fails the test. */
  function containerWith(services: Record<string, unknown>) {
    const resolve = jest.fn((key: string) => {
      if (!(key in services)) throw new Error(`unexpected resolve of ${key}`)
      return services[key]
    })
    return { container: { resolve } as unknown as MedusaContainer, resolve }
  }

  it("a listing that already carries its ids: links the product to the listing's seller, then returns the ids", async () => {
    const create = jest.fn(async () => [])
    const { container, resolve } = containerWith({ [ContainerRegistrationKeys.REMOTE_LINK]: { create } })

    await expect(
      ensureListingProduct(container, { ...base, product_id: "prod_1", variant_id: "variant_1" })
    ).resolves.toEqual({ product_id: "prod_1", variant_id: "variant_1", created: false })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(sellerLink("prod_1"))
    // Nothing else is read or written on this path.
    expect(resolve.mock.calls.map(([key]) => key)).toEqual([ContainerRegistrationKeys.REMOTE_LINK])
  })

  it("a link the module refuses (the product is another seller's) is logged, and the ids are still returned", async () => {
    const create = jest.fn(async () => {
      throw new Error("Cannot create multiple links between 'seller' and 'product'")
    })
    const { container } = containerWith({ [ContainerRegistrationKeys.REMOTE_LINK]: { create } })

    await expect(
      ensureListingProduct(container, { ...base, product_id: "prod_1", variant_id: "variant_1" })
    ).resolves.toEqual({ product_id: "prod_1", variant_id: "variant_1", created: false })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("a product an earlier run made but never recorded (found by its handle): linked to the seller, then recorded on the listing", async () => {
    const calls: string[] = []
    const listProducts = jest.fn(async () => [{ id: "prod_9", variants: [{ id: "variant_9" }] }])
    const create = jest.fn(async () => {
      calls.push("link")
      return []
    })
    const updateCreatorListings = jest.fn(async () => {
      calls.push("record")
      return {}
    })
    const { container } = containerWith({
      [Modules.PRODUCT]: { listProducts },
      [ContainerRegistrationKeys.REMOTE_LINK]: { create },
      [MARKETPLACE_LISTING_MODULE]: { updateCreatorListings },
    })

    await expect(ensureListingProduct(container, base)).resolves.toEqual({
      product_id: "prod_9",
      variant_id: "variant_9",
      created: false,
    })
    expect(listProducts).toHaveBeenCalledWith({ handle: "blackout-listing-clist-1" }, { relations: ["variants"], take: 1 })
    expect(create).toHaveBeenCalledWith(sellerLink("prod_9"))
    expect(updateCreatorListings).toHaveBeenCalledWith({ id: "clist_1", product_id: "prod_9", variant_id: "variant_9" })
    expect(calls).toEqual(["link", "record"])
  })
})
