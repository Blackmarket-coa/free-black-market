import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, TransactionState } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { CART_COMPLETION_INCOMPLETE_MESSAGE } from "../../src/lib/cart-completion"
import { SPLIT_AND_COMPLETE_CART_WORKFLOW_ID } from "../../src/api/middlewares/cart-completion-finished"
import { cardOrderFixtures } from "./helpers/card-orders"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows, stallNextCartCompletion } from "./helpers/stalled-workflows"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * SD-53 on the main checkout, `POST /store/carts/:id/complete`, on a real
 * migrated database: Mercur's own route and `split-and-complete-cart`
 * workflow (`@mercurjs/b2c-core`), the real cart, order, payment, fulfillment,
 * seller and marketplace modules, and FBM's
 * `refuseUnfinishedCartCompletion` middleware in front of the route
 * (`src/api/middlewares.ts`). Only Stripe is replaced, on the registered
 * provider instance, so the payment module's sessions and payments are real.
 *
 * Mercur's workflow authorizes the card, creates the order set and its
 * per-seller orders, and then runs a `parallelize` block (links, inventory,
 * the cart's `completed_at`, the `order.placed` and `order_set.placed`
 * events). Medusa 2.14.2's engine can leave that block unfinished
 * (helpers/stalled-workflows.ts), and Mercur's route, unlike Medusa's, does
 * not check that its run finished: here a stalled run was answered 500
 * `unknown_error` (its result transform reads the order set's id off
 * `undefined`), while the run's events — the `order_set.placed` that
 * Mercur's capture subscriber waits for — are held in the run's event group
 * and never released. The middleware reads the run's own `workflow_execution`
 * row (Mercur runs the workflow with the cart id as its transaction id) and
 * answers one still unfinished after its settle window 409 instead, whatever
 * the route answered.
 *
 * The other FBM paths are covered where their fixtures live: the digital and
 * subscription checkouts, over their workflows and store routes, in the two
 * settlement specs; the decision and the step in their unit specs.
 *
 * One fixture is not FBM's behaviour, and says so. On a database migrated
 * from scratch, as this one is, Mercur 1.5.0 cannot create an order set at
 * all: its migration makes `order_set.display_id` a `serial` (NOT NULL,
 * defaulting to the sequence), while its model declares
 * `model.number().nullable()`, and Medusa's DML writes `null` into an unset
 * nullable property before create (`define-property.js`). The insert then
 * names `display_id = NULL`, Postgres refuses it, and the route answers 400
 * "Cannot set field 'display_id' of Order set to null" for every cart, before
 * any order exists (seen here first). Whether production's schema has the
 * same column is not visible from this tree. The `beforeAll` below gives the
 * column what its migration intended — the sequence's next value when the
 * model writes null — so that Mercur's checkout can run here at all.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const { container, uid, makeSeller } = cardOrderFixtures(getContainer)

    type Stripe = {
      initiatePayment: jest.SpyInstance
      authorizePayment: jest.SpyInstance
      capturePayment: jest.SpyInstance
      refundPayment: jest.SpyInstance
      cancelPayment: jest.SpyInstance
    }
    let stripe: Stripe
    let drainSubscribers: () => Promise<void> = async () => {}
    let channel: { id: string } | null = null

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
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })

    // Mercur 1.5.0's model writes NULL into its own serial column (see the
    // header): give the row the sequence's next value instead, as the
    // column's default would. A test-database fixture, not FBM behaviour.
    beforeAll(async () => {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      await pg.raw(`
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

    /**
     * Before the runner's teardown: every subscriber the test's events set off
     * has finished, and no execution is left unfinished (one that is fails
     * this test, not every later one). Registered inside each describe block
     * so that it runs before the runner's own afterEach (see the settlement
     * specs and helpers/drain-subscribers.ts).
     */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    async function salesChannel() {
      if (!channel) {
        ;[channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${uid()}` }])
      }
      return channel as { id: string }
    }

    /** A published product with one variant, the seller's, in the sales channel. */
    async function makeProduct(sellerId: string) {
      const id = uid()
      const [product] = await container().resolve(Modules.PRODUCT).createProducts([
        {
          title: `Tomatoes ${id}`,
          handle: `tomatoes-${id}`,
          status: "published",
          options: [{ title: "Size", values: ["Crate"] }],
          variants: [{ title: "Crate", manage_inventory: false, options: { Size: "Crate" } }],
        },
      ])
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      await link.create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: (await salesChannel()).id },
      })
      return product
    }

    /**
     * The seller's shipping option: Mercur completes a cart only with a
     * shipping method per seller, read through its seller–shipping-option link.
     */
    async function sellerShippingOption(sellerId: string) {
      const id = uid()
      const fulfillment = container().resolve(Modules.FULFILLMENT)
      const link = container().resolve(ContainerRegistrationKeys.LINK)
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
      await link.create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.FULFILLMENT]: { shipping_option_id: option.id } })
      return option as { id: string; name: string }
    }

    /**
     * A customer's cart holding the seller's product at $5.00, with the
     * seller's shipping method (unless `shipping: false`) and a Stripe session
     * opened on it.
     */
    async function makeCart(seller: { id: string }, product: any, opts: { shipping?: boolean } = {}) {
      const price = 5
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
          items: [
            {
              title: product.title,
              product_id: product.id,
              variant_id: product.variants[0].id,
              quantity: 1,
              unit_price: price,
              requires_shipping: true,
            },
          ],
        },
      ])
      if (opts.shipping !== false) {
        const option = await sellerShippingOption(seller.id)
        await carts.addShippingMethods({ cart_id: cart.id, name: option.name, amount: 0, shipping_option_id: option.id })
      }
      const payments = container().resolve(Modules.PAYMENT)
      const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: price }])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.CART]: { cart_id: cart.id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      })
      await payments.createPaymentSession(collection.id, {
        provider_id: "pp_stripe_stripe",
        amount: price,
        currency_code: "usd",
        data: {},
      })
      return { cart, customer, collection }
    }

    const complete = async (cartId: string, pak: ReturnType<typeof pakHeaders>) =>
      api.post(`/store/carts/${cartId}/complete`, {}, pak).catch((e: any) => e.response)
    /** Fails with the route's body when its status is not the one expected. */
    function expectStatus(response: { status: number; data: unknown }, status: number) {
      if (response.status !== status) {
        throw new Error(`expected ${status}, the route answered ${response.status}: ${JSON.stringify(response.data)}`)
      }
    }

    /** The states of the cart's `split-and-complete-cart` executions: Mercur runs it with the cart id as its transaction id. */
    async function executionStates(cartId: string): Promise<string[]> {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const { rows } = await pg.raw(
        `SELECT state FROM workflow_execution WHERE deleted_at IS NULL AND workflow_id = ? AND transaction_id = ? ORDER BY created_at`,
        [SPLIT_AND_COMPLETE_CART_WORKFLOW_ID, cartId]
      )
      return rows.map((r: { state: string }) => r.state)
    }

    async function orderSetsOf(cartId: string) {
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "order_set", fields: ["id", "cart_id"], filters: { cart_id: cartId } })
      return data as Array<{ id: string }>
    }

    const refusal = (reason: string) => ({
      code: "cart_completion_incomplete",
      type: "cart_completion_incomplete",
      message: CART_COMPLETION_INCOMPLETE_MESSAGE,
      reason,
    })

    describe("POST /store/carts/:id/complete, Mercur's split-and-complete-cart (SD-53)", () => {
      afterEach(settleBeforeTeardown)

      it("a completion that finishes answers 200 with its order set, its execution finished: the middleware leaves it alone", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart(seller, product)

        const response = await complete(cart.id, pak)
        expectStatus(response, 200)
        expect(response.data.order_set?.id).toBeTruthy()
        expect((await orderSetsOf(cart.id)).map((s) => s.id)).toEqual([response.data.order_set.id])
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        // The engine drops a finished run's row (no retention time, no parent step).
        expect(await executionStates(cart.id)).toEqual([])
        expect((await container().resolve(Modules.CART).retrieveCart(cart.id)).completed_at).toBeTruthy()
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
      })

      it("a completion the engine leaves unfinished is answered 409 cart_completion_incomplete with the buyer's message and no ids; its order set stays, nothing is captured", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer, collection } = await makeCart(seller, product)
        const stall = stallNextCartCompletion(container)

        const response = await complete(cart.id, pak)
        expectStatus(response, 409)
        expect(response.data).toEqual(refusal("execution_unfinished"))
        expect(stall.stalled()).toBe(true)
        expect(JSON.stringify(response.data)).not.toContain(cart.id)

        // What the stall left: Mercur's run unfinished under the cart id, the
        // order set and its order written, the card authorized and never
        // captured (Mercur captures on order_set.placed, which the run never
        // releases), so the authorization lapses. The in-memory engine writes
        // an idempotent run's row when it begins and deletes it when it ends,
        // so a stalled run's row stays `not_started` (its state in memory is
        // `invoking`). The runner's wait between tests counts `not_started`
        // as ended, so it does not hang on it.
        expect(await executionStates(cart.id)).toEqual([TransactionState.NOT_STARTED])
        const orderSets = await orderSetsOf(cart.id)
        expect(orderSets).toHaveLength(1)
        expect(JSON.stringify(response.data)).not.toContain(orderSets[0].id)
        const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
        expect(orders).toHaveLength(1)
        expect(JSON.stringify(response.data)).not.toContain(orders[0].id)
        const payments = await container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collection.id })
        expect(payments).toHaveLength(1)
        expect(payments[0].captured_at ?? null).toBeNull()
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        await drainSubscribers()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
      })

      it("a retry of the stalled cart is refused the same way: the route resumes the same run under the cart id, no second order set, nothing captured", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart(seller, product)
        const stall = stallNextCartCompletion(container)

        const first = await complete(cart.id, pak)
        expectStatus(first, 409)
        expect(stall.stalled()).toBe(true)

        const retry = await complete(cart.id, pak)
        expectStatus(retry, 409)
        expect(retry.data).toEqual(refusal("execution_unfinished"))
        expect(await executionStates(cart.id)).toEqual([TransactionState.NOT_STARTED])
        expect(await orderSetsOf(cart.id)).toHaveLength(1)
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        await drainSubscribers()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
      })

      it("a completion Mercur refuses itself keeps Mercur's answer: only an order-set answer is checked", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const { cart, customer } = await makeCart(seller, product, { shipping: false })

        const response = await complete(cart.id, pak)
        // Mercur: "Seller shipping method not found!" (INVALID_DATA), before any order exists.
        expectStatus(response, 400)
        expect(response.data.type).toBe("invalid_data")
        expect(response.data.code).not.toBe("cart_completion_incomplete")
        expect(await orderSetsOf(cart.id)).toEqual([])
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect(await executionStates(cart.id)).toEqual([])
      })
    })
  },
})
