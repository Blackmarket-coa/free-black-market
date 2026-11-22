import { describe, expect, it } from "vitest"
import {
  listNames,
  sellersInCart,
  shippingCoverage,
  shownFulfillmentType,
} from "../seller-shipping"

/**
 * One shipping method per seller, as Mercur's checkout requires. The states
 * below are the ones the checkout scout measured on Postgres: once a seller
 * has a method, `GET /store/shipping-options?cart_id=` stops listing that
 * seller's options; a two-seller cart with one method was authorized at
 * Stripe and then refused, 400 "Seller shipping method not found!".
 */

const A = { id: "sel_a", name: "Grower A" }
const B = { id: "sel_b", name: "Grower B" }
const C = { id: "sel_c", name: "Grower C" }

const line = (seller: { id: string; name: string } | null) => ({ product: seller ? { seller } : {} })
const cart = (sellers: Array<{ id: string; name: string } | null>, methodOptionIds: string[]) => ({
  items: sellers.map(line),
  shipping_methods: methodOptionIds.map((shipping_option_id, i) => ({ id: `sm_${i}`, shipping_option_id })),
})
const option = (id: string, seller: { id: string }) => ({ id, seller_id: seller.id })

describe("sellersInCart", () => {
  it("names each seller once, in the order the lines show them, and skips lines with no seller", () => {
    expect(sellersInCart(cart([B, A, B, null], []))).toEqual([B, A])
  })
})

describe("shippingCoverage", () => {
  it("refuses the measured cart: two sellers, a method for one, and names the seller still to choose for", () => {
    // After Grower A's pick, Mercur lists only Grower B's options.
    const coverage = shippingCoverage(cart([A, B], ["so_a"]), [option("so_b", B)])

    expect(coverage.complete).toBe(false)
    expect(coverage.toChoose).toEqual([B])
    expect(coverage.noOptions).toEqual([])
  })

  it("is complete when every seller has a method (Mercur then lists nothing)", () => {
    expect(shippingCoverage(cart([A, B], ["so_a", "so_b"]), []).complete).toBe(true)
  })

  it("names every seller with options before anything is chosen, and is not complete", () => {
    const coverage = shippingCoverage(cart([A, B], []), [option("so_a", A), option("so_b", B)])

    expect(coverage.complete).toBe(false)
    expect(coverage.toChoose).toEqual([A, B])
  })

  it("names a seller with no option for the address, exactly, before anything is chosen", () => {
    const coverage = shippingCoverage(cart([A, B], []), [option("so_a", A)])

    expect(coverage.complete).toBe(false)
    expect(coverage.toChoose).toEqual([A])
    expect(coverage.noOptions).toEqual([B])
    expect(coverage.noOptionsExact).toBe(true)
    expect(coverage.noOptionsCount).toBe(1)
  })

  it("keeps that seller named after the buyer chooses for the other, from the pick it remembers", () => {
    // Grower A chosen: A is no longer listed, and B never was.
    const coverage = shippingCoverage(cart([A, B], ["so_a"]), [], { so_a: A.id })

    expect(coverage.complete).toBe(false)
    expect(coverage.toChoose).toEqual([])
    expect(coverage.noOptions).toEqual([B])
    expect(coverage.noOptionsExact).toBe(true)
  })

  it("without the pick (a reload), counts: one of the two has no option, and both are only candidates", () => {
    const coverage = shippingCoverage(cart([A, B], ["so_a"]), [])

    expect(coverage.complete).toBe(false)
    expect(coverage.noOptions).toEqual([A, B])
    expect(coverage.noOptionsExact).toBe(false)
    expect(coverage.noOptionsCount).toBe(1)
  })

  it("does not let a method it cannot pair stand in for a seller Mercur still lists", () => {
    // One method, two sellers, Grower C still listed: whichever seller the
    // method is for, C has none.
    const coverage = shippingCoverage(cart([A, C], ["so_unknown"]), [option("so_c", C)])

    expect(coverage.complete).toBe(false)
    expect(coverage.toChoose).toEqual([C])
    expect(coverage.noOptions).toEqual([])
  })

  it("without the listed options, compares methods with sellers and names no one", () => {
    expect(shippingCoverage(cart([A, B], ["so_a"])).complete).toBe(false)
    expect(shippingCoverage(cart([A, B], ["so_a"])).toChoose).toEqual([])
    expect(shippingCoverage(cart([A, B], ["so_a", "so_b"])).complete).toBe(true)
  })

  it("still needs at least one method when no line names its seller", () => {
    expect(shippingCoverage(cart([null], []), []).complete).toBe(false)
    expect(shippingCoverage(cart([null], ["so_x"]), []).complete).toBe(true)
  })

  // Mercur lists options only for sellers in the cart that have no method, so
  // a list that is not empty is exact evidence that one still needs one,
  // whatever the lines and the remembered picks say.
  describe("a list that is not empty", () => {
    it("is not complete though no line names a seller, and names the seller from its option (review probe P8)", () => {
      const coverage = shippingCoverage(cart([null], ["so_x"]), [{ ...option("so_b", B), seller_name: "Grower B" }])

      expect(coverage.complete).toBe(false)
      expect(coverage.toChoose).toEqual([B])
    })

    it("is not complete though every method is counted for a seller", () => {
      // Two sellers, two methods, and Mercur still lists Grower B.
      const coverage = shippingCoverage(cart([A, B], ["so_x", "so_y"]), [option("so_b", B)])

      expect(coverage.complete).toBe(false)
      expect(coverage.toChoose).toEqual([B])
    })

    it("is not complete though a remembered pick says the listed seller has a method", () => {
      const coverage = shippingCoverage(cart([A], ["so_a"]), [option("so_a2", A)], { so_a: A.id })

      expect(coverage.complete).toBe(false)
      expect(coverage.toChoose).toEqual([A])
    })

    it("is not complete for an option that names no seller", () => {
      expect(shippingCoverage(cart([A], ["so_a"]), [{ id: "so_orphan" }]).complete).toBe(false)
    })
  })

  it("does not take a return option for a way to receive the order", () => {
    const returns = { ...option("so_b_return", B), rules: [{ attribute: "is_return", value: "true" }] }

    // Grower B has a method: the return option listed alone changes nothing.
    expect(shippingCoverage(cart([A, B], ["so_a", "so_b"]), [returns]).complete).toBe(true)
    // Grower B has none, and only a return option: nothing to choose.
    const coverage = shippingCoverage(cart([A, B], ["so_a"]), [returns], { so_a: A.id })
    expect(coverage.complete).toBe(false)
    expect(coverage.toChoose).toEqual([])
    expect(coverage.noOptions).toEqual([B])
  })
})

