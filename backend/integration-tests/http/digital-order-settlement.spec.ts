import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, PaymentEvents } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { DIGITAL_PRODUCT_MODULE } from "../../src/modules/digital-product"
import { cardOrderFixtures } from "./helpers/card-orders"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * SD-48 (the digital half of SD-46 / F5) on a real migrated database: the
 * real `create-digital-product-order` workflow — Medusa's
 * `completeCartWorkflow`, the real payment, order, product, seller,
 * digital-product, fulfillment and link modules, the real ledger. Only Stripe
 * is replaced: the FBM Stripe provider instance's calls are stubbed on the
 * registered provider itself, so the payment module, its sessions, payments
 * and captures are all real.
 *
 * Two cart shapes, both live callers of the workflow:
 *   - a Blackout one-off listing: its shadow product (`ensureListingProduct`)
 *     linked to the listing's seller, no digital product, nothing to ship;
 *   - the digital-product module's own product, which the workflow turns into
 *     a digital product order and a fulfillment — that needs a shipping
 *     method on a shipping option with a stock location (without one,
 *     `createOrderFulfillmentWorkflow` fails, flag or no flag).
 *
 * The workflow is required after the app has booted, never imported at the
 * top: a link's `entryPoint` (read when the workflow is composed) is
 * undefined until the app has registered its links.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1
