import {
  resolveSellerTotalsForOrder,
  orderSourceId,
} from "../utils/order-lines"

/** Container stub exposing just the `query.graph` the helper uses. */
function makeContainer(responses: {
  order?: any
  products?: any[]
}) {
  return {
    resolve: () => ({
      graph: async ({ entity }: { entity: string }) => {
        if (entity === "order") {
          return { data: responses.order ? [responses.order] : [] }
        }
        if (entity === "product") return { data: responses.products ?? [] }
        return { data: [] }
      },
    }),
  }
}

describe("resolveSellerTotalsForOrder", () => {
  it("attributes each line item to the seller that owns the product", async () => {
    const container = makeContainer({
      order: {
        id: "order_1",
        items: [
          { id: "li_1", quantity: 2, unit_price: 1_500, product_id: "prod_a" },
          { id: "li_2", quantity: 1, unit_price: 800, product_id: "prod_b" },
        ],
      },
      products: [
        { id: "prod_a", seller: { id: "sel_baker" } },
        { id: "prod_b", seller: { id: "sel_other" } },
      ],
    })

    const totals = await resolveSellerTotalsForOrder(container, "order_1")

    // The whole basket must NOT land on one seller's cap.
    expect(totals).toEqual(
      expect.arrayContaining([
        { seller_id: "sel_baker", gross_cents: 3_000, quantity: 2 },
        { seller_id: "sel_other", gross_cents: 800, quantity: 1 },
      ])
    )
    expect(totals).toHaveLength(2)
  })

  it("sums multiple line items belonging to the same seller", async () => {
    const container = makeContainer({
      order: {
        id: "order_1",
        items: [
          { id: "li_1", quantity: 2, unit_price: 1_000, product_id: "prod_a" },
          { id: "li_2", quantity: 3, unit_price: 500, product_id: "prod_b" },
        ],
      },
      products: [
        { id: "prod_a", seller: { id: "sel_baker" } },
        { id: "prod_b", seller: { id: "sel_baker" } },
      ],
    })

    const totals = await resolveSellerTotalsForOrder(container, "order_1")
    expect(totals).toEqual([
      { seller_id: "sel_baker", gross_cents: 3_500, quantity: 5 },
    ])
  })

  it("skips items whose product has no owning seller", async () => {
    const container = makeContainer({
      order: {
        id: "order_1",
        items: [
          { id: "li_1", quantity: 1, unit_price: 1_000, product_id: "prod_a" },
          { id: "li_2", quantity: 1, unit_price: 9_999, product_id: "prod_orphan" },
        ],
      },
      products: [
        { id: "prod_a", seller: { id: "sel_baker" } },
        { id: "prod_orphan", seller: null },
      ],
    })

    const totals = await resolveSellerTotalsForOrder(container, "order_1")
    expect(totals).toEqual([
      { seller_id: "sel_baker", gross_cents: 1_000, quantity: 1 },
    ])
  })

  it("returns empty for a missing order rather than throwing", async () => {
    const container = makeContainer({})
    expect(await resolveSellerTotalsForOrder(container, "nope")).toEqual([])
  })

  it("returns empty for an order with no line items", async () => {
    const container = makeContainer({ order: { id: "order_1", items: [] } })
    expect(await resolveSellerTotalsForOrder(container, "order_1")).toEqual([])
  })

  it("ignores non-numeric quantities and prices", async () => {
    const container = makeContainer({
      order: {
        id: "order_1",
        items: [
          { id: "li_1", quantity: null, unit_price: null, product_id: "prod_a" },
        ],
      },
      products: [{ id: "prod_a", seller: { id: "sel_baker" } }],
    })

    const totals = await resolveSellerTotalsForOrder(container, "order_1")
    expect(totals).toEqual([
      { seller_id: "sel_baker", gross_cents: 0, quantity: 0 },
    ])
  })
})

describe("orderSourceId", () => {
  it("scopes the ledger key per seller so a multi-vendor order doesn't collide", () => {
    expect(orderSourceId("order_1", "sel_a")).toBe("order_1:sel_a")
    expect(orderSourceId("order_1", "sel_a")).not.toBe(
      orderSourceId("order_1", "sel_b")
    )
  })
})
