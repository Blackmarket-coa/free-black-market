import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import handleOrderPlaced from "../../src/subscribers/order-placed"
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

    async function makeOrder() {
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
            },
          ],
          shipping_methods: [{ name: "Standard Shipping", amount: 8 }],
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
          item_total: 20,
          tax_total: 0,
          items: [
            {
              product_title: "Raw Wildflower Honey",
              variant_title: "16 oz",
              thumbnail: "https://img.example.com/honey.png",
              total: 20,
            },
          ],
          shipping_methods: [{ name: "Standard Shipping", total: 8 }],
          shipping_address: { first_name: "Jordan" },
        })
        expect(typeof sent.display_id).toBe("number")
        // Only what the template renders: the street address and phone stay
        // out of the stored notification row.
        expect(JSON.stringify(payload.data)).not.toContain("1 Main St")
        expect(JSON.stringify(payload.data)).not.toContain("555-0100")
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
