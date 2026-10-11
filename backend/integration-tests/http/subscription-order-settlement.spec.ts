import "./helpers/renewal-live-env"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { SUBSCRIPTION_MODULE } from "../../src/modules/subscription"
import { cardOrderFixtures } from "./helpers/card-orders"
import { checkoutRaceProbes } from "./helpers/checkout-race"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { createPublishableKeyToken } from "./_publishable-key"
import { syncCardChargeFromStripe, type ChargeLedgerState } from "../../src/lib/card-stripe-sync"
import { readCardSettlementOrder } from "../../src/lib/card-order-settlement"
import { reconcileCardOrder } from "../../src/lib/card-order-reconcile"
import { addInterval } from "../../src/modules/subscription/utils/interval"
import { buildRenewalRecord, RENEWAL_RECORD_METADATA_KEY } from "../../src/workflows/subscription/renew-helpers"

jest.setTimeout(240 * 1000)

/**
 * F5 / SD-46 on a real migrated database: the real `createSubscriptionWorkflow`
 * — Medusa's `completeCartWorkflow`, the real payment, order, product, seller
 * and link modules, the real ledger. Only Stripe is replaced: the FBM Stripe
 * provider instance's calls are stubbed on the registered provider itself, so
 * the payment module, its sessions, payments and captures are all real.
 *
 * The workflow is required after the app has booted, never imported at the
 * top: a workflow is composed when its file is first loaded, and a link's
 * `entryPoint` (read by `create-subscription.ts` at composition) is undefined
 * until the app has registered its links — imported first, the composed
 * graph queries entity `undefined`. Production loads links before workflows.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1
const SUBS = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const { container, cents, uid, makeSeller, makeOrder, legs, sellerEarnings, clearing, placed, captured } =
      cardOrderFixtures(getContainer)

    afterAll(() => {
      delete process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
    })

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
      process.env[SUBS] = "true"
    })
    afterEach(async () => {
      await drainSubscribers()
      jest.restoreAllMocks()
      delete process.env[CARD]
      delete process.env[SUBS]
    })

    async function makeProduct(sellerId: string) {
      const products = container().resolve(Modules.PRODUCT)
      const id = uid()
      const [product] = await products.createProducts([
        {
          title: `Vault seat ${id}`,
          handle: `vault-seat-${id}`,
          status: "published",
          options: [{ title: "Plan", values: ["Monthly"] }],
          variants: [{ title: "Monthly", manage_inventory: false, options: { Plan: "Monthly" } }],
        },
      ])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [SELLER_MODULE]: { seller_id: sellerId },
        [Modules.PRODUCT]: { product_id: product.id },
      })
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: (await salesChannel()).id },
      })
      return product
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
     * A customer's cart holding the given products at $5.00, with a Stripe
     * session opened on it. The customer is a new one unless given.
     */
    async function makeCart(
      products: Array<{ id: string; variants: Array<{ id: string }> }>,
      price = 5,
      buyer?: { id: string; email: string }
    ) {
      const id = uid()
      const customer =
        buyer ?? (await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${id}@example.com` }]))[0]
      const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
      const [cart] = await container().resolve(Modules.CART).createCarts([
        {
          currency_code: "usd",
          region_id: region.id,
          sales_channel_id: (await salesChannel()).id,
          customer_id: customer.id,
          email: customer.email,
          items: products.map((p) => ({
            title: "Vault seat",
            product_id: p.id,
            variant_id: p.variants[0].id,
            quantity: 1,
            unit_price: price,
            requires_shipping: false,
          })),
        },
      ])
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

    const createSubscriptionWorkflow = (c: any) =>
      require("../../src/workflows/subscription").createSubscriptionWorkflow(c)
    /** Run the checkout, returning its result and errors rather than throwing. */
    async function checkout(cartId: string) {
      const run = await createSubscriptionWorkflow(container()).run({
        input: { cart_id: cartId, subscription_data: subscriptionData() },
        throwOnError: false,
      })
      return {
        result: run.result as any,
        errors: ((run.errors ?? []) as any[]).map((e) => `${e.action}: ${e.error?.message}`),
      }
    }

    const subscriptionData = () => ({
      interval: "monthly" as any,
      period: 1,
      type: "membership" as any,
      auto_renew: { approved: false, disclosure_version: null, approved_at: new Date().toISOString() },
    })

    async function readOrder(orderId: string) {
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "seller.id",
          "payment_collections.id",
          "payment_collections.captured_amount",
          "payment_collections.payments.id",
          "payment_collections.payments.captured_at",
        ],
        filters: { id: orderId },
      })
      return data[0] as any
    }

    /** The order's payments as the payment module records them. */
    async function moneyOf(orderId: string) {
      const order = await readOrder(orderId)
      const payments = await container().resolve(Modules.PAYMENT).listPayments(
        { payment_collection_id: order.payment_collections.map((c: any) => c.id) },
        { relations: ["captures", "refunds"] }
      )
      return payments.map((p: any) => ({
        captures: (p.captures ?? []).map((c: any) => Number(c.amount)),
        refunds: (p.refunds ?? []).map((r: any) => Number(r.amount)),
      }))
    }

    const { lockAttempts, sellerChecks } = checkoutRaceProbes(container)

    /** Stripe takes its time over the capture, so a second checkout arrives while the first is mid-sale. */
    function slowCapture(ms = 800) {
      stripe.capturePayment.mockImplementation(async (input: any) => {
        await new Promise((r) => setTimeout(r, ms))
        return { data: { ...(input?.data ?? {}), status: "succeeded" } }
      })
    }

    describe("the first order of a subscription", () => {
      it("is linked to its seller, its card payment captured, and it settles to that seller less the 3%", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart } = await makeCart([product])

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const orderId = result.order.id as string
        expect(result.subscription?.id).toBeTruthy()

        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        const payment = order.payment_collections[0].payments[0]
        expect(payment.captured_at).toBeTruthy()
        expect(Number(order.payment_collections[0].captured_amount)).toBe(5)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)

        // What the order.placed and payment.captured subscribers do.
        await placed(orderId)
        await captured(payment.id)
        const rows = await legs(orderId)
        const purchase = rows.find((e) => e.entry_type === "PURCHASE")
        const fee = rows.find((e) => e.entry_type === "COMMISSION")
        const sellerLeg = rows.find((e) => e.entry_type === "TRANSFER")
        expect(cents(purchase.amount)).toBe(500)
        expect(purchase.debit_account_id).toBe((await clearing()).id)
        expect(cents(fee.amount)).toBeGreaterThan(0)
        expect(cents(fee.amount) + cents(sellerLeg.amount)).toBe(500)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
      })

      it("flag off: as before — no lock, no seller link, the payment only authorized, nothing settles", async () => {
        delete process.env[SUBS]
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart } = await makeCart([product])
        const acquire = jest.spyOn(container().resolve(Modules.LOCKING), "acquire")

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        expect(acquire).not.toHaveBeenCalled()
        const orderId = result.order.id as string
        const order = await readOrder(orderId)
        expect(order.seller ?? null).toBeNull()
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        await placed(orderId)
        expect(await legs(orderId)).toEqual([])
      })

      it("a cart whose products belong to two sellers is refused before the card is touched", async () => {
        const a = await makeProduct((await makeSeller()).id)
        const b = await makeProduct((await makeSeller()).id)
        const { cart, customer } = await makeCart([a, b])

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([expect.stringMatching(/^resolve-subscription-seller: A subscription is sold by one seller/)])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
        expect(orders).toEqual([])
      })

      it("a capture Stripe refuses fails the checkout: no subscription, no seller link left behind", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart([product])
        stripe.capturePayment.mockImplementation(async () => {
          throw new Error("card_declined")
        })

        const { errors } = await checkout(cart.id)
        expect(errors.join("\n")).toMatch(/card_declined/)
        const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })
        expect(subs).toEqual([])
        // completeCartWorkflow's own compensation deletes the order outright,
        // so the query graph can no longer show its links: read the link
        // table itself. Nothing may still link this seller to an order.
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const { rows: table } = await pg.raw(
          `SELECT table_name FROM information_schema.tables WHERE table_name = 'seller_seller_order_order'`
        )
        expect(table).toHaveLength(1)
        const { rows: live } = await pg.raw(
          `SELECT order_id FROM seller_seller_order_order WHERE seller_id = ? AND deleted_at IS NULL`,
          [seller.id]
        )
        expect(live).toEqual([])
        // The checkout's compensation released the cart's lock: it can be
        // taken at once (held, the attempt would be refused).
        const locking = container().resolve(Modules.LOCKING)
        await locking.acquire(cart.id, { expire: 5 })
        await locking.release(cart.id)
      })

      describe("run again on a cart it already completed (a replay)", () => {
        // completeCartWorkflow creates nothing on a completed cart but still
        // registers a compensation that refunds a captured payment, so a
        // replay must keep out of it: the order is returned as its first
        // completion left it, and nothing is linked, captured or refunded.

        it("returns the same order: captured once, nothing refunded, one subscription", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id)
          const { cart, customer } = await makeCart([product])

          const first = await checkout(cart.id)
          expect(first.errors).toEqual([])
          const second = await checkout(cart.id)
          expect(second.errors).toEqual([])
          expect(second.result.order.id).toBe(first.result.order.id)

          expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
          expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(await moneyOf(first.result.order.id)).toEqual([{ captures: [5], refunds: [] }])
          const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })
          expect(subs).toHaveLength(1)
        })

        it("after the product moved to another seller: refunds nothing, and the subscription stays active", async () => {
          const a = await makeSeller()
          const b = await makeSeller()
          const product = await makeProduct(a.id)
          const { cart, customer } = await makeCart([product])

          const first = await checkout(cart.id)
          expect(first.errors).toEqual([])
          const link = container().resolve(ContainerRegistrationKeys.LINK)
          await link.dismiss({ [SELLER_MODULE]: { seller_id: a.id }, [Modules.PRODUCT]: { product_id: product.id } })
          await link.create({ [SELLER_MODULE]: { seller_id: b.id }, [Modules.PRODUCT]: { product_id: product.id } })

          const second = await checkout(cart.id)
          expect(second.errors).toEqual([])
          expect(second.result.order.id).toBe(first.result.order.id)
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(await moneyOf(first.result.order.id)).toEqual([{ captures: [5], refunds: [] }])
          expect((await readOrder(first.result.order.id)).seller?.id).toBe(a.id)
          const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })
          expect(subs.map((x: any) => x.status)).toEqual(["active"])
        })

        it("a replay that fails after the order is found refunds nothing", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id)
          const { cart } = await makeCart([product])
          const first = await checkout(cart.id)
          expect(first.errors).toEqual([])

          // The workflow's own read of the order (the first step after the
          // cart's order is known) fails once, as a dropped connection would.
          const query = container().resolve(ContainerRegistrationKeys.QUERY)
          const graph = query.graph.bind(query)
          let failed = false
          const read = jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
            if (!failed && q?.entity === "order" && (q.fields ?? []).includes("items.variant.product.seller.*")) {
              failed = true
              throw new Error("transient: connection terminated unexpectedly")
            }
            return graph(q, ...rest)
          })
          const second = await checkout(cart.id)
          read.mockRestore()
          expect(second.errors.join("\n")).toMatch(/transient: connection terminated unexpectedly/)

          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(await moneyOf(first.result.order.id)).toEqual([{ captures: [5], refunds: [] }])
          expect((await readOrder(first.result.order.id)).seller?.id).toBe(seller.id)
        })
      })

      it("a product moved to another seller while the card was authorized is refused at the link: rolled back, nothing captured", async () => {
        const a = await makeSeller()
        const b = await makeSeller()
        const product = await makeProduct(a.id)
        const { cart, customer } = await makeCart([product])
        // The seller check passed for A; while Stripe authorizes the card,
        // the product moves to B, so the order cannot go to the seller checked.
        const link = container().resolve(ContainerRegistrationKeys.LINK)
        stripe.authorizePayment.mockImplementation(async (input: any) => {
          await link.dismiss({ [SELLER_MODULE]: { seller_id: a.id }, [Modules.PRODUCT]: { product_id: product.id } })
          await link.create({ [SELLER_MODULE]: { seller_id: b.id }, [Modules.PRODUCT]: { product_id: product.id } })
          return { status: "authorized", data: { ...(input?.data ?? {}), status: "requires_capture" } }
        })

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          expect.stringMatching(
            new RegExp(`^link-subscription-order-seller: Subscription order order_\\w+ is sold by ${b.id}, not ${a.id} as checked before payment$`)
          ),
        ])
        // The authorization is released and nothing was taken.
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).toHaveBeenCalledTimes(1)
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })).toEqual([])
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const { rows: live } = await pg.raw(
          `SELECT order_id FROM seller_seller_order_order WHERE seller_id IN (?, ?) AND deleted_at IS NULL`,
          [a.id, b.id]
        )
        expect(live).toEqual([])
      })

      describe("failed after the card was authorized, then tried again on the same cart", () => {
        // The failed run's compensation cancels its payment, and Medusa keeps
        // that payment on the cart's payment collection. A retry pays with a
        // new payment session (createPaymentSessionsWorkflow deletes the old
        // one); the cancelled payment once counted as a second candidate and
        // refused every retry.

        /** A new payment session on the collection, as the storefront opens when the buyer pays again. */
        async function newPaymentSession(collectionId: string) {
          const { createPaymentSessionsWorkflow } = require("@medusajs/medusa/core-flows")
          await createPaymentSessionsWorkflow(container()).run({
            input: { payment_collection_id: collectionId, provider_id: "pp_stripe_stripe", data: {} },
          })
        }

        /** The order's payments: what was captured, refunded or cancelled. */
        async function paymentsOf(orderId: string) {
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

        it("after a capture Stripe refused, a retry with a new payment session is linked, captured once, makes one subscription, and settles", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id)
          const { cart, customer, collection } = await makeCart([product])
          stripe.capturePayment.mockImplementationOnce(async () => {
            throw new Error("stripe: connection reset")
          })

          const first = await checkout(cart.id)
          expect(first.errors.join("\n")).toMatch(/stripe: connection reset/)
          await newPaymentSession(collection.id)
          const second = await checkout(cart.id)
          expect(second.errors).toEqual([])

          const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
          expect(orders.map((o: any) => o.id)).toEqual([second.result.order.id])
          const order = await readOrder(second.result.order.id)
          expect(order.seller?.id).toBe(seller.id)
          const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })
          expect(subs.map((x: any) => x.status)).toEqual(["active"])
          expect(second.result.subscription?.id).toBe(subs[0].id)
          // The first attempt's payment stays cancelled; the new one is captured, once.
          const money = await paymentsOf(order.id)
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
          await placed(order.id)
          await captured(paid.id)
          const rows = await legs(order.id)
          const purchase = rows.find((e) => e.entry_type === "PURCHASE")
          const fee = rows.find((e) => e.entry_type === "COMMISSION")
          const sellerLeg = rows.find((e) => e.entry_type === "TRANSFER")
          expect(cents(purchase.amount)).toBe(500)
          expect(cents(fee.amount) + cents(sellerLeg.amount)).toBe(500)
          expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
        })

        it("after the link step's read failed once, a retry with a new payment session is linked, captured once and makes one subscription", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id)
          const { cart, customer, collection } = await makeCart([product])
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
          expect(first.errors).toEqual(["link-subscription-order-seller: transient: connection terminated unexpectedly"])
          await newPaymentSession(collection.id)
          const second = await checkout(cart.id)
          expect(second.errors).toEqual([])

          expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
          expect((await readOrder(second.result.order.id)).seller?.id).toBe(seller.id)
          expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(await paymentsOf(second.result.order.id)).toEqual(
            expect.arrayContaining([
              { captures: [], refunds: [], canceled: true },
              { captures: [5], refunds: [], canceled: false },
            ])
          )
          const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })
          expect(subs).toHaveLength(1)
        })

        it("a retry on the same payment session, whose payment the failed run cancelled, is refused at the capture: no subscription, nothing taken", async () => {
          const seller = await makeSeller()
          const product = await makeProduct(seller.id)
          const { cart, customer } = await makeCart([product])
          stripe.capturePayment.mockImplementationOnce(async () => {
            throw new Error("stripe: connection reset")
          })

          const first = await checkout(cart.id)
          expect(first.errors.join("\n")).toMatch(/stripe: connection reset/)
          // No new session: Medusa authorizes the session again by handing
          // back the payment it already has, the one the failed run cancelled.
          const second = await checkout(cart.id)
          expect(second.errors).toEqual([
            expect.stringMatching(/^capture-payment-workflow-as-step: The payment: pay_\w+ has been canceled\.$/),
          ])
          expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
          expect(stripe.refundPayment).not.toHaveBeenCalled()
          expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
          expect(await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })).toEqual([])
        })
      })

      it("a failure after the capture is refunded when Stripe takes the refund", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart([product])
        const subs = container().resolve(SUBSCRIPTION_MODULE)
        jest.spyOn(subs, "createSubscriptions").mockImplementation(async () => {
          throw new Error("subscription store down")
        })

        const { errors } = await checkout(cart.id)
        expect(errors.join("\n")).toMatch(/subscription store down/)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).toHaveBeenCalledTimes(1)
        expect(customer.id).toBeTruthy()
      })
    })

    describe("two checkouts of one cart at the same time (a double submit)", () => {
      // Before the checkout held the cart's lock, nothing kept the two apart
      // (completeCartWorkflow skips its own lock when run nested): on this
      // database they made two orders and two subscriptions with two captures
      // on one payment, or the losing run's compensation refunded the
      // winner's capture while its subscription stayed active.

      it("the second waits for the first, then returns its order as a replay: one order, one capture, nothing refunded, one subscription", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart([product])
        slowCapture()
        const lock = lockAttempts(cart.id)
        const checks = sellerChecks(cart.id)

        const [x, y] = await Promise.all([checkout(cart.id), checkout(cart.id)])
        expect([x.errors, y.errors]).toEqual([[], []])
        expect(y.result.order.id).toBe(x.result.order.id)
        // One run was refused the lock while the other held it, each took it
        // once (completeCartWorkflow, nested, takes none), and only the first
        // checked the seller: the second took the replay path.
        expect(lock.refused).toBeGreaterThan(0)
        expect(lock.taken).toBe(2)
        expect(checks.count).toBe(1)

        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await moneyOf(x.result.order.id)).toEqual([{ captures: [5], refunds: [] }])
        expect((await readOrder(x.result.order.id)).seller?.id).toBe(seller.id)
        const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })
        expect(subs).toHaveLength(1)
        // The first returns the subscription it made; the replay makes none.
        expect([x.result.subscription?.id, y.result.subscription?.id].filter(Boolean)).toEqual([subs[0].id])
      })

      it("over the store route, two POSTs at once answer with the same order, captured once, and one subscription", async () => {
        const pak = await createPublishableKeyToken(getContainer)
        const email = `buyer-${uid()}@example.com`
        const password = `${uid()}-${uid()}`
        const registered = await api.post("/auth/customer/emailpass/register", { email, password })
        const created = await api.post(
          "/store/customers",
          { email },
          { headers: { authorization: `Bearer ${registered.data.token}`, "x-publishable-api-key": pak } }
        )
        const login = await api.post("/auth/customer/emailpass", { email, password })
        const asCustomer = { headers: { authorization: `Bearer ${login.data.token}`, "x-publishable-api-key": pak } }

        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart } = await makeCart([product], 5, created.data.customer)
        slowCapture()
        const body = { cart_id: cart.id, interval: "monthly", period: 1, type: "membership", auto_renew_approved: false }
        const post = () => api.post("/store/subscriptions", body, asCustomer).catch((e: any) => e.response)

        const [a, b] = await Promise.all([post(), post()])
        expect([a.status, b.status]).toEqual([201, 201])
        expect(b.data.order.id).toBe(a.data.order.id)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await moneyOf(a.data.order.id)).toEqual([{ captures: [5], refunds: [] }])
        const subs = await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: created.data.customer.id })
        expect(subs).toHaveLength(1)
      })

      it("a second checkout kept waiting past the lock's 30 seconds fails before any money step, and refunds nothing", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart([product])
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
          expect(await container().resolve(SUBSCRIPTION_MODULE).listSubscriptions({ customer_id: customer.id })).toEqual([])
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

    describe("a renewal of a subscription", () => {
      const renewSubscriptionWorkflow = (c: any) =>
        require("../../src/workflows/subscription").renewSubscriptionWorkflow(c)

      /** A subscription bought through the real checkout, with the next cycle's charge recorded as `status`. */
      async function subscribed(status: "succeeded" | "processing") {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart } = await makeCart([product])
        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const subs = container().resolve(SUBSCRIPTION_MODULE)
        const sub = await subs.retrieveSubscription(result.subscription.id)
        const periodStart = addInterval(sub.last_order_date, sub.interval).toISOString()
        const intent = `pi_renew_${uid()}`
        // What `executeRenewalCharge` records once Stripe answers; the workflow
        // replays it rather than presenting the cycle to Stripe again.
        await subs.recordRenewalCharge(sub.id, {
          status,
          payment_intent_id: intent,
          period_start: periodStart,
          idempotency_key: `subscription-renewal:${sub.id}:${periodStart}`,
          amount: 500,
          currency_code: "usd",
          failure_reason: null,
          recorded_at: new Date().toISOString(),
        } as any)
        return { seller, sub, intent, firstOrderId: result.order.id as string }
      }

      async function renew(subscriptionId: string) {
        const run = await renewSubscriptionWorkflow(container()).run({
          input: { subscription_id: subscriptionId },
          throwOnError: false,
        })
        const errors = ((run.errors ?? []) as any[]).map((e) => `${e.action}: ${e.error?.message}`)
        expect(errors).toEqual([])
        expect(run.result?.order_id).toBeTruthy()
        return run.result.order_id as string
      }

      const stripeSays = (pi: string, s: Partial<ChargeLedgerState> = {}): ChargeLedgerState => ({
        charge_id: `ch_${pi}`,
        payment_intent_id: pi,
        currency: "usd",
        amount_cents: 500,
        refunded_cents: 0,
        dispute_lost_cents: 0,
        dispute_open_cents: 0,
        dispute_fee_cents: 0,
        ...s,
      })

      it("a collected renewal is linked to the seller, recorded as captured without touching Stripe, and settles", async () => {
        const { seller, sub, intent } = await subscribed("succeeded")
        const captures = stripe.capturePayment.mock.calls.length
        const orderId = await renew(sub.id)
        expect(stripe.capturePayment.mock.calls.length).toBe(captures)

        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        const payment = order.payment_collections[0].payments[0]
        expect(payment.captured_at).toBeTruthy()

        const view = await readCardSettlementOrder(container(), orderId)
        expect(view?.funding).toBe("fbm_card")
        expect(view?.payment_id).toBe(payment.id)

        // The bookkeeping capture's own event settles it (a system-provider
        // capture is reconciled, and read as card money only when verified).
        await captured(payment.id)
        const rows = await legs(orderId)
        const purchase = rows.find((e) => e.entry_type === "PURCHASE")
        const sellerLeg = rows.find((e) => e.entry_type === "TRANSFER")
        expect(cents(purchase.amount)).toBe(500)
        expect(purchase.debit_account_id).toBe((await clearing()).id)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)

        // A refund issued at Stripe on the renewal's intent reaches this order.
        const synced = await syncCardChargeFromStripe(container(), `ch_${intent}`, {
          fetchCharge: async () => stripeSays(intent, { refunded_cents: 500 }),
        })
        expect(synced.outcome).not.toBe("not_found")
        expect((await legs(orderId)).find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
      })

      it("a renewal still processing at the bank is linked but not recorded as captured, so nothing settles yet", async () => {
        const { seller, sub } = await subscribed("processing")
        const orderId = await renew(sub.id)
        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        await placed(orderId)
        expect(await legs(orderId)).toEqual([])
      })

      it("a refund recorded only in Medusa on a renewal moves no money, so the ledger posts none", async () => {
        const { sub } = await subscribed("succeeded")
        const orderId = await renew(sub.id)
        const payment = (await readOrder(orderId)).payment_collections[0].payments[0]
        await placed(orderId)
        await container().resolve(Modules.PAYMENT).refundPayment({ payment_id: payment.id, amount: 5 })
        await reconcileCardOrder(container(), orderId)
        expect((await legs(orderId)).find((e) => e.entry_type === "PURCHASE").status).toBe("COMPLETED")
        expect((await legs(orderId)).filter((e) => e.entry_type === "REFUND")).toEqual([])
      })

      it("a system payment that merely claims a subscription it is not linked to is not card money", async () => {
        const { sub, intent } = await subscribed("succeeded")
        const realOrderId = await renew(sub.id)

        // A forged order: its own seller link, paid on the system provider
        // with session data naming someone else's subscription and intent.
        const forgerSeller = await makeSeller()
        const forged = await makeOrder(forgerSeller.id, 5)
        const payments = container().resolve(Modules.PAYMENT)
        const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: 5 }])
        await container().resolve(ContainerRegistrationKeys.LINK).create({
          [Modules.ORDER]: { order_id: forged.id },
          [Modules.PAYMENT]: { payment_collection_id: collection.id },
        })
        const session = await payments.createPaymentSession(collection.id, {
          provider_id: "pp_system_default",
          amount: 5,
          currency_code: "usd",
          data: {},
        })
        const payment = await payments.authorizePaymentSession(session.id, {})
        await payments.capturePayment({ payment_id: payment.id, amount: 5 })
        // The worst case: a copy of the real record on the forged payment.
        await payments.updatePayment({
          id: payment.id,
          metadata: {
            [RENEWAL_RECORD_METADATA_KEY]: buildRenewalRecord({
              subscription_id: sub.id,
              payment_intent_id: intent,
              idempotency_key: "forged",
            }),
          },
        } as any)

        expect((await readCardSettlementOrder(container(), forged.id))?.funding).toBe("other")
        expect((await reconcileCardOrder(container(), forged.id)).outcome).toBe("not_card")
        expect(await legs(forged.id)).toEqual([])

        // Stripe's refund on that intent still finds the real renewal, not the
        // forged payment created after it.
        await placed(realOrderId)
        await syncCardChargeFromStripe(container(), `ch_${intent}`, {
          fetchCharge: async () => stripeSays(intent, { refunded_cents: 500 }),
        })
        expect((await legs(realOrderId)).find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
        expect(await legs(forged.id)).toEqual([])
      })
    })
  },
})
