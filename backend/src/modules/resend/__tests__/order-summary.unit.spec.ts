import { decorateCartTotals } from "@medusajs/framework/utils"
import { currencyFormatter, orderSummaryLines } from "../order-summary"
import { orderConfirmationPayload } from "../../../subscribers/order-placed"

/**
 * The order-placed email's summary must add up to the total on any order, not
 * only the untaxed ones every earlier fixture used. The first version printed
 * `item_total` (which includes tax in Medusa 2.14) as Subtotal and then Tax on
 * its own line: 2 x $10 at 10% plus $8 shipping rendered lines summing to $32
 * under a $30 total.
 *
 * The orders below are run through Medusa's own `decorateCartTotals` (the
 * function the order module computes its totals with), then through the
 * subscriber's payload builder and the summary, so the identity is checked
 * against Medusa's arithmetic rather than a restatement of it.
 */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

type CartLike = Parameters<typeof decorateCartTotals>[0]

function medusaOrder(cart: Record<string, unknown>) {
  // decorateCartTotals mutates and returns BigNumber totals, as the order
  // module's query.graph rows carry them.
  const decorated = decorateCartTotals(JSON.parse(JSON.stringify(cart)) as CartLike) as unknown as Record<string, unknown>
  return { id: "order_1", display_id: 1, currency_code: "usd", ...decorated } as never
}

function summaryOf(cart: Record<string, unknown>) {
  const { order } = orderConfirmationPayload(medusaOrder(cart))
  const lines = orderSummaryLines(order)
  return { order, lines, byKey: Object.fromEntries(lines.map((l) => [l.key, l.amount])) }
}

const honey = (extra: Record<string, unknown> = {}) => ({
  id: "li_1",
  unit_price: 10,
  quantity: 2,
  ...extra,
})
const shipping = (extra: Record<string, unknown> = {}) => ({ id: "sm_1", name: "Standard Shipping", amount: 8, ...extra })

describe("order-placed summary adds up to the total", () => {
  it("the reviewer's order: 2 x $10 at 10% tax, $8 untaxed shipping -> 20 + 8 + 2 = 30", () => {
    const { order, lines, byKey } = summaryOf({
      currency_code: "usd",
      items: [honey({ tax_lines: [{ rate: 10, code: "ST" }] })],
      shipping_methods: [shipping()],
    })
    expect(order.total).toBe(30)
    expect(byKey).toEqual({ subtotal: 20, "shipping:sm_1": 8, tax: 2 })
    expect(sum(lines.map((l) => l.amount))).toBeCloseTo(order.total as number, 10)
    // The item line shows its pre-tax subtotal, so the items add up to Subtotal.
    expect(order.items?.[0]).toMatchObject({ quantity: 2, subtotal: 20 })
  })

  it("with a discount, taxed shipping and tax on the discounted amount", () => {
    const { order, lines, byKey } = summaryOf({
      currency_code: "usd",
      items: [
        honey({
          tax_lines: [{ rate: 10, code: "ST" }],
          adjustments: [{ amount: 5, code: "SAVE5" }],
        }),
      ],
      shipping_methods: [shipping({ tax_lines: [{ rate: 10, code: "ST" }] })],
    })
    // 20 + 8 - 5 + (15 * 10% + 8 * 10%) = 25.3
    expect(order.total).toBeCloseTo(25.3, 10)
    expect(byKey.subtotal).toBe(20)
    expect(byKey["shipping:sm_1"]).toBe(8)
    expect(byKey.discount).toBeCloseTo(-5, 10)
    expect(byKey.tax).toBeCloseTo(2.3, 10)
    expect(sum(lines.map((l) => l.amount))).toBeCloseTo(order.total as number, 10)
  })

  it("with tax-inclusive prices the tax is taken out of the subtotals, and the lines still add up", () => {
    const { order, lines } = summaryOf({
      currency_code: "usd",
      items: [honey({ is_tax_inclusive: true, tax_lines: [{ rate: 10, code: "VAT" }], adjustments: [{ amount: 2, code: "TWO" }] })],
      shipping_methods: [shipping({ is_tax_inclusive: true, tax_lines: [{ rate: 10, code: "VAT" }] })],
    })
    expect(order.item_subtotal).toBeCloseTo(20 / 1.1, 10)
    expect(sum(lines.map((l) => l.amount))).toBeCloseTo(order.total as number, 10)
  })

  it("subtracts credit lines when the order has them", () => {
    const { order, lines, byKey } = summaryOf({
      currency_code: "usd",
      items: [honey()],
      shipping_methods: [shipping()],
      credit_lines: [{ id: "cl_1", amount: 3 }],
    })
    expect(order.total).toBe(25)
    expect(byKey.credits).toBe(-3)
    expect(sum(lines.map((l) => l.amount))).toBeCloseTo(order.total as number, 10)
  })

  it("shows no discount or credit line when there is none", () => {
    const { lines } = summaryOf({ currency_code: "usd", items: [honey()], shipping_methods: [shipping()] })
    expect(lines.map((l) => l.key)).toEqual(["subtotal", "shipping:sm_1", "tax"])
  })
})

describe("currencyFormatter", () => {
  it("formats a known currency", () => {
    expect(currencyFormatter("usd")(28)).toBe("$28.00")
    expect(currencyFormatter("usd")(-5)).toBe("-$5.00")
  })

  it("does not throw on a currency code Intl rejects", () => {
    expect(() => new Intl.NumberFormat("en-US", { style: "currency", currency: "NOT-A-CODE" })).toThrow(RangeError)
    expect(currencyFormatter("not-a-code")(28)).toBe("28.00 NOT-A-CODE")
    expect(currencyFormatter(undefined)(28)).toBe("28.00")
  })
})
