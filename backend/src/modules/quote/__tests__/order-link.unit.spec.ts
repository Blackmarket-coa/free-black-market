import { quoteIdFromOrder } from "../order-link"

describe("quote order-link: quoteIdFromOrder", () => {
  it("reads the order-level stamp first", () => {
    expect(
      quoteIdFromOrder({
        metadata: { quote_id: "q_1" },
        items: [{ metadata: { quote_id: "q_other" } }],
      })
    ).toBe("q_1")
  })

  it("falls back to line items when the order stamp is missing", () => {
    // Several routes spread-and-rewrite cart metadata; any of them can drop a
    // key another route set. The line items are the second witness.
    expect(
      quoteIdFromOrder({
        metadata: { something_else: true },
        items: [{ metadata: { quote_id: "q_2" } }, { metadata: { quote_id: "q_2" } }],
      })
    ).toBe("q_2")
  })

  it("refuses to guess when line items disagree", () => {
    // Two quote ids on one order means something upstream went wrong; linking
    // to whichever came first would record a fact not known to be true.
    expect(
      quoteIdFromOrder({
        metadata: null,
        items: [{ metadata: { quote_id: "q_a" } }, { metadata: { quote_id: "q_b" } }],
      })
    ).toBeNull()
  })

  it("returns null for an ordinary, un-quoted order", () => {
    expect(quoteIdFromOrder({ metadata: {}, items: [{ metadata: null }] })).toBeNull()
    expect(quoteIdFromOrder({})).toBeNull()
  })

  it("ignores blank stamps", () => {
    expect(
      quoteIdFromOrder({ metadata: { quote_id: "   " }, items: [] })
    ).toBeNull()
  })
})
