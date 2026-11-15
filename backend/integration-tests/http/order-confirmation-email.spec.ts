import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import handleOrderPlaced from "../../src/subscribers/order-placed"
import { orderSummaryLines } from "../../src/modules/resend/order-summary"
import { trackSubscribers } from "./helpers/drain-subscribers"

jest.setTimeout(240 * 1000)

/**
 * The buyer's order confirmation on a real migrated database: the real order
 * module computing totals, the real `query.graph`, the real app with every
 * subscriber registered. Only `createNotifications` is replaced, because the
 * test app has no email provider and no email may be sent from a test.
 *
 * What the unit spec cannot show and this does: that the fields the
 * subscriber asks `query.graph` for exist (an unknown field throws inside the
 * subscriber's catch, which is exactly how the old `feed` call failed without
 * anyone noticing), that the totals the template formats arrive as numbers,
 * and that the booted app actually runs this subscriber on `order.placed`.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const container = () => getContainer() as any

    type ItemExtra = { tax_lines?: Array<{ rate: number; code: string }>; adjustments?: Array<{ amount: number; code: string }> }

    async function makeOrder(opts: { item?: ItemExtra; shipping?: ItemExtra } = {}) {
      const orders = container().resolve(Modules.ORDER)
      const [order] = await orders.createOrders([
        {
          currency_code: "usd",
          email: "buyer@example.com",
          shipping_address: {
            first_name: "Jordan",
            last_name: "Buyer",
            address_1: "1 Main St",
            city: "Detroit",
            country_code: "us",
            postal_code: "48201",
            phone: "555-0100",
          },
          items: [
            {
              title: "16 oz",
              product_title: "Raw Wildflower Honey",
              variant_title: "16 oz",
              thumbnail: "https://img.example.com/honey.png",
              quantity: 2,
              unit_price: 10,
              ...opts.item,
            },
          ],
          shipping_methods: [{ name: "Standard Shipping", amount: 8, ...opts.shipping }],
        },
      ])
      return order
    }

    function spyOnNotifications() {
      const notification = container().resolve(Modules.NOTIFICATION)
      return jest.spyOn(notification, "createNotifications").mockResolvedValue([] as never)
    }

    const confirmationCalls = (spy: jest.SpyInstance) =>
      spy.mock.calls
        .map(([payload]) => payload as Record<string, any>)
        .filter((payload) => payload?.template === "order-placed")

    describe("order confirmation email", () => {
      let drainSubscribers: () => Promise<void> = async () => {}

      beforeEach(() => {
        drainSubscribers = trackSubscribers(container)
      })

      afterEach(async () => {
        await drainSubscribers()
        jest.restoreAllMocks()
      })

      it("emails the buyer the order-placed template with the order the template renders", async () => {
        const order = await makeOrder()
        const spy = spyOnNotifications()

        await handleOrderPlaced({
          event: { name: "order.placed", data: { id: order.id } },
          container: container(),
        } as never)

        const calls = confirmationCalls(spy)
        expect(calls).toHaveLength(1)
        const [payload] = calls
        expect(payload).toMatchObject({
          to: "buyer@example.com",
          channel: "email",
          template: "order-placed",
          idempotency_key: `order-confirmation:${order.id}`,
        })

        // Plain numbers, not the BigNumber instances the order module returns:
        // toMatchObject fails a BigNumber against a number literal.
        const sent = payload.data.order
        expect(sent).toMatchObject({
          id: order.id,
          currency_code: "usd",
          total: 28,
          item_subtotal: 20,
          discount_subtotal: 0,
          tax_total: 0,
          credit_line_total: 0,
          items: [
            {
              product_title: "Raw Wildflower Honey",
              variant_title: "16 oz",
              thumbnail: "https://img.example.com/honey.png",
              quantity: 2,
              subtotal: 20,
            },
          ],
          shipping_methods: [{ name: "Standard Shipping", subtotal: 8 }],
          shipping_address: { first_name: "Jordan" },
        })
        expect(typeof sent.display_id).toBe("number")
        // Only what the template renders: the street address and phone stay
        // out of the stored notification row.
        expect(JSON.stringify(payload.data)).not.toContain("1 Main St")
        expect(JSON.stringify(payload.data)).not.toContain("555-0100")
      })

      it("on a taxed, discounted order the summary lines add up to the total the order module computed", async () => {
        // The reviewer's probe order (2 x $10 at 10%, $8 shipping) rendered
        // Subtotal $22 / Shipping $8 / Tax $2 / Total $30 with the first
        // version: item_total and shipping totals include tax. This one adds
        // a $5 item discount and taxes the shipping too.
        const order = await makeOrder({
          item: { tax_lines: [{ rate: 10, code: "ST" }], adjustments: [{ amount: 5, code: "SAVE5" }] },
          shipping: { tax_lines: [{ rate: 10, code: "ST" }] },
        })
        const spy = spyOnNotifications()

        await handleOrderPlaced({
          event: { name: "order.placed", data: { id: order.id } },
          container: container(),
        } as never)

        const [payload] = confirmationCalls(spy)
        const sent = payload.data.order
        // 20 + 8 - 5 + (15 + 8) * 10% = 25.3, as the real order module has it.
        expect(sent.total).toBeCloseTo(25.3, 10)
        expect(sent.item_subtotal).toBe(20)
        expect(sent.discount_subtotal).toBeCloseTo(5, 10)
        expect(sent.tax_total).toBeCloseTo(2.3, 10)
        expect(sent.shipping_methods).toEqual([expect.objectContaining({ name: "Standard Shipping", subtotal: 8 })])
        expect(sent.items).toEqual([expect.objectContaining({ quantity: 2, subtotal: 20 })])

        // The lines the template renders, exactly: orderSummaryLines is what
        // the .tsx maps over.
        const lines = orderSummaryLines(sent)
        expect(lines.map((l) => [l.label, l.amount])).toEqual([
          ["Subtotal", 20],
          ["Standard Shipping", 8],
          ["Discount", expect.closeTo(-5, 10)],
          ["Tax", expect.closeTo(2.3, 10)],
        ])
        expect(lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(sent.total, 10)

        const { data: [row] } = await container()
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "order", fields: ["id", "total", "item_total", "tax_total", "items.*", "shipping_methods.*"], filters: { id: order.id } })
        expect(Number(row.total)).toBeCloseTo(25.3, 10)
        // item_total includes tax, which is why it is not the Subtotal line.
        expect(Number(row.item_total)).toBeCloseTo(16.5, 10)
      })

      it("runs on order.placed in the booted app", async () => {
        const order = await makeOrder()
        const spy = spyOnNotifications()

        await container().resolve(Modules.EVENT_BUS).emit({ name: "order.placed", data: { id: order.id } })
        await drainSubscribers()

        const calls = confirmationCalls(spy).filter((payload) => payload.data?.order?.id === order.id)
        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({ channel: "email", to: "buyer@example.com" })
      })
    })
  },
})
