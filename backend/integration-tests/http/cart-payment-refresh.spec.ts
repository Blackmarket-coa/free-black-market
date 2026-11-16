import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, PromotionActions } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
  updateCartPromotionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import {
  CART_PAYMENT_AMOUNT_MISMATCH,
  CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
} from "../../src/lib/cart-payment-amount"
import { PLAYBOOK_MODULE } from "../../src/modules/playbook"
import { VENDOR_RULES_MODULE } from "../../src/modules/vendor-rules"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows } from "./helpers/stalled-workflows"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(300 * 1000)

/**
 * SD-115: a card is charged what its payment session was opened for, and the
 * session takes the amount of the cart's payment collection. Medusa's own
 * cart workflows keep that collection at the cart's total and delete the
 * sessions opened for an old one. Mercur's shipping-method routes and FBM's
 * tier and wholesale routes changed the total and did neither, so on any
 * multi-seller cart whose buyer picked, changed or removed a delivery option
 * after choosing the card, the card session was opened, or left pending, for
 * an amount that was not the cart's total.
 *
 * This walks those writes through the real store routes on Postgres:
 * Mercur's own routes and workflows, FBM's routes and the middleware in
 * front of them (`src/api/middlewares/cart-payment-refresh.ts`), the real
 * cart, payment, pricing, promotion and fulfillment modules. Only Stripe's
 * API is replaced, on the registered provider instance, so each intent's
 * amount is the one the provider computed.
 *
 * After every such write: the collection's amount is the cart's total, no
 * session for the old amount survives, and opening the card session again
 * (the JS SDK's two calls, as the storefront makes them) creates an intent
 * for the new total. And a completion on a session for another amount, which
 * a stale page or a direct caller of the store API can still attempt, is
 * refused before anything is authorized.
 *
 * State is read from the database, not from the routes' answers. On a tree
 * without the SD-117 fix, Medusa's and Mercur's cart routes write and then
 * answer 500 from the read that builds their response; that is also the path
 * on which the middleware has to notice by itself that the write went
 * through. With that fix the same routes answer 200, and the answer is
 * checked too. So a write through one of those routes is accepted here with
 * either status, and what it did is asserted from the cart.
 *
 * One fixture is not FBM's behaviour: the `order_set.display_id` trigger,
 * for the reason given in cart-completion-refuses.spec.ts.
 */

