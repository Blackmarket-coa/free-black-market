import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import handleOrderPlaced from "../../src/subscribers/order-placed"
import { orderSummaryLines } from "../../src/modules/resend/order-summary"
import { eraseCustomerAcrossRegistry, readCustomerDataAcrossRegistry } from "../../src/lib/customer-erasure"
import purgeUndeliveredFeedOrderNotifications from "../../src/migration-scripts/purge-undelivered-feed-order-notifications"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows } from "./helpers/stalled-workflows"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

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
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any

    type ItemExtra = { tax_lines?: Array<{ rate: number; code: string }>; adjustments?: Array<{ amount: number; code: string }> }

    async function makeOrder(opts: { item?: ItemExtra; shipping?: ItemExtra } = {}) {
      const orders = container().resolve(Modules.ORDER)
      const [order] = await orders.createOrders([
        {
          currency_code: "usd",
          email: "buyer@example.com",
          customer_id: "cus_confirmation_buyer",
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
          receiver_id: "cus_confirmation_buyer",
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

    describe("the stored notification rows and the customer-data registry", () => {
      const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      let n = 0
      async function insertNotification(row: { channel: string; template: string; status: string; receiver_id?: string; data?: unknown }) {
        const id = `noti_test_${Date.now().toString(36)}${++n}`
        await pg().raw(
          `INSERT INTO "notification" ("id", "to", "channel", "template", "data", "receiver_id", "status") VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, "buyer@example.com", row.channel, row.template, JSON.stringify(row.data ?? {}), row.receiver_id ?? null, row.status]
        )
        return id
      }
      const exists = async (id: string) =>
        ((await pg().raw(`SELECT 1 FROM "notification" WHERE "id" = ?`, [id])).rows as unknown[]).length === 1

      it("exports and erases a customer's notification rows through receiver_id, and no one else's", async () => {
        const mine = await insertNotification({ channel: "email", template: "order-placed", status: "success", receiver_id: "cus_erase_me" })
        const theirs = await insertNotification({ channel: "email", template: "order-placed", status: "success", receiver_id: "cus_keep_me" })

        const exported = await readCustomerDataAcrossRegistry(container(), "cus_erase_me")
        expect((exported.notification ?? []).map((r) => (r as { id: string }).id)).toEqual([mine])

        const results = await eraseCustomerAcrossRegistry(container(), "cus_erase_me")
        expect(results.find((r) => r.entity === "notification")).toEqual({ entity: "notification", action: "delete", rows: 1 })
        expect(await exists(mine)).toBe(false)
        expect(await exists(theirs)).toBe(true)
      })

      it("the one-off purge deletes only the old subscriber's undelivered feed rows", async () => {
        const old = await insertNotification({
          channel: "feed",
          template: "order.placed",
          status: "failure",
          data: { billing_address: { address_1: "1 Main St" } },
        })
        const oldPending = await insertNotification({ channel: "feed", template: "order.placed", status: "pending" })
        const delivered = await insertNotification({ channel: "feed", template: "order.placed", status: "success" })
        const mercurFeed = await insertNotification({ channel: "feed", template: "admin-ui", status: "failure" })
        const email = await insertNotification({ channel: "email", template: "order-placed", status: "failure" })

        await purgeUndeliveredFeedOrderNotifications({ container: container() })

        expect(await exists(old)).toBe(false)
        expect(await exists(oldPending)).toBe(false)
        for (const kept of [delivered, mercurFeed, email]) expect(await exists(kept)).toBe(true)
      })
    })

    /**
     * The live path: `POST /store/carts/:id/complete`, Mercur's own route and
     * `split-and-complete-cart`, which creates one order per seller and emits
     * one `order.placed` per order. Fixtures as in
     * cart-completion-refuses.spec.ts (SD-53), including its order_set
     * display_id trigger (Mercur 1.5.0's model writes NULL into its own serial
     * column on a database migrated from scratch) and Stripe replaced on the
     * registered provider instance. `createNotifications` is stubbed, so no
     * email is sent.
     */
    describe("a two-seller cart completed through Mercur's checkout", () => {
      let drainSubscribers: () => Promise<void> = async () => {}
      let n = 0
      const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

      beforeAll(async () => {
        await container().resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(`
          CREATE OR REPLACE FUNCTION fbm_test_order_set_display_id() RETURNS trigger AS $$
          BEGIN
            IF NEW.display_id IS NULL THEN
              NEW.display_id := nextval(pg_get_serial_sequence('order_set', 'display_id'));
            END IF;
            RETURN NEW;
          END
          $$ LANGUAGE plpgsql;
          DROP TRIGGER IF EXISTS fbm_test_order_set_display_id ON order_set;
          CREATE TRIGGER fbm_test_order_set_display_id BEFORE INSERT ON order_set
            FOR EACH ROW EXECUTE FUNCTION fbm_test_order_set_display_id();
        `)
      })

      beforeEach(() => {
        drainSubscribers = trackSubscribers(container)
        const provider = container().resolve(Modules.PAYMENT).paymentProviderService_.retrieveProvider("pp_stripe_stripe")
        jest.spyOn(provider, "initiatePayment").mockImplementation(async () => {
          const id = `pi_test_${uid()}`
          return { id, data: { id, status: "requires_payment_method" } }
        })
        jest.spyOn(provider, "authorizePayment").mockImplementation(async (input: any) => ({
          status: "authorized",
          data: { ...(input?.data ?? {}), status: "requires_capture" },
        }))
        jest.spyOn(provider, "capturePayment").mockImplementation(async (input: any) => ({
          data: { ...(input?.data ?? {}), status: "succeeded" },
        }))
        jest.spyOn(provider, "cancelPayment").mockImplementation(async (input: any) => ({
          data: { ...(input?.data ?? {}), status: "canceled" },
        }))
      })

      afterEach(async () => {
        await drainSubscribers()
        const stalled = await clearStalledWorkflows(container)
        jest.restoreAllMocks()
        if (stalled.length) {
          throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
        }
      })

      async function sellerWithProduct(channelId: string) {
        const id = uid()
        const link = container().resolve(ContainerRegistrationKeys.LINK)
        const created = await container().resolve(SELLER_MODULE).createSellers({ name: `Grower ${id}`, handle: `grower-${id}` })
        const seller = Array.isArray(created) ? created[0] : created
        const [product] = await container().resolve(Modules.PRODUCT).createProducts([
          {
            title: `Tomatoes ${id}`,
            handle: `tomatoes-${id}`,
            status: "published",
            options: [{ title: "Size", values: ["Crate"] }],
            variants: [{ title: "Crate", manage_inventory: false, options: { Size: "Crate" } }],
          },
        ])
        await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.PRODUCT]: { product_id: product.id } })
        await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channelId } })

        // Mercur completes a cart only with a shipping method per seller,
        // read through its seller-shipping-option link.
        const fulfillment = container().resolve(Modules.FULFILLMENT)
        const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: `Farm ${id}` }])
        const set = await fulfillment.createFulfillmentSets({
          name: `Pickup ${id}`,
          type: "shipping",
          service_zones: [{ name: `US ${id}`, geo_zones: [{ type: "country", country_code: "us" }] }],
        })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        const profile = await fulfillment.createShippingProfiles({ name: `Default ${id}`, type: "default" })
        const option = await fulfillment.createShippingOptions({
          name: `Pickup ${id}`,
          service_zone_id: set.service_zones[0].id,
          shipping_profile_id: profile.id,
          provider_id: "manual_manual",
          price_type: "flat",
          type: { label: "Pickup", description: "Farm pickup", code: `pickup-${id}` },
          rules: [],
        } as any)
        await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.FULFILLMENT]: { shipping_option_id: option.id } })
        return { seller, product, option: option as { id: string; name: string } }
      }

      it("emails one order-placed confirmation per seller order, to the buyer", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const id = uid()
        const [channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${id}` }])
        const a = await sellerWithProduct(channel.id)
        const b = await sellerWithProduct(channel.id)
        const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${id}@example.com` }])
        const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
        const carts = container().resolve(Modules.CART)
        const item = (p: any) => ({
          title: p.title,
          product_id: p.id,
          variant_id: p.variants[0].id,
          quantity: 1,
          unit_price: 5,
          requires_shipping: true,
        })
        const [cart] = await carts.createCarts([
          {
            currency_code: "usd",
            region_id: region.id,
            sales_channel_id: channel.id,
            customer_id: customer.id,
            email: customer.email,
            items: [item(a.product), item(b.product)],
          },
        ])
        await carts.addShippingMethods([
          { cart_id: cart.id, name: a.option.name, amount: 0, shipping_option_id: a.option.id },
          { cart_id: cart.id, name: b.option.name, amount: 0, shipping_option_id: b.option.id },
        ])
        const payments = container().resolve(Modules.PAYMENT)
        const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: 10 }])
        await container().resolve(ContainerRegistrationKeys.LINK).create({
          [Modules.CART]: { cart_id: cart.id },
          [Modules.PAYMENT]: { payment_collection_id: collection.id },
        })
        await payments.createPaymentSession(collection.id, { provider_id: "pp_stripe_stripe", amount: 10, currency_code: "usd", data: {} })

        const spy = spyOnNotifications()
        const response = await api.post(`/store/carts/${cart.id}/complete`, {}, pak).catch((e: any) => e.response)
        if (response.status !== 200) {
          throw new Error(`expected 200, the route answered ${response.status}: ${JSON.stringify(response.data)}`)
        }
        await drainSubscribers()

        const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
        expect(orders).toHaveLength(2)
        const calls = confirmationCalls(spy)
        expect(calls.map((c) => c.data.order.id).sort()).toEqual(orders.map((o: { id: string }) => o.id).sort())
        for (const call of calls) {
          expect(call).toMatchObject({
            to: customer.email,
            channel: "email",
            template: "order-placed",
            receiver_id: customer.id,
            idempotency_key: `order-confirmation:${call.data.order.id}`,
          })
          // Each seller's order: one $5 item and its own pickup method.
          expect(call.data.order).toMatchObject({ currency_code: "usd", item_subtotal: 5, total: 5 })
          expect(orderSummaryLines(call.data.order).reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(call.data.order.total, 10)
        }
      })
    })
  },
})
