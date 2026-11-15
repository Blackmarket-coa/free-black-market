/**
 * The buyer's order confirmation (subscribers/order-placed.ts).
 *
 * The live failure this locks out: the subscriber sent `channel: "feed",
 * template: "order.placed"`. medusa-config registers no provider for `feed`,
 * so Medusa's notification module threw "Could not find a notification
 * provider for channel: feed", the subscriber's catch swallowed it, and no
 * buyer was ever emailed — while the storefront's confirmation page said
 * "We have sent the order confirmation details to <email>".
 *
 * The container below resolves only the two keys the subscriber should use,
 * by their constants, and throws on anything else, so a guessed key cannot
 * pass by falling through to a default.
 */
import handler, { ORDER_CONFIRMATION_FIELDS } from "../order-placed"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { EMAIL_TEMPLATE_NAMES } from "../../modules/resend/templates"

type Row = Record<string, unknown>

const ORDER: Row = {
  id: "order_1",
  display_id: 1042,
  email: "buyer@example.com",
  currency_code: "usd",
  // 2 x $10 at 10% tax with $5 off, plus $8 shipping at 10%.
  total: 25.3,
  item_subtotal: 20,
  item_total: 16.5,
  tax_total: 2.3,
  discount_total: 5.5,
  discount_tax_total: 0.5,
  credit_line_total: 0,
  items: [
    {
      id: "ordli_1",
      thumbnail: "https://img.example.com/honey.png",
      product_title: "Raw Wildflower Honey",
      variant_title: "16 oz",
      quantity: 2,
      subtotal: 20,
      total: 16.5,
    },
  ],
  shipping_methods: [{ id: "ordsm_1", name: "Standard Shipping", subtotal: 8, total: 8.8 }],
  customer: { first_name: "Jordan" },
  shipping_address: { first_name: "Jordan", address_1: "1 Main St", phone: "555-0100" },
  billing_address: { address_1: "1 Main St" },
}

function makeContainer(rows: Row[], opts: { createThrows?: boolean } = {}) {
  const graph = jest.fn(async () => ({ data: rows }))
  const createNotifications = jest.fn(async () => {
    if (opts.createThrows) throw new Error("Could not find a notification provider for channel: email")
    return [{ id: "noti_1" }]
  })
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    [Modules.NOTIFICATION]: { createNotifications },
  }
  const resolve = jest.fn((key: string) => {
    if (!(key in services)) throw new Error(`unexpected container key: ${key}`)
    return services[key]
  })
  return { container: { resolve } as never, graph, createNotifications }
}

const run = (container: never, id = "order_1") =>
  handler({ event: { data: { id }, name: "order.placed" }, container } as never)

describe("order-placed subscriber", () => {
  it("emails the buyer the order-placed template on the email channel", async () => {
    const { container, createNotifications } = makeContainer([ORDER])

    await run(container)

    expect(createNotifications).toHaveBeenCalledTimes(1)
    const [payload] = createNotifications.mock.calls[0] as unknown as [Row]
    expect(payload).toMatchObject({
      to: "buyer@example.com",
      channel: "email",
      template: "order-placed",
      idempotency_key: "order-confirmation:order_1",
    })
    // The template must be one both email providers can render.
    expect(EMAIL_TEMPLATE_NAMES).toContain(payload.template)
  })

  it("passes exactly what the order-placed template renders", async () => {
    const { container, graph, createNotifications } = makeContainer([ORDER])

    await run(container)

    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order",
        fields: ORDER_CONFIRMATION_FIELDS,
        filters: { id: "order_1" },
      })
    )
    // currency_code is load-bearing: the template builds an Intl currency
    // formatter from it and throws RangeError at render time without it. The
    // wildcards are too: on a real order, `items.total` selected by name
    // throws inside MikroORM (see the integration spec).
    expect(ORDER_CONFIRMATION_FIELDS).toEqual(
      expect.arrayContaining([
        "currency_code",
        "total",
        "item_subtotal",
        "tax_total",
        "discount_total",
        "discount_tax_total",
        "credit_line_total",
        "items.*",
        "shipping_methods.*",
      ])
    )

    const [payload] = createNotifications.mock.calls[0] as unknown as [{ data: { order: Row } }]
    expect(payload.data.order).toEqual({
      id: "order_1",
      display_id: 1042,
      currency_code: "usd",
      total: 25.3,
      item_subtotal: 20,
      // discount_total less its tax part: the pre-tax discount.
      discount_subtotal: 5,
      tax_total: 2.3,
      credit_line_total: 0,
      items: [
        {
          id: "ordli_1",
          thumbnail: "https://img.example.com/honey.png",
          product_title: "Raw Wildflower Honey",
          variant_title: "16 oz",
          quantity: 2,
          subtotal: 20,
        },
      ],
      shipping_methods: [{ id: "ordsm_1", name: "Standard Shipping", subtotal: 8 }],
      customer: { first_name: "Jordan" },
      shipping_address: { first_name: "Jordan" },
    })
    // Addresses stay out of the stored notification row.
    expect(JSON.stringify(payload.data)).not.toContain("1 Main St")
    expect(JSON.stringify(payload.data)).not.toContain("555-0100")
  })

  it("hands the template plain numbers when the order module returns BigNumber totals", async () => {
    // The order module returns totals as BigNumber instances; the template
    // currency-formats numbers and prints anything else with toString().
    const big = (n: number) => ({ valueOf: () => n, toString: () => String(n) })
    const { container, createNotifications } = makeContainer([
      {
        ...ORDER,
        total: big(25.3),
        item_subtotal: big(20),
        discount_total: big(5.5),
        discount_tax_total: big(0.5),
        items: [{ id: "ordli_1", quantity: big(2), subtotal: big(20) }],
        shipping_methods: [{ id: "ordsm_1", name: "Standard Shipping", subtotal: big(8) }],
      },
    ])

    await run(container)

    const [payload] = createNotifications.mock.calls[0] as unknown as [{ data: { order: Row } }]
    expect(payload.data.order).toMatchObject({
      total: 25.3,
      item_subtotal: 20,
      discount_subtotal: 5,
      items: [{ id: "ordli_1", quantity: 2, subtotal: 20 }],
      shipping_methods: [{ id: "ordsm_1", subtotal: 8 }],
    })
  })

  it("sends nothing when the order has no email", async () => {
    const { container, createNotifications } = makeContainer([{ ...ORDER, email: null }])

    await run(container)

    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("sends nothing when the order is not found", async () => {
    const { container, createNotifications } = makeContainer([])

    await run(container, "order_missing")

    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("does not throw into the order flow when the send fails", async () => {
    const { container, createNotifications } = makeContainer([ORDER], { createThrows: true })

    await expect(run(container)).resolves.toBeUndefined()
    expect(createNotifications).toHaveBeenCalledTimes(1)
  })
})