const CARD = "pp_stripe_stripe"

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    type Intent = { id: string; amount: number; currency: string }
    type Stripe = {
      /** Every intent created, in order: what a card would be charged. */
      intents: Intent[]
      cancel: jest.SpyInstance
      /** `authorizePayment` is a status read of the intent: called once per authorization. */
      retrieve: jest.SpyInstance
    }
    let stripe: Stripe
    let drainSubscribers: () => Promise<void> = async () => {}

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
      const api_ = container().resolve(Modules.PAYMENT).paymentProviderService_.retrieveProvider(CARD).stripe_.paymentIntents
      const intents: Intent[] = []
      const byId = new Map<string, Record<string, unknown>>()
      jest.spyOn(api_, "create").mockImplementation(async (params: any) => {
        const id = `pi_test_cpr_${intents.length + 1}`
        intents.push({ id, amount: params.amount, currency: params.currency })
        const intent = { ...params, id, object: "payment_intent", status: "requires_payment_method", client_secret: `${id}_secret` }
        byId.set(id, intent)
        return intent
      })
      jest.spyOn(api_, "update").mockImplementation(async () => ({}))
      stripe = {
        intents,
        cancel: jest
          .spyOn(api_, "cancel")
          .mockImplementation(async (id: any) => ({ ...(byId.get(id) ?? {}), id, object: "payment_intent", status: "canceled" })),
        // The storefront confirms the card with Stripe before it completes
        // the cart, so by then the intent is waiting to be captured.
        retrieve: jest
          .spyOn(api_, "retrieve")
          .mockImplementation(async (id: any) => ({ ...(byId.get(id) ?? {}), id, object: "payment_intent", status: "requires_capture" })),
      }
      jest
        .spyOn(api_, "capture")
        .mockImplementation(async (id: any) => ({ ...(byId.get(id) ?? {}), id, object: "payment_intent", status: "succeeded" }))
    })

    /**
     * Before the runner's teardown truncates: every subscriber has finished
     * and no workflow execution is left unfinished (see the settlement specs
     * and helpers/drain-subscribers.ts for why it is registered in a
     * describe block).
     */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      jest.restoreAllMocks()
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    /**
     * A region that lists the card provider, a sales channel with a stock
     * location and one service zone, and two sellers, each with a published
     * product whose variant is priced 10.00 and flat-rate shipping options
     * linked to the seller the way Mercur links them: A 5.00; B 7.00 and 9.00.
     */
    async function world() {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const fulfillment = container().resolve(Modules.FULFILLMENT)

      const { result: regions } = await createRegionsWorkflow(container()).run({
        input: { regions: [{ name: "United States", currency_code: "usd", countries: ["us", "ca"], payment_providers: [CARD] }] },
      })
      const region = regions[0]

      const token = await createPublishableKeyToken(getContainer)
      const pak = pakHeaders(token)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["id", "sales_channels.id"], filters: { token } })
      const salesChannelId: string = keys[0].sales_channels[0].id

      const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: `Farm ${uid()}` }])
      await link.create({
        [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
      })
      const set = await fulfillment.createFulfillmentSets({
        name: `Ship ${uid()}`,
        type: "shipping",
        service_zones: [{ name: `US ${uid()}`, geo_zones: [{ type: "country", country_code: "us" }] }],
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      })
      const profile = await fulfillment.createShippingProfiles({ name: `Default ${uid()}`, type: "default" })

      const makeSeller = async () => {
        const id = uid()
        const created = await container().resolve(SELLER_MODULE).createSellers({ name: `Grower ${id}`, handle: `grower-${id}` })
        return (Array.isArray(created) ? created[0] : created) as { id: string }
      }
      const makeOption = async (sellerId: string, amount: number) => {
        const id = uid()
        const { result } = await createShippingOptionsWorkflow(container()).run({
          input: [
            {
              name: `Option ${id}`,
              service_zone_id: set.service_zones[0].id,
              shipping_profile_id: profile.id,
              provider_id: "manual_manual",
              price_type: "flat",
              type: { label: "Standard", description: "Standard", code: `std-${id}` },
              prices: [{ currency_code: "usd", amount }],
              rules: [],
            } as any,
          ],
        })
        await link.create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.FULFILLMENT]: { shipping_option_id: result[0].id } })
        return result[0] as { id: string }
      }
      const makeProduct = async (sellerId: string) => {
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
        await link.create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
        await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId } })
        await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.FULFILLMENT]: { shipping_profile_id: profile.id } })
        const [priceSet] = await container().resolve(Modules.PRICING).createPriceSets([{ prices: [{ amount: 10, currency_code: "usd" }] }])
        await link.create({ [Modules.PRODUCT]: { variant_id: product.variants[0].id }, [Modules.PRICING]: { price_set_id: priceSet.id } })
        return product as { id: string; title: string; variants: Array<{ id: string }> }
      }

      const sellerA = await makeSeller()
      const sellerB = await makeSeller()
      const productA = await makeProduct(sellerA.id)
      const productB = await makeProduct(sellerB.id)
      const optionA = await makeOption(sellerA.id, 5)
      const optionB = await makeOption(sellerB.id, 7)
      const optionB2 = await makeOption(sellerB.id, 9)

      /** A cart with an address, holding one 10.00 line per product given. */
      const makeCart = async (products: Array<typeof productA>, extra: Record<string, unknown> = {}) => {
        const [cart] = await container().resolve(Modules.CART).createCarts([
          {
            currency_code: "usd",
            region_id: region.id,
            sales_channel_id: salesChannelId,
            email: `buyer-${uid()}@example.com`,
            shipping_address: { first_name: "Ada", last_name: "Buyer", address_1: "1 Main St", city: "Atlanta", postal_code: "30301", country_code: "us" },
            items: products.map((p) => ({
              title: p.title,
              product_id: p.id,
              variant_id: p.variants[0].id,
              quantity: 1,
              unit_price: 10,
              requires_shipping: true,
            })),
            ...extra,
          },
        ])
        return cart as { id: string; email: string }
      }

      return { pak, region, salesChannelId, sellerA, sellerB, productA, productB, optionA, optionB, optionB2, makeCart }
    }
    type World = Awaited<ReturnType<typeof world>>

    type CartState = {
      total: number
      shipping_total: number
      methods: Array<{ id: string; option: string; amount: number }>
      collection: number | null
      sessions: Array<{ id: string; amount: number; status: string }>
    }
    /** In process, the query serves money as Medusa's BigNumber; over HTTP it is serialized to this number. */
    const num = (value: unknown): number => Number(value)
    /** The cart as the database has it. */
    async function stateOf(cartId: string): Promise<CartState> {
      const { data } = await container().resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "cart",
        fields: [
          "id",
          "total",
          "shipping_total",
          "shipping_methods.id",
          "shipping_methods.shipping_option_id",
          "shipping_methods.amount",
          "payment_collection.id",
          "payment_collection.amount",
          "payment_collection.payment_sessions.id",
          "payment_collection.payment_sessions.amount",
          "payment_collection.payment_sessions.status",
        ],
        filters: { id: cartId },
      })
      const row = data[0]
      return {
        total: num(row.total),
        shipping_total: num(row.shipping_total),
        methods: (row.shipping_methods ?? []).map((m: any) => ({ id: m.id, option: m.shipping_option_id, amount: num(m.amount) })),
        collection: row.payment_collection ? num(row.payment_collection.amount) : null,
        sessions: (row.payment_collection?.payment_sessions ?? []).map((s: any) => ({ id: s.id, amount: num(s.amount), status: s.status })),
      }
    }

    type Answer = { status: number; data: any }
    const answerOf = (e: any): Answer => e.response

    /**
     * A write through one of Medusa's or Mercur's cart routes. 200 with the
     * SD-117 fix; without it the write goes through and the route's own read
     * of the cart answers 500 (see the header). Anything else is a refusal
     * and fails here with the route's body.
     */
    function expectWritten(answer: Answer): Answer {
      if (answer.status !== 200 && answer.status !== 500) {
        throw new Error(`expected the write to go through, the route answered ${answer.status}: ${JSON.stringify(answer.data)}`)
      }
      return answer
    }
    function expectStatus(answer: Answer, status: number): Answer {
      if (answer.status !== status) {
        throw new Error(`expected ${status}, the route answered ${answer.status}: ${JSON.stringify(answer.data)}`)
      }
      return answer
    }

    /** setShippingMethod (storefront/src/lib/data/cart.ts): Mercur's route. */
    const pickShipping = async (w: World, cartId: string, optionId: string) =>
      expectWritten(await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: optionId }, w.pak).catch(answerOf))
    /** removeShippingMethod: Mercur's route, the ids in the body. */
    const removeShipping = async (w: World, pathCartId: string, methodIds: string[]) =>
      expectWritten(
        await api.delete(`/store/carts/${pathCartId}/shipping-methods`, { ...w.pak, data: { shipping_method_ids: methodIds } }).catch(answerOf)
      )
    /** initiatePaymentSession: the JS SDK creates a collection only when the cart has none. */
    const openCardSession = async (w: World, cartId: string) => {
      const { data } = await container().resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "cart",
        fields: ["id", "payment_collection.id"],
        filters: { id: cartId },
      })
      let collectionId: string | undefined = data[0].payment_collection?.id
      if (!collectionId) {
        collectionId = expectStatus(await api.post(`/store/payment-collections`, { cart_id: cartId }, w.pak).catch(answerOf), 200).data
          .payment_collection.id
      }
      expectStatus(
        await api.post(`/store/payment-collections/${collectionId}/payment-sessions`, { provider_id: CARD }, w.pak).catch(answerOf),
        200
      )
    }
    const complete = async (w: World, cartId: string) => api.post(`/store/carts/${cartId}/complete`, {}, w.pak).catch(answerOf)

    const lastIntent = () => stripe.intents[stripe.intents.length - 1]
    /** In step: the collection is for the cart's total and nothing is pending for another amount. */
    function expectInStep(state: CartState, total: number) {
      expect(state.total).toBe(total)
      expect(state.collection).toBe(total)
      expect(state.sessions.filter((s) => s.amount !== total)).toEqual([])
    }

    async function orderSetsOf(cartId: string) {
      const { data } = await container()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order_set", fields: ["id", "cart_id"], filters: { cart_id: cartId } })
      return data as Array<{ id: string }>
    }

    describe("Mercur's shipping-method routes on a multi-seller cart (SD-115)", () => {
      afterEach(settleBeforeTeardown)

      it("a delivery option changed after the card was chosen: the collection follows the total, the old session is gone, and the next one is for the new total", async () => {
        const w = await world()
        const cart = await w.makeCart([w.productA, w.productB])

        // A first straight pass: no collection exists until the payment step.
        await pickShipping(w, cart.id, w.optionA.id)
        await pickShipping(w, cart.id, w.optionB.id)
        expect(await stateOf(cart.id)).toMatchObject({ total: 32, shipping_total: 12, collection: null })
        await openCardSession(w, cart.id)
        const paid = await stateOf(cart.id)
        expectInStep(paid, 32)
        expect(paid.sessions).toHaveLength(1)
        expect(stripe.intents).toEqual([{ id: "pi_test_cpr_1", amount: 3200, currency: "usd" }])

        // The buyer goes back to Delivery and takes seller B's other option.
        // Medusa's workflow inside Mercur's refreshes the collection to the
        // items plus that one option (29); Mercur then re-adds seller A's.
        const answer = await pickShipping(w, cart.id, w.optionB2.id)
        const changed = await stateOf(cart.id)
        expect(changed.methods.map((m) => m.amount).sort()).toEqual([5, 9])
        expectInStep(changed, 34)
        expect(changed.sessions).toEqual([])
        expect(stripe.cancel).toHaveBeenCalledWith("pi_test_cpr_1", expect.anything())
        if (answer.status === 200) {
          // The answer carries the collection as the refresh left it.
          expect(answer.data.cart.total).toBe(34)
          expect(answer.data.cart.payment_collection.amount).toBe(34)
          expect(answer.data.cart.payment_collection.payment_sessions ?? []).toEqual([])
        }

        // Choosing the card again charges what the cart totals.
        await openCardSession(w, cart.id)
        const repaid = await stateOf(cart.id)
        expectInStep(repaid, 34)
        expect(repaid.sessions).toEqual([{ id: expect.any(String), amount: 34, status: "pending" }])
        expect(lastIntent()).toMatchObject({ amount: 3400, currency: "usd" })
      })

      it("a delivery option removed: the session for the old total does not survive, and the next one is for the new total", async () => {
        const w = await world()
        const cart = await w.makeCart([w.productA, w.productB])
        await pickShipping(w, cart.id, w.optionA.id)
        await pickShipping(w, cart.id, w.optionB.id)
        await openCardSession(w, cart.id)
        const paid = await stateOf(cart.id)
        expectInStep(paid, 32)
        expect(paid.sessions).toHaveLength(1)

        const methodA = paid.methods.find((m) => m.option === w.optionA.id)!
        const answer = await removeShipping(w, cart.id, [methodA.id])
        const removed = await stateOf(cart.id)
        expect(removed.methods.map((m) => m.option)).toEqual([w.optionB.id])
        expectInStep(removed, 27)
        expect(removed.sessions).toEqual([])
        expect(stripe.cancel).toHaveBeenCalledWith("pi_test_cpr_1", expect.anything())
        if (answer.status === 200) {
          expect(answer.data.cart.payment_collection.amount).toBe(27)
          expect(answer.data.cart.payment_collection.payment_sessions ?? []).toEqual([])
        }

        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 27)
        expect(lastIntent()).toMatchObject({ amount: 2700 })
      })

      it("a method removed through another cart's path: Mercur's route removes it all the same, and the cart that held it is the one refreshed", async () => {
        const w = await world()
        const cart = await w.makeCart([w.productA, w.productB])
        const bystander = await w.makeCart([w.productA])
        await pickShipping(w, cart.id, w.optionA.id)
        await pickShipping(w, cart.id, w.optionB.id)
        await openCardSession(w, cart.id)
        await pickShipping(w, bystander.id, w.optionA.id)
        await openCardSession(w, bystander.id)
        const before = await stateOf(cart.id)
        expectInStep(await stateOf(bystander.id), 15)

        const methodB = before.methods.find((m) => m.option === w.optionB.id)!
        await removeShipping(w, bystander.id, [methodB.id])

        const after = await stateOf(cart.id)
        expect(after.methods.map((m) => m.option)).toEqual([w.optionA.id])
        expectInStep(after, 25)
        expect(after.sessions).toEqual([])
        // The cart in the path was not written, and its session stands.
        const untouched = await stateOf(bystander.id)
        expectInStep(untouched, 15)
        expect(untouched.sessions).toHaveLength(1)
      })

      it("reach payment, go back, add another seller's item, pick its delivery: the collection follows each step", async () => {
        const w = await world()
        const cart = await w.makeCart([w.productA])
        await pickShipping(w, cart.id, w.optionA.id)
        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 15)
        expect(lastIntent()).toMatchObject({ amount: 1500 })

        // The storefront's add-to-cart: Medusa's own route, which refreshes.
        expectWritten(
          await api.post(`/store/carts/${cart.id}/line-items`, { variant_id: w.productB.variants[0].id, quantity: 1 }, w.pak).catch(answerOf)
        )
        const added = await stateOf(cart.id)
        expectInStep(added, 25)
        expect(added.sessions).toEqual([])

        // Seller B's delivery, through Mercur's route: seller A's method is
        // re-added after Medusa's refresh has run.
        await pickShipping(w, cart.id, w.optionB.id)
        const picked = await stateOf(cart.id)
        expect(picked.methods.map((m) => m.amount).sort()).toEqual([5, 7])
        expectInStep(picked, 32)

        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 32)
        expect(lastIntent()).toMatchObject({ amount: 3200 })
      })

      it("a seller's line removed through Mercur's route, when its shipping method is removed after Medusa's refresh has read the total: the collection still ends at the total", async () => {
        const w = await world()
        const cart = await w.makeCart([w.productA, w.productB])
        await pickShipping(w, cart.id, w.optionA.id)
        await pickShipping(w, cart.id, w.optionB.id)
        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 32)

        // Mercur's delete-seller-line-item runs "remove the seller's shipping
        // method" beside Medusa's deleteLineItemsWorkflow, whose last step
        // refreshes the collection. Nothing orders the two. Left alone the
        // removal wins (it is one statement); here it is held back until the
        // refresh inside Medusa's workflow has run, which is the other order.
        const carts = container().resolve(Modules.CART)
        const softDelete = carts.softDeleteShippingMethods.bind(carts)
        let refreshed: () => void = () => {}
        const refreshRan = new Promise<void>((resolve) => (refreshed = resolve))
        const payments = container().resolve(Modules.PAYMENT)
        const updateCollections = payments.updatePaymentCollections.bind(payments)
        jest.spyOn(payments, "updatePaymentCollections").mockImplementation(async (...args: any[]) => {
          const result = await updateCollections(...args)
          refreshed()
          return result
        })
        const held = jest.spyOn(carts, "softDeleteShippingMethods").mockImplementation(async (...args: any[]) => {
          await Promise.race([refreshRan, new Promise((resolve) => setTimeout(resolve, 8000))])
          return softDelete(...args)
        })

        const { data: lines } = await container()
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "cart", fields: ["id", "items.id", "items.product_id"], filters: { id: cart.id } })
        const lineB = lines[0].items.find((i: any) => i.product_id === w.productB.id)
        expectStatus(await api.delete(`/store/carts/${cart.id}/line-items/${lineB.id}`, w.pak).catch(answerOf), 200)
        expect(held).toHaveBeenCalled()

        const after = await stateOf(cart.id)
        expect(after.methods.map((m) => m.option)).toEqual([w.optionA.id])
        expectInStep(after, 15)
        expect(after.sessions).toEqual([])
      })
    })

    describe("promotion codes: the routes that are not behind the middleware", () => {
      afterEach(settleBeforeTeardown)

      it("Mercur's POST /store/carts/:id/promotions cannot write on this version; Medusa's DELETE, which the storefront removes a code with, refreshes by itself", async () => {
        const w = await world()
        await container().resolve(Modules.PROMOTION).createPromotions([
          {
            code: "SAVE10",
            type: "standard",
            status: "active",
            application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10, currency_code: "usd" },
          },
        ])
        const cart = await w.makeCart([w.productA])
        await updateCartPromotionsWorkflow(container()).run({
          input: { cart_id: cart.id, promo_codes: ["SAVE10"], action: PromotionActions.ADD },
        })
        await pickShipping(w, cart.id, w.optionA.id)
        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 14)

        // Mercur overrides Medusa's POST with a route that runs
        // updateCartPromotionsWorkflow without the flag that makes it refresh
        // the payment collection, which would make it a third writer of the
        // kind this spec is about. It never gets that far: it runs the
        // workflow without a container, and the run fails on "Could not
        // resolve 'query'". An empty list is what would strip the cart's
        // codes and raise its total.
        //
        // If this starts failing because the route now writes, it needs an
        // entry in cartPaymentMiddlewareRoutes
        // (src/api/middlewares/cart-payment-refresh.ts) and its own case here.
        expectStatus(await api.post(`/store/carts/${cart.id}/promotions`, { promo_codes: [] }, w.pak).catch(answerOf), 500)
        const kept = await stateOf(cart.id)
        expectInStep(kept, 14)
        expect(kept.sessions).toHaveLength(1)

        // The storefront's deletePromotionCode: Medusa's own route.
        expectWritten(
          await api.delete(`/store/carts/${cart.id}/promotions`, { ...w.pak, data: { promo_codes: ["SAVE10"] } }).catch(answerOf)
        )
        const removed = await stateOf(cart.id)
        expectInStep(removed, 15)
        expect(removed.sessions).toEqual([])
      })
    })

    describe("FBM's tier and wholesale routes (SD-115)", () => {
      afterEach(settleBeforeTeardown)

      const adjustmentsOf = async (cartId: string): Promise<number[]> => {
        const carts = container().resolve(Modules.CART)
        const items = await carts.listLineItems({ cart_id: cartId }, { select: ["id"] })
        const rows = await carts.listLineItemAdjustments({ item_id: items.map((i: { id: string }) => i.id) }, { select: ["id", "amount"] })
        return rows.map((a: { amount: unknown }) => Number(a.amount))
      }
      const unitPricesOf = async (cartId: string): Promise<number[]> =>
        (await container().resolve(Modules.CART).listLineItems({ cart_id: cartId }, { select: ["id", "unit_price"] })).map(
          (i: { unit_price: unknown }) => Number(i.unit_price)
        )

      it("POST /store/carts/:id/tier: the line is repriced, its promotion is computed again from the new price, the collection follows, and the old session is gone", async () => {
        const w = await world()
        // Sliding scale is the seller's choice: a playbook that allows it.
        await container().resolve(PLAYBOOK_MODULE).createPlaybookAssignments({
          seller_id: w.sellerA.id,
          playbook_id: `pb_${uid()}`,
          recipe_id: "atelier",
          assigned_at: new Date(),
        })
        await container().resolve(Modules.PROMOTION).createPromotions([
          {
            code: "SAVE10",
            type: "standard",
            status: "active",
            application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10, currency_code: "usd" },
          },
        ])
        const cart = await w.makeCart([w.productA])
        await updateCartPromotionsWorkflow(container()).run({
          input: { cart_id: cart.id, promo_codes: ["SAVE10"], action: PromotionActions.ADD },
        })
        await pickShipping(w, cart.id, w.optionA.id)
        await openCardSession(w, cart.id)
        // 10.00 less 10%, plus 5.00 delivery.
        expect(await adjustmentsOf(cart.id)).toEqual([1])
        expectInStep(await stateOf(cart.id), 14)
        expect(lastIntent()).toMatchObject({ amount: 1400 })

        const answer = expectStatus(await api.post(`/store/carts/${cart.id}/tier`, { tier: "solidarity" }, w.pak).catch(answerOf), 200)
        expect(answer.data).toEqual({ cart_id: cart.id, tier: "solidarity", line_items_repriced: 1 })

        // Solidarity is 65% of the listed price. The promotion is 10% of
        // what the line now costs, not of what it cost when it was applied.
        expect(await unitPricesOf(cart.id)).toEqual([6.5])
        expect(await adjustmentsOf(cart.id)).toEqual([0.65])
        const repriced = await stateOf(cart.id)
        expectInStep(repriced, 10.85)
        expect(repriced.sessions).toEqual([])
        expect(stripe.cancel).toHaveBeenCalledWith("pi_test_cpr_1", expect.anything())

        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 10.85)
        expect(lastIntent()).toMatchObject({ amount: 1085 })
      })

      it("POST /store/carts/:id/wholesale: the same after a wholesale reprice", async () => {
        const w = await world()
        const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${uid()}@example.com` }])
        await container().resolve(VENDOR_RULES_MODULE).createVendorCustomerTiers({
          seller_id: w.sellerA.id,
          tier_type: "WHOLESALE",
          name: "Wholesale",
          discount_percent: 20,
          waive_order_minimum: true,
          customer_ids: [customer.id],
        })
        const cart = await w.makeCart([w.productA], { customer_id: customer.id, email: customer.email })
        await pickShipping(w, cart.id, w.optionA.id)
        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 15)
        expect(lastIntent()).toMatchObject({ amount: 1500 })

        const answer = expectStatus(await api.post(`/store/carts/${cart.id}/wholesale`, {}, w.pak).catch(answerOf), 200)
        expect(answer.data).toMatchObject({ cart_id: cart.id, applied: true, line_items_repriced: 1 })

        expect(await unitPricesOf(cart.id)).toEqual([8])
        const repriced = await stateOf(cart.id)
        expectInStep(repriced, 13)
        expect(repriced.sessions).toEqual([])
        expect(stripe.cancel).toHaveBeenCalledWith("pi_test_cpr_1", expect.anything())

        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 13)
        expect(lastIntent()).toMatchObject({ amount: 1300 })
      })
    })

    describe("POST /store/carts/:id/complete on a session for another amount (SD-115)", () => {
      afterEach(settleBeforeTeardown)

      it("is refused with 409 before anything is authorized, no order is created, and the cart is left ready to be paid at its total", async () => {
        const w = await world()
        const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${uid()}@example.com` }])
        const cart = await w.makeCart([w.productA, w.productB], { customer_id: customer.id, email: customer.email })
        await pickShipping(w, cart.id, w.optionA.id)
        await pickShipping(w, cart.id, w.optionB.id)
        await openCardSession(w, cart.id)
        expectInStep(await stateOf(cart.id), 32)

        // A total changed with nothing run after it: a write that goes round
        // every route, standing in for a writer nobody has found yet and for
        // a refresh that failed. The cart now totals more than its session.
        const carts = container().resolve(Modules.CART)
        const [line] = await carts.listLineItems({ cart_id: cart.id }, { select: ["id"], take: 1 })
        await carts.updateLineItems(line.id, { unit_price: 14, is_custom_price: true })
        const stale = await stateOf(cart.id)
        expect(stale).toMatchObject({ total: 36, collection: 32 })
        expect(stale.sessions).toEqual([{ id: expect.any(String), amount: 32, status: "pending" }])

        const refused = expectStatus(await complete(w, cart.id), 409)
        expect(refused.data).toEqual({
          code: CART_PAYMENT_AMOUNT_MISMATCH,
          type: CART_PAYMENT_AMOUNT_MISMATCH,
          message: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
        })
        expect(JSON.stringify(refused.data)).not.toContain(cart.id)
        // Nothing was authorized and nothing was ordered.
        expect(stripe.retrieve).not.toHaveBeenCalled()
        expect(await orderSetsOf(cart.id)).toEqual([])
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toEqual([])
        expect((await carts.retrieveCart(cart.id)).completed_at ?? null).toBeNull()
        // The refusal put the payment side right: the session is deleted
        // (its intent cancelled) and the collection is for the total.
        const healed = await stateOf(cart.id)
        expectInStep(healed, 36)
        expect(healed.sessions).toEqual([])
        expect(stripe.cancel).toHaveBeenCalledWith("pi_test_cpr_1", expect.anything())

        // So the message's instruction works: choosing the card again opens
        // a session for the total, and that completes.
        await openCardSession(w, cart.id)
        expect(lastIntent()).toMatchObject({ amount: 3600 })
        const completed = expectStatus(await complete(w, cart.id), 200)
        expect(completed.data.order_set?.id).toBeTruthy()
        expect(stripe.retrieve).toHaveBeenCalledTimes(1)
        expect(await orderSetsOf(cart.id)).toHaveLength(1)
        expect(await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })).toHaveLength(2)
      })

      it("a cart whose collection was refreshed and whose page still holds the old session cannot complete on it either: the session no longer exists", async () => {
        const w = await world()
        const cart = await w.makeCart([w.productA])
        await pickShipping(w, cart.id, w.optionA.id)
        await openCardSession(w, cart.id)
        await container().resolve(Modules.CART).updateLineItems(
          (await container().resolve(Modules.CART).listLineItems({ cart_id: cart.id }, { select: ["id"], take: 1 }))[0].id,
          { unit_price: 4, is_custom_price: true }
        )
        await refreshPaymentCollectionForCartWorkflow(container()).run({ input: { cart_id: cart.id } })
        expect((await stateOf(cart.id)).sessions).toEqual([])

        // Mercur's own refusal, kept as it is: there is no session to pay with.
        const answer = expectStatus(await complete(w, cart.id), 400)
        expect(answer.data.code).not.toBe(CART_PAYMENT_AMOUNT_MISMATCH)
        expect(await orderSetsOf(cart.id)).toEqual([])
      })
    })
  },
})
