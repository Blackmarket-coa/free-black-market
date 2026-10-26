import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, PaymentEvents } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { DIGITAL_PRODUCT_MODULE } from "../../src/modules/digital-product"
import { ensureListingProduct } from "../../src/lib/blackout-listing-product"
import { CART_COMPLETION_INCOMPLETE_MESSAGE } from "../../src/lib/cart-completion"
import { cardOrderFixtures } from "./helpers/card-orders"
import { checkoutRaceProbes } from "./helpers/checkout-race"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows, stallNextCartCompletion } from "./helpers/stalled-workflows"
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
    // Every subscriber a test's events set off must finish before the
    // runner truncates the database (helpers/drain-subscribers.ts).
    let drainSubscribers: () => Promise<void> = async () => {}

    beforeEach(() => {
      drainSubscribers = trackSubscribers(container)
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

    /**
     * Before the runner's teardown: every subscriber the test's events set off
     * has finished (helpers/drain-subscribers.ts), and no workflow execution is
     * left unfinished (helpers/stalled-workflows.ts); one that is fails this
     * test instead of every later one. The runner declares its own afterEach
     * (wait for executions, then truncate) in the block this suite is written
     * into, before this suite's hooks, and Jest runs one block's afterEach hooks
     * in the order they were declared, so a hook at this level would run after
     * the truncate. Each describe below registers this one instead: an inner
     * block's afterEach runs before an outer block's.
     */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

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

    /**
     * A customer's cart holding the given products at $5.00 each (or `price`),
     * with a Stripe session opened on it — none at all with `noPayment`, as a
     * free order needs none.
     */
    async function makeCart(
      products: Array<{ id: string; variants: Array<{ id: string }> }>,
      opts: { deliver?: boolean; price?: number; noPayment?: boolean } = {}
    ) {
      const price = opts.price ?? 5
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
            unit_price: price,
            requires_shipping: false,
          })),
        },
      ])
      if (opts.deliver) {
        const option = await deliveryOption()
        await carts.addShippingMethods({ cart_id: cart.id, name: "Download", amount: 0, shipping_option_id: option.id })
      }
      if (opts.noPayment) return { cart, customer, collection: null }
      const total = price * products.length
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
        // SD-53: a refused completion's stable code and reason, kept by the engine's serialization.
        refusals: ((run.errors ?? []) as any[]).map((e) => ({
          action: e.action,
          code: e.error?.code ?? null,
          reason: e.error?.reason ?? null,
        })),
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

    /**
     * Every read the paid check makes (its own query, by the order id it was
     * handed), so a scenario can see that a checkout went through it — and
     * when, against the delivery it guards.
     */
    function paidChecks() {
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const graph = query.graph.bind(query)
      const reads = jest.fn()
      jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
        if (q?.entity === "order" && JSON.stringify(q.fields) === '["id","total","payment_collections.payments.id"]') {
          reads(q.filters?.id)
        }
        return graph(q, ...rest)
      })
      return reads
    }

    /** Move a product from one seller to another (or to none), as a seller change after the sale would. */
    async function relinkProduct(productId: string, from: string, to: string | null) {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss({ [SELLER_MODULE]: { seller_id: from }, [Modules.PRODUCT]: { product_id: productId } })
      if (to) await link.create({ [SELLER_MODULE]: { seller_id: to }, [Modules.PRODUCT]: { product_id: productId } })
    }

    const { lockAttempts, sellerChecks } = checkoutRaceProbes(container)

    /**
     * A new payment session on the cart's collection: what the storefront opens
     * when the buyer pays again, and what the store's payment-collection route
     * lets a client open at any time. Medusa deletes the old session first and
     * cancels its intent at Stripe.
     */
    async function newPaymentSession(collectionId: string) {
      const { createPaymentSessionsWorkflow } = require("@medusajs/medusa/core-flows")
      await createPaymentSessionsWorkflow(container()).run({
        input: { payment_collection_id: collectionId, provider_id: "pp_stripe_stripe", data: {} },
      })
    }

    /** Stripe as it is: an intent cancelled since cannot be captured. */
    function stripeRefusesCancelledIntents() {
      const cancelled = new Set<string>()
      stripe.cancelPayment.mockImplementation(async (input: any) => {
        cancelled.add(input?.data?.id)
        return { data: { ...(input?.data ?? {}), status: "canceled" } }
      })
      stripe.capturePayment.mockImplementation(async (input: any) => {
        if (cancelled.has(input?.data?.id)) {
          throw new Error("This PaymentIntent could not be captured because it has a status of canceled.")
        }
        return { data: { ...(input?.data ?? {}), status: "succeeded" } }
      })
    }

    /** Stripe takes its time over the capture, so a second checkout arrives while the first is mid-sale. */
    function slowCapture(ms = 800) {
      stripe.capturePayment.mockImplementation(async (input: any) => {
        await new Promise((r) => setTimeout(r, ms))
        return { data: { ...(input?.data ?? {}), status: "succeeded" } }
      })
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
      afterEach(settleBeforeTeardown)

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
        // The checkout's compensation released the cart's lock: it can be
        // taken at once (held, the attempt would be refused).
        const locking = container().resolve(Modules.LOCKING)
        await locking.acquire(cart.id, { expire: 5 })
        await locking.release(cart.id)
      })

      it("a payment session replaced while the checkout runs does not let the order through uncaptured: the capture is refused, nothing delivered", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer, collection } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        stripeRefusesCancelledIntents()
        // Once the card is authorized (the link step's read of the new order),
        // a second request opens a new payment session on the cart's collection.
        const query = container().resolve(ContainerRegistrationKeys.QUERY)
        const graph = query.graph.bind(query)
        let replaced = false
        jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
          if (!replaced && q?.entity === "order" && JSON.stringify(q.fields) === '["id","seller.id","items.product_id"]') {
            replaced = true
            await newPaymentSession(collection.id)
          }
          return graph(q, ...rest)
        })

        const { errors } = await checkout(cart.id)
        expect(replaced).toBe(true)
        expect(errors.join("\n")).toMatch(/status of canceled/)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(created).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
      })

      it("a product moved to another seller while the card was authorized is refused at the link: rolled back, nothing captured", async () => {
        const a = await makeSeller()
        const b = await makeSeller()
        const product = await makeProduct(a.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        // The seller check passed for A; while Stripe authorizes the card,
        // the product moves to B, so the order cannot go to the seller checked.
        stripe.authorizePayment.mockImplementation(async (input: any) => {
          await relinkProduct(product.id, a.id, b.id)
          return { status: "authorized", data: { ...(input?.data ?? {}), status: "requires_capture" } }
        })

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          expect.stringMatching(
            new RegExp(`^link-digital-product-order-seller: Digital product order order_\\w+ is sold by ${b.id}, not ${a.id} as checked before payment$`)
          ),
        ])
        // The authorization is released and nothing was taken.
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).toHaveBeenCalledTimes(1)
        expect(created).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await liveSellerOrderLinks(a.id)).toEqual([])
        expect(await liveSellerOrderLinks(b.id)).toEqual([])
      })

      it("a failure after the capture leaves no order or seller link, and the capture is refunded when Stripe takes the refund", async () => {
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

    describe("a checkout that failed after the card was authorized, tried again on the same cart, with FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      // The failed run's compensation cancels its payment, and Medusa keeps
      // that payment on the cart's payment collection. A retry pays with a new
      // payment session (createPaymentSessionsWorkflow deletes the old one), as
      // the storefront does when the buyer pays again; the cancelled payment
      // once counted as a second candidate and refused every retry.

      it("after a capture Stripe refused, a retry with a new payment session is linked, captured once, delivered once, and settles", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer, collection } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        stripe.capturePayment.mockImplementationOnce(async () => {
          throw new Error("card_declined")
        })

        const first = await checkout(cart.id)
        expect(first.errors.join("\n")).toMatch(/card_declined/)
        await newPaymentSession(collection.id)
        const second = await checkout(cart.id)
        expect(second.errors).toEqual([])

        const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
        expect(orders.map((o: any) => o.id)).toEqual([second.result.order.id])
        const order = await readOrder(second.result.order.id)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.digital_product_order?.id).toBe(second.result.digital_product_order.id)
        expect(order.fulfillments).toHaveLength(1)
        expect(created).toHaveBeenCalledTimes(1)
        // The first attempt's payment stays cancelled; the new one is captured, once.
        const money = await moneyOf(order.id)
        expect(money).toHaveLength(2)
        expect(money).toEqual(
          expect.arrayContaining([
            { captures: [], refunds: [], canceled: true },
            { captures: [5], refunds: [], canceled: false },
          ])
        )
        expect(stripe.capturePayment).toHaveBeenCalledTimes(2)
        expect(stripe.refundPayment).not.toHaveBeenCalled()

        const paid = order.payment_collections[0].payments.find((p: any) => p.captured_at)
        const { purchase, fee, sellerLeg } = await settled(order.id, paid.id)
        expect(cents(purchase.amount)).toBe(500)
        expect(cents(fee.amount)).toBe(15)
        expect(cents(sellerLeg.amount)).toBe(485)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
      })

      it("after the link step's read failed once, a retry with a new payment session is linked, captured once and delivered once", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer, collection } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        // The link step's read of the new order fails once, as a dropped connection would.
        const query = container().resolve(ContainerRegistrationKeys.QUERY)
        const graph = query.graph.bind(query)
        let failed = false
        const read = jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
          if (!failed && q?.entity === "order" && JSON.stringify(q.fields) === '["id","seller.id","items.product_id"]') {
            failed = true
            throw new Error("transient: connection terminated unexpectedly")
          }
          return graph(q, ...rest)
        })

        const first = await checkout(cart.id)
        read.mockRestore()
        expect(first.errors).toEqual(["link-digital-product-order-seller: transient: connection terminated unexpectedly"])
        await newPaymentSession(collection.id)
        const second = await checkout(cart.id)
        expect(second.errors).toEqual([])

        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        const order = await readOrder(second.result.order.id)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.fulfillments).toHaveLength(1)
        expect(created).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(await moneyOf(order.id)).toEqual(
          expect.arrayContaining([
            { captures: [], refunds: [], canceled: true },
            { captures: [5], refunds: [], canceled: false },
          ])
        )
      })

      it("a retry on the same payment session, whose payment the failed run cancelled, is refused at the capture: nothing delivered or taken", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        stripe.capturePayment.mockImplementationOnce(async () => {
          throw new Error("card_declined")
        })

        const first = await checkout(cart.id)
        expect(first.errors.join("\n")).toMatch(/card_declined/)
        // No new session: Medusa authorizes the session again by handing back
        // the payment it already has, the one the failed run cancelled.
        const second = await checkout(cart.id)
        expect(second.errors).toEqual([
          expect.stringMatching(/^capture-payment-workflow-as-step: The payment: pay_\w+ has been canceled\.$/),
        ])
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(created).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
      })
    })

    describe("a replay — the checkout run again on a cart it already completed — with FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

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

      describe("of an order its first completion left unlinked and uncaptured", () => {
        // What a first completion that stopped straight after
        // completeCartWorkflow leaves (a restart or deploy mid-checkout; also
        // Medusa's own Stripe webhook, open item (g)): an order with its card
        // authorized and no seller link. Run plainly here, as that step does.
        async function unfinishedCompletion(cartId: string) {
          const { completeCartWorkflow } = require("@medusajs/medusa/core-flows")
          const run = await completeCartWorkflow(container()).run({ input: { id: cartId }, throwOnError: false })
          expect(run.errors ?? []).toEqual([])
          const order = await readOrder(run.result.id)
          expect(order.seller ?? null).toBeNull()
          expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
          return run.result.id as string
        }

        it("the retry links it, captures it once, and only then delivers it", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id, { digital: true })
          const { cart } = await makeCart([product], { deliver: true })
          const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
          const orderId = await unfinishedCompletion(cart.id)

          const retry = await checkout(cart.id)
          expect(retry.errors).toEqual([])
          expect(retry.result.order.id).toBe(orderId)
          const order = await readOrder(orderId)
          expect(order.seller?.id).toBe(seller.id)
          expect(await liveSellerOrderLinks(seller.id)).toEqual([{ order_id: orderId }])
          expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
          expect(created).toHaveBeenCalledTimes(1)
          expect(stripe.capturePayment.mock.invocationCallOrder[0]).toBeLessThan(created.mock.invocationCallOrder[0])
          expect(order.digital_product_order?.id).toBe(retry.result.digital_product_order.id)
          expect(order.fulfillments).toHaveLength(1)
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(await moneyOf(orderId)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        })

        it("a capture Stripe refuses fails the retry before anything is delivered, refunds nothing, and leaves the order as it was", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id, { digital: true })
          const { cart } = await makeCart([product], { deliver: true })
          const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
          const orderId = await unfinishedCompletion(cart.id)
          stripe.capturePayment.mockImplementation(async () => {
            throw new Error("card_declined")
          })

          const retry = await checkout(cart.id)
          expect(retry.errors.join("\n")).toMatch(/card_declined/)
          expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
          expect(created).not.toHaveBeenCalled()
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(stripe.cancelPayment).not.toHaveBeenCalled()
          // The order stays, still authorized, and the retry's link is undone with it.
          const order = await readOrder(orderId)
          expect(order.seller ?? null).toBeNull()
          expect(order.fulfillments ?? []).toEqual([])
          expect(await liveSellerOrderLinks(seller.id)).toEqual([])
          expect(await moneyOf(orderId)).toEqual([{ captures: [], refunds: [], canceled: false }])
        })

        it("one whose product has no seller now is neither linked nor captured, and is delivered as without the flag (open item)", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id, { digital: true })
          const { cart } = await makeCart([product], { deliver: true })
          const orderId = await unfinishedCompletion(cart.id)
          await relinkProduct(product.id, seller.id, null)

          const retry = await checkout(cart.id)
          expect(retry.errors).toEqual([])
          expect(stripe.capturePayment).not.toHaveBeenCalled()
          const order = await readOrder(orderId)
          expect(order.seller ?? null).toBeNull()
          expect(await moneyOf(orderId)).toEqual([{ captures: [], refunds: [], canceled: false }])
          expect(order.digital_product_order?.id).toBe(retry.result.digital_product_order.id)
        })
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

    describe("a first completion Medusa's workflow engine leaves unfinished (helpers/stalled-workflows.ts), with FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      it("the checkout acts on no order it was not handed, and a retry delivers nothing for the order left with no payment", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer, collection } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        const stall = stallNextCartCompletion(container)

        const first = await checkout(cart.id)
        expect(stall.stalled()).toBe(true)
        // completeCartWorkflow handed back no order: the shared guard refuses
        // (SD-53, steps/require-completed-cart-order), before the link step
        // could read by an undefined id (which matches some order). The
        // buyer's message names no ids.
        expect(first.errors).toEqual([`require-completed-cart-order: ${CART_COMPLETION_INCOMPLETE_MESSAGE}`])
        expect(first.refusals).toEqual([
          { action: "require-completed-cart-order", code: "cart_completion_incomplete", reason: "no_order_id" },
        ])
        // What the engine left: Medusa's completion unfinished (its
        // compensation never ends), the order and the cart's completion
        // written, and no payment.
        expect((await clearStalledWorkflows(container, 1000)).map((w) => w.workflow_id)).toEqual(["complete-cart"])
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        expect((await container().resolve(Modules.CART).retrieveCart(cart.id)).completed_at).toBeTruthy()
        expect(await container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collection.id })).toEqual([])

        // A retry finds that order as a replay, which skips the completion
        // and the step after it; the paid check refuses it with the same
        // code and message (SD-53).
        const retry = await checkout(cart.id)
        expect(retry.errors).toEqual([`digital-product-order-paid: ${CART_COMPLETION_INCOMPLETE_MESSAGE}`])
        expect(retry.refusals).toEqual([
          { action: "digital-product-order-paid", code: "cart_completion_incomplete", reason: "order_unpaid" },
        ])
        expect(created).not.toHaveBeenCalled()
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
      })

      it("over the store route, the stalled checkout and its retry are answered 409 cart_completion_incomplete with the buyer's message and no ids; nothing delivered", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer, collection } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        const stall = stallNextCartCompletion(container)

        const first = await api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expect(stall.stalled()).toBe(true)
        expect(first.status).toBe(409)
        expect(first.data).toEqual({
          code: "cart_completion_incomplete",
          type: "cart_completion_incomplete",
          message: CART_COMPLETION_INCOMPLETE_MESSAGE,
          reason: "no_order_id",
        })
        expect((await clearStalledWorkflows(container, 1000)).map((w) => w.workflow_id)).toEqual(["complete-cart"])
        const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
        expect(orders).toHaveLength(1)

        const retry = await api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expect(retry.status).toBe(409)
        expect(retry.data).toEqual({
          code: "cart_completion_incomplete",
          type: "cart_completion_incomplete",
          message: CART_COMPLETION_INCOMPLETE_MESSAGE,
          reason: "order_unpaid",
        })
        for (const body of [first.data, retry.data]) {
          expect(JSON.stringify(body)).not.toContain(cart.id)
          expect(JSON.stringify(body)).not.toContain(orders[0].id)
        }
        expect(created).not.toHaveBeenCalled()
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collection.id })).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
      })
    })

    describe("a first completion Medusa's workflow engine leaves unfinished, with FF_DIGITAL_ORDER_SETTLEMENT_V1 off (SD-53 (c))", () => {
      afterEach(settleBeforeTeardown)

      // Before SD-53 (c) the paid check was dark with the flag: the stalled
      // checkout failed at its own order read, and a retry, running
      // completeCartWorkflow again, got the cart's order back and delivered
      // it with no payment (seen on a real database). The seller and capture
      // steps still read nothing with the flag off.

      it.each([
        ["both flags off", {}],
        ["FF_CONSUMER_SUBSCRIPTIONS_V1 on", { [SUBS]: "true" }],
      ] as Array<[string, Record<string, string>]>)(
        "%s: the stalled checkout delivers nothing, and its retry is refused for the order left with no payment",
        async (_flags, env) => {
          delete process.env[DIGITAL]
          Object.assign(process.env, env)
          const seller = await makeSeller()
          const product = await makeProduct(seller.id, { digital: true })
          const { cart, customer, collection } = await makeCart([product], { deliver: true })
          const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
          // Opening the cart's payment session called Stripe; nothing after it may.
          for (const call of Object.values(stripe)) call.mockClear()
          const stall = stallNextCartCompletion(container)

          const first = await checkout(cart.id)
          expect(stall.stalled()).toBe(true)
          // completeCartWorkflow handed back no order. The shared guard
          // refuses whatever the flags say (SD-53), before the checkout's own
          // order read could run on an undefined id; the paid check behind it
          // (SD-53 (c)) stays the last word before delivery.
          expect(first.errors).toEqual([`require-completed-cart-order: ${CART_COMPLETION_INCOMPLETE_MESSAGE}`])
          expect(first.refusals).toEqual([
            { action: "require-completed-cart-order", code: "cart_completion_incomplete", reason: "no_order_id" },
          ])
          expect((await clearStalledWorkflows(container, 1000)).map((w) => w.workflow_id)).toEqual(["complete-cart"])
          const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
          expect(orders).toHaveLength(1)
          expect((await container().resolve(Modules.CART).retrieveCart(cart.id)).completed_at).toBeTruthy()
          expect(await container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collection.id })).toEqual([])

          // The retry gets that order back from completeCartWorkflow, which
          // authorizes nothing on a completed cart, and is refused.
          const retry = await checkout(cart.id)
          expect(retry.errors).toEqual([`require-completed-cart-order: ${CART_COMPLETION_INCOMPLETE_MESSAGE}`])
          expect(retry.refusals).toEqual([
            { action: "require-completed-cart-order", code: "cart_completion_incomplete", reason: "order_unpaid" },
          ])
          expect(created).not.toHaveBeenCalled()
          const order = await readOrder(orders[0].id)
          expect(order.digital_product_order ?? null).toBeNull()
          expect(order.fulfillments ?? []).toEqual([])
          expect(await liveSellerOrderLinks(seller.id)).toEqual([])
          expect(await container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collection.id })).toEqual([])
          for (const [name, call] of Object.entries(stripe)) {
            expect([name, call.mock.calls.length]).toEqual([name, 0])
          }
        }
      )
    })

    describe("two checkouts of one cart at the same time (a double submit), with FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      // This checkout has held the cart's lock from its first step to its
      // last since before SD-48 (completeCartWorkflow, nested, skips its own),
      // so the second waits, then finds the first's order and returns it as
      // a replay.

      it("the second waits for the first, then returns its order as a replay: one order, one capture, nothing refunded, one digital product order", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        slowCapture()
        const lock = lockAttempts(cart.id)
        const checks = sellerChecks(cart.id)

        const [x, y] = await Promise.all([checkout(cart.id), checkout(cart.id)])
        expect([x.errors, y.errors]).toEqual([[], []])
        expect(y.result.order.id).toBe(x.result.order.id)
        // One run was refused the lock while the other held it, each took it
        // once, and only the first checked the seller: the second replayed.
        expect(lock.refused).toBeGreaterThan(0)
        expect(lock.taken).toBe(2)
        expect(checks.count).toBe(1)

        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(created).toHaveBeenCalledTimes(1)
        const order = await readOrder(x.result.order.id)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.fulfillments).toHaveLength(1)
        expect(await moneyOf(order.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([{ order_id: order.id }])
      })

      it("over the store route, two POSTs at once answer 200 with the same order, captured once", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        slowCapture()
        const post = () => api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)

        const [a, b] = await Promise.all([post(), post()])
        expect([a.status, b.status]).toEqual([200, 200])
        expect(b.data.order.id).toBe(a.data.order.id)
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(created).toHaveBeenCalledTimes(1)
        expect(await moneyOf(a.data.order.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
      })

      it("a second checkout kept waiting past the lock's 30 seconds fails before any money step, and refunds nothing", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart, customer } = await makeCart([product], { deliver: true })
        // A first checkout still running holds the cart's lock.
        const locking = container().resolve(Modules.LOCKING)
        await locking.acquire(cart.id, { expire: 120 })
        try {
          const started = Date.now()
          const { errors } = await checkout(cart.id)
          expect(Date.now() - started).toBeGreaterThanOrEqual(29_000)
          expect(errors).toEqual([expect.stringMatching(/^acquire-lock-step: Failed to acquire lock for key "cart_/)])
          expect(stripe.authorizePayment).not.toHaveBeenCalled()
          expect(stripe.capturePayment).not.toHaveBeenCalled()
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(stripe.cancelPayment).not.toHaveBeenCalled()
          expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
          // The checkout that gave up did not free the lock it never held.
          await expect(locking.acquire(cart.id, { expire: 5 })).rejects.toThrow(/Failed to acquire lock/)
        } finally {
          await locking.release(cart.id)
        }
        // Once the first is done, the cart checks out as usual.
        const retry = await checkout(cart.id)
        expect(retry.errors).toEqual([])
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
      })
    })

    describe("a Blackout listing's shadow product and its seller link (ensureListingProduct)", () => {
      afterEach(settleBeforeTeardown)

      /** The sellers a product is linked to, read from the link table itself. */
      async function liveProductSellers(productId: string) {
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const { rows: table } = await pg.raw(
          `SELECT table_name FROM information_schema.tables WHERE table_name = 'seller_seller_product_product'`
        )
        expect(table).toHaveLength(1)
        const { rows } = await pg.raw(
          `SELECT seller_id FROM seller_seller_product_product WHERE product_id = ? AND deleted_at IS NULL`,
          [productId]
        )
        return (rows as Array<{ seller_id: string }>).map((r) => r.seller_id)
      }

      it("a product that lost its seller link gets it back at the next render; a repeat changes nothing; another seller's product is left alone", async () => {
        const a = await makeSeller()
        const b = await makeSeller()
        const orphan = await makeProduct(null, { digital: false })
        const listing = {
          id: `clist_${uid()}`,
          seller_id: a.id,
          title: "Signal",
          price_cents: 500,
          currency: "usd",
          product_id: orphan.id,
          variant_id: orphan.variants[0].id,
        }
        const link = container().resolve(ContainerRegistrationKeys.LINK)
        const pair = (sellerId: string, productId: string) => ({
          [SELLER_MODULE]: { seller_id: sellerId },
          [Modules.PRODUCT]: { product_id: productId },
        })

        // A listing that already carries its ids still has its product linked.
        await expect(ensureListingProduct(container(), listing)).resolves.toMatchObject({ product_id: orphan.id, created: false })
        expect(await liveProductSellers(orphan.id)).toEqual([a.id])

        // Repeating is harmless: the link module takes the same pair again
        // without complaint, and there is still one link.
        await expect(link.create(pair(a.id, orphan.id))).resolves.toBeDefined()
        await ensureListingProduct(container(), listing)
        expect(await liveProductSellers(orphan.id)).toEqual([a.id])

        // A link dismissed since is restored.
        await link.dismiss(pair(a.id, orphan.id))
        expect(await liveProductSellers(orphan.id)).toEqual([])
        await ensureListingProduct(container(), listing)
        expect(await liveProductSellers(orphan.id)).toEqual([a.id])

        // Another seller's product is never taken from them: the module refuses
        // a second seller, and the render goes on.
        const theirs = await makeProduct(b.id, { digital: false })
        await expect(link.create(pair(a.id, theirs.id))).rejects.toThrow(/Cannot create multiple links/)
        await expect(
          ensureListingProduct(container(), { ...listing, product_id: theirs.id, variant_id: theirs.variants[0].id })
        ).resolves.toMatchObject({ product_id: theirs.id })
        expect(await liveProductSellers(theirs.id)).toEqual([b.id])

        // The repaired product checks out to the listing's seller.
        const { cart } = await makeCart([orphan])
        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect((await readOrder(result.order.id)).seller?.id).toBe(a.id)
      })
    })

    describe("flag off", () => {
      afterEach(settleBeforeTeardown)

      // As before, but for the paid check, which runs whatever the flag says
      // (SD-53 (c)): each scenario below also reads that the checkout went
      // through it before anything was delivered, and was let through.

      it("as before — no seller link, the payment only authorized, nothing settles — even with FF_CONSUMER_SUBSCRIPTIONS_V1 on", async () => {
        delete process.env[DIGITAL]
        process.env[SUBS] = "true"
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })
        const created = jest.spyOn(container().resolve(DIGITAL_PRODUCT_MODULE), "createDigitalProductOrders")
        const paid = paidChecks()

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect(Object.keys(result).sort()).toEqual(["digital_product_order", "order"])
        const orderId = result.order.id as string
        expect(paid.mock.calls).toEqual([[orderId]])
        expect(created).toHaveBeenCalledTimes(1)
        expect(paid.mock.invocationCallOrder[0]).toBeLessThan(created.mock.invocationCallOrder[0])
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
        const paid = paidChecks()

        const first = await checkout(cart.id)
        const second = await checkout(cart.id)
        expect([first.errors, second.errors]).toEqual([[], []])
        expect(second.result.order.id).toBe(first.result.order.id)
        // Both runs went through the paid check; the order's payment let both through.
        expect(paid.mock.calls).toEqual([[first.result.order.id], [first.result.order.id]])
        expect(created).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        const order = await readOrder(first.result.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
      })

      it("as before — over the store route, a checkout answers 200 with its order and digital product order, the payment only authorized", async () => {
        delete process.env[DIGITAL]
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true })
        const paid = paidChecks()

        const response = await api.post(`/store/carts/${cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expect(response.status).toBe(200)
        expect(response.data.digital_product_order?.id).toBeTruthy()
        expect(paid.mock.calls).toEqual([[response.data.order.id]])
        const order = await readOrder(response.data.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.fulfillments).toHaveLength(1)
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
      })

      it("a free digital product — nothing owed, so no payment at all — is still delivered", async () => {
        delete process.env[DIGITAL]
        const seller = await makeSeller()
        const product = await makeProduct(seller.id, { digital: true })
        const { cart } = await makeCart([product], { deliver: true, price: 0, noPayment: true })
        const paid = paidChecks()

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect(paid.mock.calls).toEqual([[result.order.id]])
        expect(result.digital_product_order?.id).toBeTruthy()
        const order = await readOrder(result.order.id)
        expect(order.digital_product_order?.id).toBe(result.digital_product_order.id)
        expect(order.fulfillments).toHaveLength(1)
        // Medusa completes a cart that owes nothing without any payment.
        expect(order.payment_collections ?? []).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
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
