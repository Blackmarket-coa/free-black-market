import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { CCR_RESERVATION_METADATA_KEY } from "../../src/lib/ccr-checkout"
import { ORDER_CYCLE_MODULE } from "../../src/modules/order-cycle"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows } from "./helpers/stalled-workflows"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * SD-54: the guards on `completeCartWorkflow.hooks.validate`
 * (`src/workflows/hooks/complete-cart-validate.ts`) run on a real cart
 * completion, on a real migrated database, with the argument Medusa 2.14.2
 * actually hands the hook.
 *
 * Medusa calls the hook with `{ input, cart }`, `input` being the workflow's
 * own input, `{ id }` (`@medusajs/core-flows` `cart/workflows/complete-cart.js`,
 * `createHook("validate", { input, cart: cartData.data })`). The Coalition
 * Credits reservation guard and the order-cycle guard read `input.cart_id`,
 * found nothing, and returned before reading the cart, so neither ran at any
 * checkout; their unit specs handed them the shape the code read. Nothing here
 * hands a guard its argument: each test runs Medusa's own workflow (or an FBM
 * store route that nests it) on a cart, and reads what was written.
 *
 * The cart is paid through Medusa's built-in system provider, so a refusal can
 * be shown to land before the card step: no payment exists afterwards.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    let drainSubscribers: () => Promise<void> = async () => {}
    beforeEach(() => {
      drainSubscribers = trackSubscribers(container)
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })

    /**
     * Before the runner's teardown: subscribers drained and no execution left
     * unfinished (helpers/stalled-workflows.ts). Registered inside the
     * describe block so it runs before the runner's own afterEach.
     */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    async function makeProduct(salesChannelId: string) {
      const id = uid()
      const [product] = await container().resolve(Modules.PRODUCT).createProducts([
        {
          title: `Greens ${id}`,
          handle: `greens-${id}`,
          status: "published",
          options: [{ title: "Size", values: ["Bunch"] }],
          variants: [{ title: "Bunch", manage_inventory: false, options: { Size: "Bunch" } }],
        },
      ])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
      })
      return product as { id: string; title: string; variants: Array<{ id: string }> }
    }

    /**
     * An order cycle in `status`, offering `variantId` with the given capacity
     * (`available: null` is unlimited).
     *
     * One fixture is not FBM's behaviour, and says so. The cycle's product row
     * is written with SQL, not `createOrderCycleProducts`: on a database built
     * by the migrations, as this one is, that insert fails with
     * `column "raw_override_price" of relation "order_cycle_product" does not
     * exist` (seen here first). `override_price` is a `model.bigNumber()`, whose
     * raw column Medusa names `raw_override_price`; `Migration20251227015616`
     * created the pair as `price_override` / `raw_price_override`, and
     * `Migration20251227174700` renamed only the first. Reads are not affected
     * (the guard's `listOrderCycleProducts` read of a row written this way
     * works: the capacity test below is refused by it), so the guard's checks
     * do not depend on it. The drift is reported separately (SD-54 follow-up);
     * whether production's table has the column is not visible from the tree.
     */
    async function makeCycle(variantId: string, spec: { status: string; available: number | null; sold: number }) {
      const cycles = container().resolve(ORDER_CYCLE_MODULE)
      const now = Date.now()
      const cycle = await cycles.createOrderCycles({
        name: `Week ${uid()}`,
        opens_at: new Date(now - 86_400_000),
        closes_at: new Date(now + 86_400_000),
        dispatch_at: new Date(now + 2 * 86_400_000),
        status: spec.status,
        coordinator_seller_id: `sel_${uid()}`,
      })
      await container().resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(
        `INSERT INTO order_cycle_product (id, order_cycle_id, variant_id, seller_id, available_quantity, sold_quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`ocp_${uid()}`, cycle.id, variantId, `sel_${uid()}`, spec.available, spec.sold]
      )
      return cycle as { id: string; name: string }
    }

    /**
     * A customer's cart holding `quantity` of one product at $5.00, with a
     * system-provider payment session opened for its total. With `cycle`, the
     * product is offered in a new order cycle and the line carries that
     * cycle's id in `metadata.order_cycle_id`, as the storefront's cycle
     * add-to-cart writes it (`storefront/src/lib/data/order-cycles.ts`).
     * `cartMetadata` is written onto the cart as a client could write it.
     */
    async function makeCart(opts: {
      quantity?: number
      cartMetadata?: Record<string, unknown>
      cycle?: { status: string; available: number | null; sold: number }
    } = {}) {
      const id = uid()
      const quantity = opts.quantity ?? 1
      const unitPrice = 5
      const [channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${id}` }])
      const product = await makeProduct(channel.id)
      const cycle = opts.cycle ? await makeCycle(product.variants[0].id, opts.cycle) : null
      const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${id}@example.com` }])
      const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
      const [cart] = await container().resolve(Modules.CART).createCarts([
        {
          currency_code: "usd",
          region_id: region.id,
          sales_channel_id: channel.id,
          customer_id: customer.id,
          email: customer.email,
          metadata: opts.cartMetadata,
          items: [
            {
              title: product.title,
              product_id: product.id,
              variant_id: product.variants[0].id,
              quantity,
              unit_price: unitPrice,
              requires_shipping: false,
              metadata: cycle ? { order_cycle_id: cycle.id } : undefined,
            },
          ],
        },
      ])
      const total = unitPrice * quantity
      const payments = container().resolve(Modules.PAYMENT)
      const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: total }])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.CART]: { cart_id: cart.id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      })
      await payments.createPaymentSession(collection.id, {
        provider_id: "pp_system_default",
        amount: total,
        currency_code: "usd",
        data: {},
      })
      return { cart, customer, collection, cycle }
    }

    /** Medusa's own workflow, run as FBM's completeCartWorkflow-based checkouts run it: input `{ id }`. */
    async function completeCart(cartId: string) {
      const { result, errors } = await completeCartWorkflow(container()).run({
        input: { id: cartId },
        throwOnError: false,
      })
      return { orderId: (result as { id?: string } | undefined)?.id, errors: errors ?? [] }
    }

    async function ordersOf(customerId: string) {
      return container().resolve(Modules.ORDER).listOrders({ customer_id: customerId })
    }
    async function paymentsOf(collectionId: string) {
      return container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collectionId })
    }
    const messages = (errors: Array<{ error?: { message?: string } }>) => errors.map((e) => e?.error?.message ?? "").join(" | ")

    /**
     * The first completion of a re-run test yielded an order. Medusa 2.14.2's
     * engine can stop a completion after it wrote the order and before it
     * authorized the payment, with no error and no order id handed back
     * (SD-53, `lib/cart-completion.ts`); seen once here on a loaded machine,
     * where the test then failed reading a payment that was never made. That
     * is not what these tests are about, so it fails here, by name.
     */
    function expectFirstCompletion(first: { orderId?: string; errors: Array<{ error?: { message?: string } }> }) {
      expect(messages(first.errors)).toBe("")
      if (!first.orderId) {
        throw new Error("The first completion handed back no order id: the SD-53 engine stall, not a guard result. Re-run the spec.")
      }
    }

    describe("completeCartWorkflow.hooks.validate on a real cart completion (SD-54)", () => {
      afterEach(settleBeforeTeardown)

      it("a cart on an open cycle, inside capacity, with no credits reserved completes into an order: the fixture is a cart that completes", async () => {
        // The control for every refusal below: the same fixture, with nothing
        // a guard refuses, completes through the same workflow and is paid.
        const { cart, customer, collection } = await makeCart({ quantity: 2, cycle: { status: "open", available: 10, sold: 0 } })

        const { orderId, errors } = await completeCart(cart.id)
        expect(messages(errors)).toBe("")
        expect(orderId).toBeTruthy()
        expect((await ordersOf(customer.id)).map((o: { id: string }) => o.id)).toEqual([orderId])
        expect(await paymentsOf(collection.id)).toHaveLength(1)
      })

      it("a cart holding a Coalition Credits reservation is refused before any order or payment exists", async () => {
        const { cart, customer, collection } = await makeCart({ cartMetadata: { [CCR_RESERVATION_METADATA_KEY]: 3 } })

        const { orderId, errors } = await completeCart(cart.id)
        expect(orderId).toBeUndefined()
        expect(messages(errors)).toMatch(/3 Coalition Credits reserved, and credit tender is not yet wired into payment/)
        expect(await ordersOf(customer.id)).toEqual([])
        expect(await paymentsOf(collection.id)).toEqual([])
        expect((await container().resolve(Modules.CART).retrieveCart(cart.id)).completed_at ?? null).toBeNull()
      })

      it("a cart for an order cycle that has closed is refused before any order or payment exists (D9-3)", async () => {
        const { cart, customer, collection, cycle } = await makeCart({ cycle: { status: "closed", available: 10, sold: 0 } })

        const { orderId, errors } = await completeCart(cart.id)
        expect(orderId).toBeUndefined()
        expect(messages(errors)).toMatch(new RegExp(`"${cycle!.name}" is closed and is no longer taking orders`))
        expect(await ordersOf(customer.id)).toEqual([])
        expect(await paymentsOf(collection.id)).toEqual([])
      })

      it("a cart asking for more than the cycle has left is refused, reading the cycle's real stock (D9-1)", async () => {
        const { cart, customer, collection, cycle } = await makeCart({ quantity: 2, cycle: { status: "open", available: 10, sold: 9 } })

        const { orderId, errors } = await completeCart(cart.id)
        expect(orderId).toBeUndefined()
        expect(messages(errors)).toMatch(new RegExp(`Only 1 left of an item in your cart for "${cycle!.name}", and you have 2`))
        expect(await ordersOf(customer.id)).toEqual([])
        expect(await paymentsOf(collection.id)).toEqual([])
      })

      it("an FBM store checkout built on completeCartWorkflow refuses the same cart: POST /store/carts/:id/complete-tickets answers 400", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const { cart, customer, collection } = await makeCart({ cartMetadata: { [CCR_RESERVATION_METADATA_KEY]: 2 } })

        const response = await api.post(`/store/carts/${cart.id}/complete-tickets`, {}, pak).catch((e: any) => e.response)
        expect(response.status).toBe(400)
        expect(String(response.data?.message)).toMatch(/2 Coalition Credits reserved/)
        expect(await ordersOf(customer.id)).toEqual([])
        expect(await paymentsOf(collection.id)).toEqual([])
      })

      /**
       * Medusa runs the validate hook on every run of `completeCartWorkflow`,
       * before it looks at the cart's existing order (`createHook("validate")`
       * comes before `when("create-order", ...)`), so a re-run on a cart that
       * already completed runs the hook again: a retried checkout, the digital
       * and subscription replays with their flag off, Medusa's payment
       * webhook. Before SD-54 the CCR and order-cycle guards did not run, and
       * a re-run handed the order back; it must still. With the guards running
       * and no `cartAlreadyCompleted` check (`workflows/hooks/
       * complete-cart-guards.ts`), the order-cycle guard refused these re-runs
       * against state the first completion had changed, and the refusal ran
       * the workflow's `compensatePaymentIfNeededStep` compensation, which
       * refunds a captured payment (seen in review; the first two tests are
       * adapted from the reviewer's reference commit). With the check removed,
       * each re-run test below fails on the guard's refusal. The refund
       * assertions do not discriminate on their own here: in review, with the
       * system provider, the compensation was attempted and failed before it
       * wrote a refund row (step state `failed`, no refunds), so it is the
       * refusal that shows the check is missing.
       */
      it("a re-run on a completed cart whose own sale used up the cycle's stock hands back its order", async () => {
        const { cart, customer, cycle } = await makeCart({ quantity: 2, cycle: { status: "open", available: 2, sold: 0 } })
        const first = await completeCart(cart.id)
        expectFirstCompletion(first)
        await drainSubscribers()
        // `order-cycle-order-placed` has recorded the sale: nothing is left.
        const { rows } = await container().resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(
          `SELECT sold_quantity FROM order_cycle_product WHERE order_cycle_id = ?`,
          [cycle!.id]
        )
        expect(rows).toEqual([{ sold_quantity: 2 }])

        const again = await completeCart(cart.id)
        expect(messages(again.errors)).toBe("")
        expect(again.orderId).toBe(first.orderId)
        expect((await ordersOf(customer.id)).map((o: { id: string }) => o.id)).toEqual([first.orderId])
      })

      it("a re-run on a completed, captured cart whose cycle has since dispatched hands back its order and refunds nothing", async () => {
        const { cart, collection, cycle } = await makeCart({ quantity: 1, cycle: { status: "open", available: 10, sold: 0 } })
        const first = await completeCart(cart.id)
        expectFirstCompletion(first)
        await drainSubscribers()
        const payments = container().resolve(Modules.PAYMENT)
        const [payment] = await paymentsOf(collection.id)
        await payments.capturePayment({ payment_id: payment.id })
        await container().resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(
          `UPDATE order_cycle SET status = 'dispatched' WHERE id = ?`,
          [cycle!.id]
        )

        const again = await completeCart(cart.id)
        await drainSubscribers()
        expect(messages(again.errors)).toBe("")
        expect(again.orderId).toBe(first.orderId)
        expect(await payments.listRefunds({ payment_id: payment.id })).toEqual([])
      })

      /**
       * The check covers every guard in the composition, not only the
       * order-cycle one: a cart completed by Medusa's workflow (so it has an
       * `order_cart` link) gets its order back on a re-run, whatever metadata
       * is written onto it afterwards, here a Coalition Credits reservation.
       *
       * This is NOT the state Medusa's payment webhook reads on a cart that
       * Mercur's main checkout completed. That cart has no `order_cart` link,
       * so with this check Medusa's workflow skips the guards and goes into
       * order creation, where its own steps (validateShippingStep, in a scratch
       * run) refuse it and the refund compensation runs. The check only moves
       * that refusal; it does not protect that path (SD-72 (b)).
       */
      it("a re-run on a completed, captured cart that carries a Coalition Credits reservation hands back its order and refunds nothing", async () => {
        const { cart, collection } = await makeCart()
        const first = await completeCart(cart.id)
        expectFirstCompletion(first)
        await drainSubscribers()
        const payments = container().resolve(Modules.PAYMENT)
        const [payment] = await paymentsOf(collection.id)
        await payments.capturePayment({ payment_id: payment.id })
        await container().resolve(Modules.CART).updateCarts(cart.id, { metadata: { [CCR_RESERVATION_METADATA_KEY]: 3 } })

        const again = await completeCart(cart.id)
        await drainSubscribers()
        expect(messages(again.errors)).toBe("")
        expect(again.orderId).toBe(first.orderId)
        expect(await payments.listRefunds({ payment_id: payment.id })).toEqual([])
      })

      it("the check covers the guards this change did not touch: a completed cart with a malformed sliding-scale tier hands back its order", async () => {
        const { cart } = await makeCart()
        const first = await completeCart(cart.id)
        expectFirstCompletion(first)
        await drainSubscribers()
        await container().resolve(Modules.CART).updateCarts(cart.id, { metadata: { tier: "not-a-tier" } })

        const again = await completeCart(cart.id)
        expect(messages(again.errors)).toBe("")
        expect(again.orderId).toBe(first.orderId)
      })
    })
  },
})
