import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow, completeCartWorkflowId } from "@medusajs/medusa/core-flows"
import { MARKETPLACE_MODULE } from "@mercurjs/b2c-core/modules/marketplace"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { SPLIT_AND_COMPLETE_CART_WORKFLOW_ID } from "../../src/api/middlewares/cart-completion-finished"
import {
  CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE,
  CART_COMPLETION_CHECK_FAILED_MESSAGE,
} from "../../src/api/middlewares/cart-completion-guards"
import { CART_COMPLETION_INCOMPLETE_MESSAGE } from "../../src/lib/cart-completion"
import { CART_PAYMENT_AMOUNT_MISMATCH } from "../../src/lib/cart-payment-amount"
import { CCR_RESERVATION_METADATA_KEY } from "../../src/lib/ccr-checkout"
import { ORDER_CYCLE_MODULE } from "../../src/modules/order-cycle"
import { RENTAL_MODULE } from "../../src/modules/rental"
import { upsertRentalConfigWorkflow } from "../../src/workflows/rental/upsert-rental-config"
import { cardOrderFixtures } from "./helpers/card-orders"
import { cartCompletionStallRetry } from "./helpers/cart-completion-stall"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows, stallNextCartCompletion } from "./helpers/stalled-workflows"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * SD-54 / SD-72 (a): FBM's cart-completion guards on its main checkout,
 * `POST /store/carts/:id/complete`, on a real migrated database.
 *
 * Mercur serves that route with `splitAndCompleteCartWorkflow`, which never
 * calls `completeCartWorkflow.hooks.validate`, where the guards live, so
 * until this change a closed or oversold order cycle, a cart holding reserved
 * Coalition Credits and a malformed sliding-scale tier all completed here.
 * `refuseGuardedCartCompletion` (`src/api/middlewares/cart-completion-guards.ts`)
 * now runs the main checkout's list (`MAIN_CHECKOUT_GUARDS`: tier, CCR,
 * order cycle; not rental, by operator decision) in front of the route. It
 * answers two carts itself, with 409: one Medusa's own workflow completed
 * (never passed to Mercur, whose run on it cancels that order's payment;
 * `cart_already_completed` with the order when FBM's judge passes that order,
 * `cart_completion_incomplete` when the completion left it unpaid), and one
 * it cannot check (`cart_completion_check_failed`).
 *
 * Everything here is real except Stripe, which is stubbed on the registered
 * provider instance (as in cart-completion-refuses.spec.ts): Mercur's route
 * and workflow, FBM's middlewares in front of it, the cart, order, payment,
 * fulfillment, seller, marketplace and order-cycle modules, and the
 * `order.placed` subscriber that records a cycle's sale.
 *
 * One fixture is not FBM's behaviour, and says so: the `order_set.display_id`
 * trigger (cart-completion-refuses.spec.ts explains it: Mercur 1.5.0's model
 * writes NULL into its own serial column on a migrated database). The cycle's
 * product row, written with SQL until SD-63's order-cycle migration added the
 * `raw_override_price` column the ORM insert names (SD-72 (d)), now goes
 * through `createOrderCycleProducts`.
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

    /** Stripe's API, stubbed on the provider instance the payment module uses. */
    function armStripe() {
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
    }

    beforeEach(() => {
      drainSubscribers = trackSubscribers(container)
      armStripe()
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })

    // Mercur 1.5.0's model writes NULL into its own serial column (see
    // cart-completion-refuses.spec.ts): give the row the sequence's next
    // value instead, as the column's default would. A test-database fixture.
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
     * The tests that complete a cart re-run on a fresh cart when Medusa's
     * engine stalls that completion on its own (SD-53 (d),
     * helpers/cart-completion-stall.ts), watching Mercur's workflow and, for
     * the one test that completes a cart through Medusa's own first, that one
     * too. The refusal tests keep Jest's `it`: their completion is refused
     * before Mercur's workflow starts.
     */
    const stallRetry = cartCompletionStallRetry({
      container,
      workflowId: [SPLIT_AND_COMPLETE_CART_WORKFLOW_ID, completeCartWorkflowId],
      reset: async () => {
        await drainSubscribers()
        jest.restoreAllMocks()
        drainSubscribers = trackSubscribers(container)
        armStripe()
      },
    })

    /** Before the runner's teardown: subscribers drained, no execution left unfinished (helpers/stalled-workflows.ts). */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    /** A published product with one variant, the seller's, in the sales channel. */
    async function makeProduct(sellerId: string, salesChannelId: string) {
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
        [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
      })
      return product as { id: string; title: string; variants: Array<{ id: string }> }
    }

    /**
     * The seller's shipping option: Mercur completes a cart only with a
     * shipping method per seller. The product is put on the option's shipping
     * profile too, which Medusa's own workflow requires (its
     * `validateShippingStep`) and Mercur's ignores, so the same cart can be
     * completed by either.
     */
    async function sellerShippingOption(sellerId: string, productId: string) {
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
      await link.create({ [Modules.PRODUCT]: { product_id: productId }, [Modules.FULFILLMENT]: { shipping_profile_id: profile.id } })
      return option as { id: string; name: string }
    }

    /**
     * An order cycle in `status`, offering `variantId` with the given capacity
     * (`available: null` is unlimited).
     */
    async function makeCycle(variantId: string, spec: { status: string; available: number | null; sold: number }) {
      const now = Date.now()
      const cycles = container().resolve(ORDER_CYCLE_MODULE)
      const cycle = await cycles.createOrderCycles({
        name: `Week ${uid()}`,
        opens_at: new Date(now - 86_400_000),
        closes_at: new Date(now + 86_400_000),
        dispatch_at: new Date(now + 2 * 86_400_000),
        status: spec.status,
        coordinator_seller_id: `sel_${uid()}`,
      })
      await cycles.createOrderCycleProducts({
        order_cycle_id: cycle.id,
        variant_id: variantId,
        seller_id: `sel_${uid()}`,
        available_quantity: spec.available,
        sold_quantity: spec.sold,
      })
      return cycle as { id: string; name: string }
    }

    /**
     * A customer's cart holding `quantity` of one seller's product at $5.00,
     * with that seller's shipping method and a Stripe session opened for its
     * total (or for `sessionAmount`). With `cycle`, the product is offered in
     * a new order cycle, tagged as the storefront's cycle add-to-cart tags it
     * (`storefront/src/lib/data/order-cycles.ts`: the line's
     * `metadata.order_cycle_id`), or, with `cycleTag: "cart"`, on the cart's
     * metadata only, as a store client could write it. `cycleId` tags the line
     * with an id that names no cycle. `cartMetadata` is written onto the cart
     * as a client could write it.
     */
    async function makeCart(
      opts: {
        quantity?: number
        cycle?: { status: string; available: number | null; sold: number }
        cycleTag?: "line" | "cart"
        cycleId?: string
        cycleOffers?: "this variant" | "another variant"
        cartMetadata?: Record<string, unknown>
        sessionAmount?: number
      } = {}
    ) {
      const id = uid()
      const quantity = opts.quantity ?? 1
      const unitPrice = 5
      const [channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${id}` }])
      const seller = await makeSeller()
      const product = await makeProduct(seller.id, channel.id)
      const offered = opts.cycleOffers === "another variant" ? (await makeProduct(seller.id, channel.id)).variants[0].id : product.variants[0].id
      const cycle = opts.cycle ? await makeCycle(offered, opts.cycle) : null
      const cycleId = cycle?.id ?? opts.cycleId
      const lineTag = cycleId && opts.cycleTag !== "cart" ? { order_cycle_id: cycleId } : undefined
      const cartTag = cycleId && opts.cycleTag === "cart" ? { order_cycle_id: cycleId } : {}
      const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${id}@example.com` }])
      const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
      const carts = container().resolve(Modules.CART)
      const [cart] = await carts.createCarts([
        {
          currency_code: "usd",
          region_id: region.id,
          sales_channel_id: channel.id,
          customer_id: customer.id,
          email: customer.email,
          metadata: { ...cartTag, ...(opts.cartMetadata ?? {}) },
          items: [
            {
              title: product.title,
              product_id: product.id,
              variant_id: product.variants[0].id,
              quantity,
              unit_price: unitPrice,
              requires_shipping: true,
              metadata: lineTag,
            },
          ],
        },
      ])
      const option = await sellerShippingOption(seller.id, product.id)
      await carts.addShippingMethods({ cart_id: cart.id, name: option.name, amount: 0, shipping_option_id: option.id })
      const total = unitPrice * quantity
      const payments = container().resolve(Modules.PAYMENT)
      const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: total }])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.CART]: { cart_id: cart.id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      })
      await payments.createPaymentSession(collection.id, {
        provider_id: "pp_stripe_stripe",
        amount: opts.sessionAmount ?? total,
        currency_code: "usd",
        data: {},
      })
      return { cart, customer, collection, cycle, product }
    }

    const complete = async (cartId: string, pak: ReturnType<typeof pakHeaders>) =>
      api.post(`/store/carts/${cartId}/complete`, {}, pak).catch((e: any) => e.response)
    const newPak = async () => pakHeaders(await createPublishableKeyToken(getContainer))

    /** Fails with the route's body when its status is not the one expected. */
    function expectStatus(response: { status: number; data: unknown }, status: number) {
      if (response.status !== status) {
        throw new Error(`expected ${status}, the route answered ${response.status}: ${JSON.stringify(response.data)}`)
      }
    }

    async function orderSetsOf(cartId: string) {
      const { data } = await container()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order_set", fields: ["id", "cart_id"], filters: { cart_id: cartId } })
      return data as Array<{ id: string }>
    }
    const ordersOf = async (customerId: string) => container().resolve(Modules.ORDER).listOrders({ customer_id: customerId })
    const paymentsOf = async (collectionId: string) =>
      container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collectionId })
    const completedAt = async (cartId: string) => (await container().resolve(Modules.CART).retrieveCart(cartId)).completed_at ?? null
    async function soldOf(cycleId: string): Promise<number[]> {
      const { rows } = await container()
        .resolve(ContainerRegistrationKeys.PG_CONNECTION)
        .raw(`SELECT sold_quantity FROM order_cycle_product WHERE order_cycle_id = ? ORDER BY id`, [cycleId])
      return rows.map((r: { sold_quantity: number }) => Number(r.sold_quantity))
    }
    /** Mercur runs its workflow with the cart id as the transaction id; a run that ended has no row left. */
    async function executionStates(cartId: string): Promise<string[]> {
      const { rows } = await container()
        .resolve(ContainerRegistrationKeys.PG_CONNECTION)
        .raw(`SELECT state FROM workflow_execution WHERE deleted_at IS NULL AND workflow_id = ? AND transaction_id = ?`, [
          SPLIT_AND_COMPLETE_CART_WORKFLOW_ID,
          cartId,
        ])
      return rows.map((r: { state: string }) => r.state)
    }

    /**
     * A refusal in front of Mercur's route: 400 with the guard's type and
     * message, and nothing of the sale: no order set, no order, no payment,
     * the card never authorized, the cart not completed, and no run of
     * Mercur's workflow left behind.
     */
    async function expectRefusedBeforeMercur(
      response: { status: number; data: any },
      made: { cart: { id: string }; customer: { id: string }; collection: { id: string } },
      expected: { type: "not_allowed" | "invalid_data"; message: string | RegExp }
    ) {
      expectStatus(response, 400)
      expect(response.data.type).toBe(expected.type)
      expect(String(response.data.message)).toMatch(expected.message)
      expect(await orderSetsOf(made.cart.id)).toEqual([])
      expect(await ordersOf(made.customer.id)).toEqual([])
      expect(await paymentsOf(made.collection.id)).toEqual([])
      expect(stripe.authorizePayment).not.toHaveBeenCalled()
      expect(await completedAt(made.cart.id)).toBeNull()
      expect(await executionStates(made.cart.id)).toEqual([])
    }

    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

    describe("POST /store/carts/:id/complete runs FBM's cart-completion guards before Mercur's workflow (SD-54, SD-72 (a))", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("a cart on an open cycle, inside capacity, completes into its order set and the cycle records the sale: the fixture is a cart that completes", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 10, sold: 0 } })

        const response = await complete(made.cart.id, await newPak())
        expectStatus(response, 200)
        expect(response.data.order_set?.id).toBeTruthy()
        expect((await orderSetsOf(made.cart.id)).map((s) => s.id)).toEqual([response.data.order_set.id])
        expect(await ordersOf(made.customer.id)).toHaveLength(1)
        expect(await completedAt(made.cart.id)).toBeTruthy()
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        await drainSubscribers()
        expect(await soldOf(made.cycle!.id)).toEqual([2])
      })

      it("a cart for an order cycle that has closed is refused before Mercur authorizes anything (D9-3)", async () => {
        const made = await makeCart({ cycle: { status: "closed", available: 10, sold: 0 } })
        const response = await complete(made.cart.id, await newPak())
        await expectRefusedBeforeMercur(response, made, {
          type: "not_allowed",
          message: new RegExp(`^The order cycle "${escape(made.cycle!.name)}" is closed and is no longer taking orders`),
        })
      })

      it("a cart asking for more than the cycle has left is refused, reading the cycle's real stock (D9-1)", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 10, sold: 9 } })
        const response = await complete(made.cart.id, await newPak())
        await expectRefusedBeforeMercur(response, made, {
          type: "not_allowed",
          message: new RegExp(`^Only 1 left of an item in your cart for "${escape(made.cycle!.name)}", and you have 2`),
        })
      })

      it("a cart whose line names a cycle that no longer exists is refused, naming the line, not the cycle", async () => {
        const made = await makeCart({ cycleId: "ocyc_does_not_exist" })
        const response = await complete(made.cart.id, await newPak())
        await expectRefusedBeforeMercur(response, made, {
          type: "not_allowed",
          message: `"${made.product.title}" in your cart is from an order cycle that no longer exists. Remove it and check out again.`,
        })
        expect(String(response.data.message)).not.toContain("ocyc_does_not_exist")
      })

      it("a cart holding a Coalition Credits reservation is refused, in words the buyer can act on: no cart id, no API path", async () => {
        const made = await makeCart({ cartMetadata: { [CCR_RESERVATION_METADATA_KEY]: 3 } })
        const response = await complete(made.cart.id, await newPak())
        await expectRefusedBeforeMercur(response, made, {
          type: "not_allowed",
          message: /^Your cart has 3 Coalition Credits applied, but paying with Coalition Credits is not available yet/,
        })
        expect(String(response.data.message)).not.toContain(made.cart.id)
        expect(String(response.data.message)).not.toMatch(/\/store\//)
      })

      it("a cart with a malformed sliding-scale tier is refused as invalid data", async () => {
        const made = await makeCart({ cartMetadata: { tier: "not-a-tier" } })
        const response = await complete(made.cart.id, await newPak())
        await expectRefusedBeforeMercur(response, made, {
          type: "invalid_data",
          message: /^Invalid sliding-scale tier "not-a-tier"\. Allowed: /,
        })
      })

      it("the guards answer before the payment-amount check: a refused cart's stale session is left as it was, nothing settled", async () => {
        // Closed cycle AND a session opened for less than the cart's total. The
        // payment-amount check (SD-115) would answer 409 and put the payment
        // side right; the guards run first and refuse with nothing written.
        const made = await makeCart({ cycle: { status: "closed", available: 10, sold: 0 }, sessionAmount: 4 })
        const response = await complete(made.cart.id, await newPak())
        expect(response.data.code).not.toBe(CART_PAYMENT_AMOUNT_MISMATCH)
        await expectRefusedBeforeMercur(response, made, { type: "not_allowed", message: /is closed and is no longer taking orders/ })
        const sessions = await container().resolve(Modules.PAYMENT).listPaymentSessions({ payment_collection_id: made.collection.id })
        expect(sessions.map((s: { amount: unknown }) => Number(s.amount))).toEqual([4])
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
      })
    })

    describe("a check the middleware cannot make", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("a cart whose order sets cannot be read is answered 409 cart_completion_check_failed: not placed, nothing authorized; once the read works again it completes", async () => {
        const made = await makeCart()
        const pak = await newPak()
        const query = container().resolve(ContainerRegistrationKeys.QUERY)
        const graph = query.graph.bind(query)
        let failed = 0
        jest.spyOn(query, "graph").mockImplementation(async (args: any, ...rest: any[]) => {
          if (failed === 0 && args?.entity === "order_set" && args?.filters?.cart_id === made.cart.id) {
            failed++
            throw new Error("Connection terminated unexpectedly")
          }
          return graph(args, ...rest)
        })

        const refused = await complete(made.cart.id, pak)
        // The read that failed is the middleware's own.
        expect(failed).toBe(1)
        expectStatus(refused, 409)
        expect(refused.data).toEqual({
          code: "cart_completion_check_failed",
          type: "cart_completion_check_failed",
          message: CART_COMPLETION_CHECK_FAILED_MESSAGE,
        })
        expect(await orderSetsOf(made.cart.id)).toEqual([])
        expect(await ordersOf(made.customer.id)).toEqual([])
        expect(await paymentsOf(made.collection.id)).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(await completedAt(made.cart.id)).toBeNull()

        // What the message says to do works.
        const retried = await complete(made.cart.id, pak)
        expectStatus(retried, 200)
        expect(await ordersOf(made.customer.id)).toHaveLength(1)
      })
    })

    describe("what the guards do not check on the main checkout", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("a re-run of a placed order whose own sale took the cycle's last units answers 200 with the same order set, and still one order (Mercur's order set exists)", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 2, sold: 0 } })
        const pak = await newPak()
        const first = await complete(made.cart.id, pak)
        expectStatus(first, 200)
        await drainSubscribers()
        // The sale is recorded: nothing is left, so the cycle guard would refuse this cart now.
        expect(await soldOf(made.cycle!.id)).toEqual([2])

        const again = await complete(made.cart.id, pak)
        expectStatus(again, 200)
        expect(again.data.order_set?.id).toBe(first.data.order_set.id)
        expect((await orderSetsOf(made.cart.id)).map((s) => s.id)).toEqual([first.data.order_set.id])
        expect(await ordersOf(made.customer.id)).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        await drainSubscribers()
        expect(await soldOf(made.cycle!.id)).toEqual([2])
      })

      it("a cart with an order set and no completed_at (a completion the engine left unfinished before it wrote completed_at) is not checked, though its cycle has closed: Mercur hands back that order set", async () => {
        // The first of the two skips on its own: the order set is the test
        // Mercur's workflow makes before it creates anything. (The re-run
        // above has both an order set and completed_at, so it cannot tell the
        // two skips apart.) The set is written as Mercur's step writes it.
        const made = await makeCart({ cycle: { status: "closed", available: 10, sold: 0 } })
        const created = await container().resolve(MARKETPLACE_MODULE).createOrderSets({
          cart_id: made.cart.id,
          customer_id: made.customer.id,
          sales_channel_id: made.cart.sales_channel_id,
          payment_collection_id: made.collection.id,
        })
        const set = (Array.isArray(created) ? created[0] : created) as { id: string }
        expect(await completedAt(made.cart.id)).toBeNull()

        const response = await complete(made.cart.id, await newPak())
        expectStatus(response, 200)
        expect(response.data.order_set?.id).toBe(set.id)
        expect(await ordersOf(made.customer.id)).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(await completedAt(made.cart.id)).toBeNull()
      })

      /**
       * The second cart the guards do not check: one Medusa's own
       * `completeCartWorkflow` completed (tickets, rentals, the digital and
       * subscription checkouts, Medusa's payment webhook), which has
       * `completed_at` and no order set. Its guards ran on that workflow's
       * validate hook; here they would refuse on the cart's own sale (these
       * carts took the cycle's last two units, so the cycle guard would answer
       * "sold out"). Nor is it passed to Mercur: before this answer, Mercur's
       * run on such a cart failed linking its order to the cart's payment
       * collection (400 "Cannot create multiple links between 'order' and
       * 'payment'") and its compensation cancelled the payment Medusa's order
       * was placed on, calling Stripe's cancel, on every retry (SD-72 (b)'s
       * mirror; measured here first, and in review through `complete-digital`).
       * It is answered 409 `cart_already_completed` with that order's id, and
       * nothing is written.
       */
      async function expectAnsweredAsCompleted(
        made: { cart: { id: string }; customer: { id: string }; collection: { id: string }; cycle: { id: string } | null },
        orderId: string,
        pak: ReturnType<typeof pakHeaders>
      ) {
        const [placed] = await paymentsOf(made.collection.id)
        expect(placed.canceled_at ?? null).toBeNull()
        const authorized = stripe.authorizePayment.mock.calls.length

        // Every retry the same: Mercur is never called, so nothing is cancelled.
        for (const _attempt of [1, 2]) {
          const response = await complete(made.cart.id, pak)
          expectStatus(response, 409)
          expect(response.data).toEqual({
            code: "cart_already_completed",
            type: "cart_already_completed",
            message: CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE,
            order_id: orderId,
          })
        }
        await drainSubscribers()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(authorized)
        const after = await paymentsOf(made.collection.id)
        expect(after.map((p: any) => ({ id: p.id, canceled_at: p.canceled_at ?? null, captured_at: p.captured_at ?? null }))).toEqual([
          { id: placed.id, canceled_at: null, captured_at: placed.captured_at ?? null },
        ])
        expect(await orderSetsOf(made.cart.id)).toEqual([])
        expect((await ordersOf(made.customer.id)).map((o: { id: string }) => o.id)).toEqual([orderId])
        expect(await soldOf(made.cycle!.id)).toEqual([2])
        expect(await executionStates(made.cart.id)).toEqual([])
      }

      stallRetry.it("a cart Medusa's own workflow completed (completed_at, no order set) is answered 409 cart_already_completed with its order, on every retry: no guard, no Mercur run, its payment untouched", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 2, sold: 0 } })
        const { result, errors } = await completeCartWorkflow(container()).run({ input: { id: made.cart.id }, throwOnError: false })
        const medusaOrderId = (result as { id?: string } | undefined)?.id
        if (!medusaOrderId) {
          throw new Error(
            `Medusa's completion handed back no order id (${(errors ?? []).map((e: any) => e?.error?.message).join(" | ")}): not a guard result (on an SD-53 engine stall the helper re-runs this on a fresh cart).`
          )
        }
        await drainSubscribers()
        expect(await soldOf(made.cycle!.id)).toEqual([2])
        expect(await completedAt(made.cart.id)).toBeTruthy()
        expect(await orderSetsOf(made.cart.id)).toEqual([])
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)

        await expectAnsweredAsCompleted(made, medusaOrderId, await newPak())
      })

      stallRetry.it("the review's sequence through store routes alone: a cart completed by POST /store/carts/:id/complete-digital, then posted to the main checkout, is answered 409 with that order and keeps its payment", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 2, sold: 0 } })
        const pak = await newPak()
        const digital = await api.post(`/store/carts/${made.cart.id}/complete-digital`, {}, pak).catch((e: any) => e.response)
        expectStatus(digital, 200)
        const orderId = digital.data.order?.id as string
        expect(orderId).toBeTruthy()
        await drainSubscribers()
        // Medusa's order, its payment authorized, the cycle's sale recorded.
        expect(await soldOf(made.cycle!.id)).toEqual([2])
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)

        await expectAnsweredAsCompleted(made, orderId, pak)
      })

      /**
       * "Already placed" only for an order FBM's judge passes
       * (`judgeCartCompletion`). A Medusa completion the engine stalls (SD-53,
       * stalled here on purpose as helpers/stalled-workflows.ts does it) leaves
       * the order, the cart's `order_cart` link and `completed_at` written, with
       * no payment, the card never authorized and no event released, so no
       * confirmation email: the judge calls that `order_unpaid`, and so does the
       * answer. Jest's own `it`: the stall is this test's subject.
       */
      it("a cart whose Medusa completion the engine stalled (order, link and completed_at written, no payment) is answered 409 cart_completion_incomplete with no order id: nothing written, Stripe never called", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 2, sold: 0 } })
        const stall = stallNextCartCompletion(container)
        const { result } = await completeCartWorkflow(container()).run({ input: { id: made.cart.id }, throwOnError: false })
        expect(stall.stalled()).toBe(true)
        expect((result as { id?: string } | undefined)?.id).toBeUndefined()
        expect(await completedAt(made.cart.id)).toBeTruthy()
        const left = await ordersOf(made.customer.id)
        expect(left).toHaveLength(1)
        expect(await paymentsOf(made.collection.id)).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()

        const response = await complete(made.cart.id, await newPak())
        expectStatus(response, 409)
        expect(response.data).toEqual({
          code: "cart_completion_incomplete",
          type: "cart_completion_incomplete",
          message: CART_COMPLETION_INCOMPLETE_MESSAGE,
          reason: "order_unpaid",
        })
        expect(JSON.stringify(response.data)).not.toContain(left[0].id)
        expect(await orderSetsOf(made.cart.id)).toEqual([])
        expect((await ordersOf(made.customer.id)).map((o: { id: string }) => o.id)).toEqual([left[0].id])
        expect(await paymentsOf(made.collection.id)).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await executionStates(made.cart.id)).toEqual([])
      })

      it("a cart that does not exist is left to Mercur's route, which fails reading it (500), as before: the middleware's own reads do not fail on it", async () => {
        const logged = jest.spyOn(container().resolve(ContainerRegistrationKeys.LOGGER), "error")
        const response = await complete("cart_does_not_exist", await newPak())
        expectStatus(response, 500)
        expect(response.data.type).toBe("unknown_error")
        // What failed is Mercur's workflow, reading the cart it did not find.
        expect(logged.mock.calls.map(([e]) => String((e as Error)?.message ?? e))).toContain("Cannot read properties of undefined (reading 'items')")
      })

      stallRetry.it("a cart tagged with a cycle only in its metadata: the guard counts its untagged line as the cycle's, and the sale is not recorded on the cycle", async () => {
        const made = await makeCart({ quantity: 2, cycle: { status: "open", available: 10, sold: 0 }, cycleTag: "cart" })
        const response = await complete(made.cart.id, await newPak())
        expectStatus(response, 200)
        expect(await ordersOf(made.customer.id)).toHaveLength(1)
        await drainSubscribers()
        // Mercur copies each line's metadata onto its orders, never the cart's,
        // so `order-cycle-order-placed` finds no tag on the order or its lines.
        expect(await soldOf(made.cycle!.id)).toEqual([0])
      })

      /**
       * The rental guard is left off the main checkout (operator decision 1,
       * option C; `NOT_RUN_ON_MAIN_CHECKOUT` in
       * `src/workflows/hooks/complete-cart-guards.ts`): the storefront has no
       * rental UI, so a rentable product sells here as an ordinary one, as it
       * did before. The cart is shown to be one the rental guard refuses, on
       * Medusa's own workflow, so the 200 is the guard being off and not an
       * inert fixture.
       */
      stallRetry.it("a product with an active rental configuration sells at the main checkout as an ordinary product, though Medusa's workflow refuses the same cart for it: the rental guard does not run here", async () => {
        const made = await makeCart()
        await upsertRentalConfigWorkflow(container()).run({ input: { product_id: made.product.id, status: "active", min_rental_days: 1 } })
        const refused = await completeCartWorkflow(container()).run({ input: { id: made.cart.id }, throwOnError: false })
        expect((refused.errors ?? []).map((e: any) => e?.error?.message).join(" | ")).toMatch(
          /is for a rentable product but missing required metadata/
        )
        expect(await ordersOf(made.customer.id)).toEqual([])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()

        const response = await complete(made.cart.id, await newPak())
        expectStatus(response, 200)
        expect(await ordersOf(made.customer.id)).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        // And no rental record, as before: Mercur's route makes none.
        expect(await container().resolve(RENTAL_MODULE).listRentals({ customer_id: made.customer.id })).toEqual([])
      })

      /**
       * The CCR guard reads the count the credits route writes into the cart's
       * metadata, and a store client can overwrite cart metadata
       * (`POST /store/carts/:id` takes `metadata`). A count that is not a
       * positive number is read as no reservation, so the cart completes at
       * its full total, the credits left wherever the ledger holds them. The
       * guard is as good as that hint; the ledger escrow is the record.
       */
      stallRetry.it("the CCR guard reads a hint a client can overwrite: a cart whose ccr_credits_reserved reads \"abc\" or -1 is not taken for a reservation and completes", async () => {
        for (const hint of ["abc", -1]) {
          const made = await makeCart({ cartMetadata: { [CCR_RESERVATION_METADATA_KEY]: hint } })
          const response = await complete(made.cart.id, await newPak())
          expectStatus(response, 200)
          expect(await ordersOf(made.customer.id)).toHaveLength(1)
        }
      })

      it("a cart tagged with a cycle only in its metadata, whose line the cycle does not offer, is refused as no longer offered", async () => {
        const made = await makeCart({ cycle: { status: "open", available: 10, sold: 0 }, cycleTag: "cart", cycleOffers: "another variant" })
        const response = await complete(made.cart.id, await newPak())
        await expectRefusedBeforeMercur(response, made, {
          type: "not_allowed",
          message: new RegExp(`^An item in your cart is no longer offered in the order cycle "${escape(made.cycle!.name)}"`),
        })
      })
    })
  },
})
