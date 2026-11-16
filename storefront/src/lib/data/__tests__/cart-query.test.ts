import { describe, expect, it } from "vitest"
import { CART_FIELDS } from "../cart-query"

/**
 * The cart's field list (SD-118). What it returns from the real backend is
 * pinned in `backend/integration-tests/http/store-public-fields.spec.ts`,
 * which loads the same constant; this holds the two properties of the string
 * itself that a careless edit breaks without any request failing.
 */
describe("CART_FIELDS", () => {
  const entries = CART_FIELDS.split(",")

  it("every entry carries a modifier, so Medusa adds to the cart's default fields and does not replace them", () => {
    // `*relation`, `+field`, or the leading space Medusa reads as `+`. One
    // bare name and the totals, addresses and payment collection are gone.
    for (const entry of entries) {
      expect(entry).toMatch(/^[*+ ]/)
    }
  })

  it("asks for the seller columns the cart shows, by name, and never for the whole seller row", () => {
    const seller = entries.map((entry) => entry.trim().replace(/^[*+]/, "")).filter((entry) => entry.includes("seller"))
    expect(seller.sort()).toEqual([
      "items.product.seller.created_at",
      "items.product.seller.handle",
      "items.product.seller.id",
      "items.product.seller.name",
      "items.product.seller.photo",
    ])
    expect(CART_FIELDS).not.toMatch(/\*items\.product\.seller/)
    expect(CART_FIELDS).not.toMatch(/seller\.\*/)
  })
})