const DIGITAL = PHASE0_FEATURE_FLAGS.DIGITAL_ORDER_SETTLEMENT_V1
const SUBS = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const { container, cents, uid, makeSeller, legs, sellerEarnings, clearing, placed, captured, refunded } =
      cardOrderFixtures(getContainer)

    type Stripe = {
      initiatePayment: jest.SpyInstance
      authorizePayment: jest.SpyInstance
      capturePayment: jest.SpyInstance
      refundPayment: jest.SpyInstance
      cancelPayment: jest.SpyInstance
    }
    let stripe: Stripe

    beforeEach(() => {
      const provider = container().resolve(Modules.PAYMENT).paymentProviderService_.retrieveProvider("pp_stripe_stripe")
      let n = 0
      stripe = {
        initiatePayment: jest.spyOn(provider, "initiatePayment").mockImplementation(async () => {
          const id = `pi_test_${uid()}${++n}`
          return { id, data: { id, status: "requires_payment_method" } }
        }),
        authorizePayment: jest.spyOn(provider, "authorizePayment").mockImplementation(async (input: any) => ({
          status: "authorized",
          data: { ...(input?.data ?? {}), status: "requires_capture" },
        })),
        capturePayment: jest.spyOn(provider, "capturePayment").mockImplementation(async (input: any) => ({
          data: { ...(input?.data ?? {}), status: "succeeded" },
        })),
        refundPayment: jest.spyOn(provider, "refundPayment").mockImplementation(async (input: any) => ({
          data: { ...(input?.data ?? {}) },
        })),
        cancelPayment: jest.spyOn(provider, "cancelPayment").mockImplementation(async (input: any) => ({
          data: { ...(input?.data ?? {}), status: "canceled" },
        })),
      }
      process.env[CARD] = "true"
      process.env[DIGITAL] = "true"
    })

    /**
     * Every capture-payment workflow run emits `payment.captured` (the payment
     * module's own capture at authorization does not), so counting the event
     * for a payment counts the captures this checkout ran. Medusa makes a
     * second capture of a captured payment a no-op at the provider and in the
     * order's transactions, so this is how a needless one is seen at all.
     */
    function captureEvents() {
      const bus = container().resolve(Modules.EVENT_BUS)
      const emit = bus.emit.bind(bus)
      const seen: string[] = []
      jest.spyOn(bus, "emit").mockImplementation(async (data: any, options?: any) => {
        for (const e of Array.isArray(data) ? data : [data]) {
          if ((e?.name ?? e?.eventName) === PaymentEvents.CAPTURED) seen.push(e?.data?.id)
        }
        return emit(data, options)
      })
      return seen
    }
    afterEach(() => {
      jest.restoreAllMocks()
      delete process.env[CARD]
      delete process.env[DIGITAL]
      delete process.env[SUBS]
    })

    let channel: { id: string } | null = null
    beforeEach(() => {
      channel = null
    })
    async function salesChannel() {
      if (!channel) {
        ;[channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${uid()}` }])
      }
      return channel as { id: string }
    }

    /**
     * A published product with one variant, linked to `sellerId` (none when
     * null — an admin-created digital product gets no seller link) and, when
     * `digital`, to a digital product of the digital-product module.
     */
    async function makeProduct(sellerId: string | null, opts: { digital: boolean }) {
      const id = uid()
      const [product] = await container().resolve(Modules.PRODUCT).createProducts([
        {
          title: `Download ${id}`,
          handle: `download-${id}`,
          status: "published",
          options: [{ title: "Format", values: ["PDF"] }],
          variants: [{ title: "PDF", manage_inventory: false, options: { Format: "PDF" } }],
        },
      ])
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      if (sellerId) {
        await link.create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      }
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: (await salesChannel()).id },
      })
      if (opts.digital) {
        const digital = await container().resolve(DIGITAL_PRODUCT_MODULE).createDigitalProducts({ name: `Ebook ${id}` })
        await link.create({
          [DIGITAL_PRODUCT_MODULE]: { digital_product_id: digital.id },
          [Modules.PRODUCT]: { product_variant_id: product.variants[0].id },
        })
      }
      return product
    }

    /** A shipping option whose service zone's fulfillment set has a stock location: what a digital order's fulfillment needs. */
    async function deliveryOption() {
      const id = uid()
      const fulfillment = container().resolve(Modules.FULFILLMENT)
      const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: `Warehouse ${id}` }])
      const set = await fulfillment.createFulfillmentSets({
        name: `Digital ${id}`,
        type: "shipping",
        service_zones: [{ name: `US ${id}`, geo_zones: [{ type: "country", country_code: "us" }] }],
      })
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      })
      const profile = await fulfillment.createShippingProfiles({ name: `Digital ${id}`, type: "digital" })
      return fulfillment.createShippingOptions({
        name: `Download ${id}`,
        service_zone_id: set.service_zones[0].id,
        shipping_profile_id: profile.id,
        provider_id: "manual_manual",
        price_type: "flat",
        type: { label: "Download", description: "Digital delivery", code: `download-${id}` },
        rules: [],
      } as any)
    }

    /** A customer's cart holding the given products at $5.00 each, with a Stripe session opened on it. */
    async function makeCart(products: Array<{ id: string; variants: Array<{ id: string }> }>, opts: { deliver?: boolean } = {}) {
      const id = uid()
      const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${id}@example.com` }])
      const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
      const carts = container().resolve(Modules.CART)
      const [cart] = await carts.createCarts([
        {
          currency_code: "usd",
          region_id: region.id,
          sales_channel_id: (await salesChannel()).id,
          customer_id: customer.id,
          email: customer.email,
          items: products.map((p) => ({
            title: "Download",
            product_id: p.id,
            variant_id: p.variants[0].id,
            quantity: 1,
            unit_price: 5,
            requires_shipping: false,
          })),
        },
      ])
      if (opts.deliver) {
        const option = await deliveryOption()
        await carts.addShippingMethods({ cart_id: cart.id, name: "Download", amount: 0, shipping_option_id: option.id })
      }
      const total = 5 * products.length
      const payments = container().resolve(Modules.PAYMENT)
      const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: total }])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.CART]: { cart_id: cart.id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      })
      await payments.createPaymentSession(collection.id, {
        provider_id: "pp_stripe_stripe",
        amount: total,
        currency_code: "usd",
        data: {},
      })
      return { cart, customer, collection }
    }

    const createDigitalProductOrderWorkflow = (c: any) =>
      require("../../src/workflows/create-digital-product-order").default(c)
    /** Run the checkout, returning its result and errors rather than throwing. */
    async function checkout(cartId: string) {
      const run = await createDigitalProductOrderWorkflow(container()).run({
        input: { cart_id: cartId },
        throwOnError: false,
      })
      return {
        result: run.result as any,
        errors: ((run.errors ?? []) as any[]).map((e) => `${e.action}: ${e.error?.message}`),
      }
    }

    async function readOrder(orderId: string) {
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "seller.id",
          "digital_product_order.id",
          "fulfillments.id",
          "payment_collections.id",
          "payment_collections.captured_amount",
          "payment_collections.payments.id",
          "payment_collections.payments.captured_at",
        ],
        filters: { id: orderId },
      })
      return data[0] as any
    }

    /** Live rows linking this seller to any order, read from the link table itself. */
    async function liveSellerOrderLinks(sellerId: string) {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const { rows: table } = await pg.raw(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'seller_seller_order_order'`
      )
      expect(table).toHaveLength(1)
      const { rows } = await pg.raw(
        `SELECT order_id FROM seller_seller_order_order WHERE seller_id = ? AND deleted_at IS NULL`,
        [sellerId]
      )
      return rows as Array<{ order_id: string }>
    }

    /** What the order.placed and payment.captured subscribers do, then the order's ledger legs. */
    async function settled(orderId: string, paymentId: string) {
      await placed(orderId)
      await captured(paymentId)
      const rows = await legs(orderId)
      return {
        purchase: rows.find((e) => e.entry_type === "PURCHASE"),
        fee: rows.find((e) => e.entry_type === "COMMISSION"),
        sellerLeg: rows.find((e) => e.entry_type === "TRANSFER"),
      }
    }

    /** The order's payments as the payment module records them: what was captured, refunded or cancelled. */
    async function moneyOf(orderId: string) {
      const order = await readOrder(orderId)
      const payments = await container().resolve(Modules.PAYMENT).listPayments(
        { payment_collection_id: order.payment_collections.map((c: any) => c.id) },
        { relations: ["captures", "refunds"] }
      )
      return payments.map((p: any) => ({
        captures: (p.captures ?? []).map((c: any) => Number(c.amount)),
        refunds: (p.refunds ?? []).map((r: any) => Number(r.amount)),
        canceled: !!p.canceled_at,
      }))
    }

    /** Move a product from one seller to another (or to none), as a seller change after the sale would. */
    async function relinkProduct(productId: string, from: string, to: string | null) {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss({ [SELLER_MODULE]: { seller_id: from }, [Modules.PRODUCT]: { product_id: productId } })
      if (to) await link.create({ [SELLER_MODULE]: { seller_id: to }, [Modules.PRODUCT]: { product_id: productId } })
    }

    /**
     * Make the next read of the checkout's own order (the workflow's
     * `useQueryGraphStep`, the first step after the cart's order is known)
     * fail once, as a dropped connection would.
     */
    function failNextOrderRead() {
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const graph = query.graph.bind(query)
      let failed = false
      return jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
        if (!failed && q?.entity === "order" && (q.fields ?? []).includes("items.variant.digital_product.*")) {
          failed = true
          throw new Error("transient: connection terminated unexpectedly")
        }
        return graph(q, ...rest)
      })
    }

    describe("a digital-product checkout, with FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
      it("a Blackout one-off listing's order is linked to its seller, captured, and settles to that seller less the 3%", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: false })
        const { cart } = await makeCart([product])
        const captures = captureEvents()

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const orderId = result.order.id as string

        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        const payment = order.payment_collections[0].payments[0]
        expect(payment.captured_at).toBeTruthy()
        expect(Number(order.payment_collections[0].captured_amount)).toBe(5)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(captures).toEqual([payment.id])

        const { purchase, fee, sellerLeg } = await settled(orderId, payment.id)
        expect(cents(purchase.amount)).toBe(500)
        expect(purchase.debit_account_id).toBe((await clearing()).id)
        expect(cents(fee.amount)).toBe(15)
        expect(cents(sellerLeg.amount)).toBe(485)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
      })

      it("a digital product's order is captured before its digital product order exists, linked, fulfilled, and settles", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })
        const digital = container().resolve(DIGITAL_PRODUCT_MODULE)
        const created = jest.spyOn(digital, "createDigitalProductOrders")

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect(result.digital_product_order?.id).toBeTruthy()
        const orderId = result.order.id as string

        // The card was captured before the digital product order was created.
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(created).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment.mock.invocationCallOrder[0]).toBeLessThan(created.mock.invocationCallOrder[0])

        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.digital_product_order?.id).toBe(result.digital_product_order.id)
        expect(order.fulfillments).toHaveLength(1)
        const payment = order.payment_collections[0].payments[0]
        expect(payment.captured_at).toBeTruthy()

        const { purchase, fee, sellerLeg } = await settled(orderId, payment.id)
        expect(cents(purchase.amount)).toBe(500)
        expect(cents(fee.amount) + cents(sellerLeg.amount)).toBe(500)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
      })

      it("a payment Stripe already captured at authorization is not captured again, and still settles", async () => {
        // An intent created with `capture_method: automatic` (session data a
        // store client can set) is `succeeded` once confirmed; the payment
        // module records that capture itself.
        stripe.authorizePayment.mockImplementation(async (input: any) => ({
          status: "captured",
          data: { ...(input?.data ?? {}), status: "succeeded" },
        }))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: false })
        const { cart } = await makeCart([product])
        const captures = captureEvents()

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        // No capture workflow ran at all: the payment was already captured.
        expect(captures).toEqual([])
        const order = await readOrder(result.order.id)
        expect(order.seller?.id).toBe(seller.id)
        expect(Number(order.payment_collections[0].captured_amount)).toBe(5)

        const { purchase, sellerLeg } = await settled(result.order.id, order.payment_collections[0].payments[0].id)
        expect(cents(purchase.amount)).toBe(500)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
      })

      it("a cart whose products belong to two sellers is refused before the card is touched", async () => {
        const a = await makeProduct((await makeSeller()).id, { digital: false })
        const b = await makeProduct((await makeSeller()).id, { digital: false })
        const { cart, customer } = await makeCart([a, b])

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          "resolve-digital-product-seller: A digital product order is sold by one seller, and this cart cannot be: its products belong to 2 sellers.",
        ])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
      })

      it("a product with no seller (an admin-created digital product) is refused before the card is touched", async () => {
        const product = await makeProduct(null, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          "resolve-digital-product-seller: A digital product order is sold by one seller, and this cart cannot be: a product has no seller.",
        ])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
      })

      it("a capture Stripe refuses fails the checkout: no order, no seller link, no digital product order left behind", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        stripe.capturePayment.mockImplementation(async () => {
          throw new Error("card_declined")
        })

        const { errors } = await checkout(cart.id)
        expect(errors.join("\n")).toMatch(/card_declined/)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        // The authorization is released, and nothing was refunded: no money moved.
        expect(stripe.cancelPayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(created).not.toHaveBeenCalled()
        // completeCartWorkflow's own compensation deletes the order outright,
        // so the query graph can no longer show its links: read the link
        // table itself. Nothing may still link this seller to an order.
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
      })

      it("a failure after the capture refunds it, and leaves no order or seller link", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders").mockImplementation(async () => {
          throw new Error("digital product store down")
        })

        const { errors } = await checkout(cart.id)
        expect(errors.join("\n")).toMatch(/digital product store down/)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).toHaveBeenCalledTimes(1)
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
      })

      it("the store route refuses a two-seller cart with 400, before the card is touched", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const a = await makeProduct((await makeSeller()).id, { digital: false })
        const b = await makeProduct((await makeSeller()).id, { digital: false })
        const { cart, customer } = await makeCart([a, b])

        const response = await api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expect(response.status).toBe(400)
        expect(response.data.message).toMatch(/^A digital product order is sold by one seller/)
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
      })
    })

    describe("a replay — the checkout run again on a cart it already completed — with FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
      // completeCartWorkflow creates nothing on a completed cart but still
      // registers a compensation that refunds a captured payment, so a replay
      // must keep out of it: the order is returned as its first completion
      // left it, and nothing is linked, captured, refused or refunded.

      it("returns the same order: captured once, nothing refunded, one digital product order", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        const captures = captureEvents()

        const first = await checkout(cart.id)
        expect(first.errors).toEqual([])
        const orderId = first.result.order.id as string
        const second = await checkout(cart.id)
        expect(second.errors).toEqual([])
        expect(second.result.order.id).toBe(orderId)

        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(created).toHaveBeenCalledTimes(1)
        const order = await readOrder(orderId)
        expect(captures).toEqual([order.payment_collections[0].payments[0].id])
        expect(order.seller?.id).toBe(seller.id)
        expect(order.fulfillments).toHaveLength(1)
        expect(await moneyOf(orderId)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([{ order_id: orderId }])
      })

      it("after the product moved to another seller: returns the order and refunds nothing, and the ledger keeps the sale", async () => {
        const a = await makeSeller()
        const b = await makeSeller()
        const product = await makeProduct(a.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })

        const first = await checkout(cart.id)
        expect(first.errors).toEqual([])
        const orderId = first.result.order.id as string
        const paymentId = (await readOrder(orderId)).payment_collections[0].payments[0].id as string
        await settled(orderId, paymentId)
        const before = (await legs(orderId)).map((e) => [e.entry_type, cents(e.amount), e.status])

        await relinkProduct(product.id, a.id, b.id)
        const second = await checkout(cart.id)
        expect(second.errors).toEqual([])
        expect(second.result.order.id).toBe(orderId)

        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(await moneyOf(orderId)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(a.id)
        expect(order.digital_product_order?.id).toBe(first.result.digital_product_order.id)
        expect(order.fulfillments).toHaveLength(1)
        // What the refund subscriber would do: there is nothing to reverse.
        await refunded(paymentId)
        expect((await legs(orderId)).map((e) => [e.entry_type, cents(e.amount), e.status])).toEqual(before)
      })

      it("after the product lost its seller: returns the order instead of refusing the retry", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: false })
        const { cart } = await makeCart([product])

        const first = await checkout(cart.id)
        expect(first.errors).toEqual([])
        await relinkProduct(product.id, seller.id, null)

        const second = await checkout(cart.id)
        expect(second.errors).toEqual([])
        expect(second.result.order.id).toBe(first.result.order.id)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect((await readOrder(first.result.order.id)).seller?.id).toBe(seller.id)
      })

      it("a replay that fails after the order is found refunds nothing, and leaves the order as it was", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })
        const first = await checkout(cart.id)
        expect(first.errors).toEqual([])
        const orderId = first.result.order.id as string

        const read = failNextOrderRead()
        const second = await checkout(cart.id)
        read.mockRestore()
        expect(second.errors.join("\n")).toMatch(/transient: connection terminated unexpectedly/)

        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await moneyOf(orderId)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.digital_product_order?.id).toBe(first.result.digital_product_order.id)
        expect(order.fulfillments).toHaveLength(1)
        expect(await liveSellerOrderLinks(seller.id)).toEqual([{ order_id: orderId }])
      })

      it("over the store route, a retried POST after the product moved seller answers 200 with the same order and refunds nothing", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const a = await makeSeller()
        const b = await makeSeller()
        const product = await makeProduct(a.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })

        const first = await api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expect(first.status).toBe(200)
        const orderId = first.data.order.id as string

        await relinkProduct(product.id, a.id, b.id)
        const second = await api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expect(second.status).toBe(200)
        expect(second.data.order.id).toBe(orderId)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(await moneyOf(orderId)).toEqual([{ captures: [5], refunds: [], canceled: false }])
      })
    })

    describe("flag off", () => {
      it("as before — no seller link, the payment only authorized, nothing settles — even with FF_CONSUMER_SUBSCRIPTIONS_V1 on", async () => {
        delete process.env[DIGITAL]
        process.env[SUBS] = "true"
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect(Object.keys(result).sort()).toEqual(["digital_product_order", "order"])
        const orderId = result.order.id as string
        const order = await readOrder(orderId)
        expect(order.seller ?? null).toBeNull()
        expect(order.digital_product_order?.id).toBe(result.digital_product_order.id)
        expect(order.fulfillments).toHaveLength(1)
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        await placed(orderId)
        expect(await legs(orderId)).toEqual([])
      })

      it("as before — a replay returns the same order, still unlinked and uncaptured", async () => {
        delete process.env[DIGITAL]
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")

        const first = await checkout(cart.id)
        const second = await checkout(cart.id)
        expect([first.errors, second.errors]).toEqual([[], []])
        expect(second.result.order.id).toBe(first.result.order.id)
        expect(created).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        const order = await readOrder(first.result.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
      })

      it("as before — a two-seller cart still completes into one unlinked, uncaptured order", async () => {
        delete process.env[DIGITAL]
        const a = await makeProduct((await makeSeller()).id, { digital: false })
        const b = await makeProduct((await makeSeller()).id, { digital: false })
        const { cart } = await makeCart([a, b])

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const order = await readOrder(result.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
      })
    })
  },
})
