import { describe, expect, it } from "vitest"
import {
  canPlaceWithoutPayment,
  cartOwesNothing,
  cartTicketMode,
  reviewStepReached,
} from "../nothing-to-pay"

const ticket = { metadata: { show_date: "2027-03-14", seat_number: "7" } }
const tomatoes = { metadata: {} }

describe("cartOwesNothing", () => {
  it("is true for a total of zero or less", () => {
    expect(cartOwesNothing({ total: 0 })).toBe(true)
    expect(cartOwesNothing({ total: -3 })).toBe(true)
    expect(cartOwesNothing({ total: "0" })).toBe(true)
  })

  it("is false for anything owed, however little", () => {
    expect(cartOwesNothing({ total: 0.01 })).toBe(false)
    expect(cartOwesNothing({ total: 25 })).toBe(false)
  })

  it("never reads a total that is missing or not a number as nothing to pay", () => {
    expect(cartOwesNothing(null)).toBe(false)
    expect(cartOwesNothing({})).toBe(false)
    expect(cartOwesNothing({ total: null })).toBe(false)
    expect(cartOwesNothing({ total: "" })).toBe(false)
    expect(cartOwesNothing({ total: "abc" })).toBe(false)
    expect(cartOwesNothing({ total: NaN })).toBe(false)
  })
})

describe("cartTicketMode", () => {
  it("tells an all-ticket cart from a mixed one and from one with no tickets", () => {
    expect(cartTicketMode({ items: [ticket, ticket] })).toBe("all-tickets")
    expect(cartTicketMode({ items: [ticket, tomatoes] })).toBe("mixed")
    expect(cartTicketMode({ items: [tomatoes] })).toBe("none")
    expect(cartTicketMode({ items: [] })).toBe("none")
  })
})

describe("canPlaceWithoutPayment", () => {
  // Measured on Postgres: `POST /store/carts/:id/complete-tickets` completes
  // a $0 all-ticket cart with no payment session; the main checkout answers
  // any $0 cart 409 `cart_nothing_to_pay`.
  it("is only an all-ticket cart that owes nothing", () => {
    expect(canPlaceWithoutPayment({ total: 0, items: [ticket] })).toBe(true)
    expect(canPlaceWithoutPayment({ total: 0, items: [tomatoes] })).toBe(false)
    expect(canPlaceWithoutPayment({ total: 0, items: [ticket, tomatoes] })).toBe(false)
    expect(canPlaceWithoutPayment({ total: 5, items: [ticket] })).toBe(false)
  })
})

describe("reviewStepReached", () => {
  const through = { shipping_address: { city: "Atlanta" }, shipping_methods: [{ id: "sm_1" }] }

  it("needs a payment collection for a cart that owes money", () => {
    expect(reviewStepReached({ ...through, total: 25, payment_collection: { id: "pay_col_1" } })).toBe(true)
    expect(reviewStepReached({ ...through, total: 25, payment_collection: null })).toBe(false)
  })

  it("needs none for a cart that owes nothing: it has no method to choose", () => {
    expect(reviewStepReached({ ...through, total: 0, payment_collection: null })).toBe(true)
  })

  it("still needs the address and a delivery option", () => {
    expect(reviewStepReached({ ...through, shipping_methods: [], total: 0 })).toBe(false)
    expect(reviewStepReached({ ...through, shipping_address: null, total: 0 })).toBe(false)
    expect(reviewStepReached(null)).toBe(false)
  })
})