describe("shownFulfillmentType", () => {
  const offered = (types: Array<"delivery" | "pickup" | "shipping">) => ({
    delivery: types.includes("delivery"),
    pickup: types.includes("pickup"),
    shipping: types.includes("shipping"),
  })

  it("shows the type the buyer picked while it has options, whatever else is offered", () => {
    expect(shownFulfillmentType("pickup", offered(["pickup", "shipping", "delivery"]))).toBe("pickup")
    expect(shownFulfillmentType("delivery", offered(["delivery", "shipping"]))).toBe("delivery")
  })

  it("keeps Pickup for a remaining seller that offers only Pickup (the old effect forced Shipping, and the cart could never complete)", () => {
    expect(shownFulfillmentType("pickup", offered(["pickup"]))).toBe("pickup")
    expect(shownFulfillmentType(undefined, offered(["pickup"]))).toBe("pickup")
  })

  it("moves on to the only type left when the picked one has run out of options", () => {
    expect(shownFulfillmentType("shipping", offered(["pickup"]))).toBe("pickup")
  })

  it("lets the buyer choose when the picked type ran out and several are left, or nothing was picked", () => {
    expect(shownFulfillmentType("shipping", offered(["pickup", "delivery"]))).toBeUndefined()
    expect(shownFulfillmentType(undefined, offered(["pickup", "delivery"]))).toBeUndefined()
    expect(shownFulfillmentType(undefined, offered([]))).toBeUndefined()
  })
})

describe("listNames", () => {
  it("joins names as a sentence does", () => {
    expect(listNames([])).toBe("")
    expect(listNames(["A"])).toBe("A")
    expect(listNames(["A", "B"])).toBe("A and B")
    expect(listNames(["A", "B", "C"], "or")).toBe("A, B or C")
  })
})
