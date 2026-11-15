import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, PaymentEvents } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { TICKET_BOOKING_MODULE } from "../../src/modules/ticket-booking"
import { CART_COMPLETION_INCOMPLETE_MESSAGE } from "../../src/lib/cart-completion"
import { cardOrderFixtures } from "./helpers/card-orders"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows, stallNextCartCompletion } from "./helpers/stalled-workflows"
import { cartCompletionStallRetry } from "./helpers/cart-completion-stall"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * SD-48 (i) on a real migrated database: the ticket checkout
 * (`complete-cart-with-tickets`, behind `POST /store/carts/:id/complete-tickets`,
 * which the storefront's payment buttons call for every all-ticket cart) under
 * `FF_TICKET_ORDER_SETTLEMENT_V1`. The real workflow — Medusa's
 * `completeCartWorkflow`, the real payment, order, product, seller,
 * ticket-booking and link modules, the real ledger. Only Stripe is replaced:
 * the FBM Stripe provider instance's calls are stubbed on the registered
 * provider itself, so the payment module, its sessions, payments and captures
 * are all real (as in digital-order-settlement.spec.ts, whose settlement this
 * checkout now shares).
 *
 * A ticket cart here is one seated ticket: a venue with one row, a Medusa
 * product with a `Date` option, the ticket product and variant linked to it,
 * and a cart line carrying the seat in its metadata — what the storefront's
 * seat picker puts in the cart. Some scenarios add lines that are not one
 * seat (a ticket line naming no seat, a plain product), which a store client
 * can put in a cart the storefront sends here: every line carrying
 * `metadata.show_date` is enough.
 *
 * The workflow is required after the app has booted, never imported at the
 * top: a link's `entryPoint` (read when the workflow is composed) is
 * undefined until the app has registered its links.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1
const TICKETS = PHASE0_FEATURE_FLAGS.TICKET_ORDER_SETTLEMENT_V1
const DIGITAL = PHASE0_FEATURE_FLAGS.DIGITAL_ORDER_SETTLEMENT_V1
const SUBS = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

const SHOW_DATE = "2027-03-14"

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const { container, cents, uid, makeSeller, legs, sellerEarnings, clearing, placed, captured } =
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
    let channel: { id: string } | null = null

    /** What every test starts from; run again, after `disarm`, before each re-run of a scenario a stall cut short. */
    function arrange() {
      channel = null
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
      process.env[TICKETS] = "true"
    }
    function disarm() {
      jest.restoreAllMocks()
      delete process.env[CARD]
      delete process.env[TICKETS]
      delete process.env[DIGITAL]
      delete process.env[SUBS]
    }
    beforeEach(arrange)
    afterEach(disarm)

    /**
     * A natural SD-53 stall re-runs the scenario on a fresh cart
     * (helpers/cart-completion-stall.ts). Every test here uses it but the one
     * that stalls a completion on purpose, which uses Jest's own `it` and keeps
     * asserting what the stall leaves.
     */
    const stallRetry = cartCompletionStallRetry({
      container,
      reset: async () => {
        await drainSubscribers()
        disarm()
        arrange()
      },
    })

    /**
     * Before the runner's teardown: every subscriber the test's events set off
     * has finished, and no workflow execution is left unfinished. Registered
     * inside each describe below, so it runs before the runner's own afterEach
     * (see digital-order-settlement.spec.ts).
     */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    /** Every capture-payment workflow run emits `payment.captured`: counting it counts the captures this checkout ran. */
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

    async function salesChannel() {
      if (!channel) {
        ;[channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${uid()}` }])
      }
      return channel as { id: string }
    }

    type Show = { product: { id: string; variants: Array<{ id: string }> }; rowId: string; ticketVariantId: string; ticketProductId: string }

    /**
     * A seated show, as `create-ticket-product` makes one: a venue with one
     * row, a published product with a `Date` and a `Row Type` option, its
     * ticket product and ticket variant linked to the product and variant,
     * and the product linked to `sellerId` (none when null) and the sales
     * channel.
     */
    async function makeShow(sellerId: string | null): Promise<Show> {
      const id = uid()
      const tickets = container().resolve(TICKET_BOOKING_MODULE)
      const venue = await tickets.createVenues({ name: `Hall ${id}` })
      const row = await tickets.createVenueRows({ venue_id: venue.id, row_number: "A", row_type: "standard", seat_count: 10 })
      const [product] = await container().resolve(Modules.PRODUCT).createProducts([
        {
          title: `Show ${id}`,
          handle: `show-${id}`,
          status: "published",
          options: [
            { title: "Date", values: [SHOW_DATE] },
            { title: "Row Type", values: ["standard"] },
          ],
          variants: [
            { title: `Show ${id} standard`, manage_inventory: false, options: { Date: SHOW_DATE, "Row Type": "standard" } },
          ],
        },
      ])
      const ticketProduct = await tickets.createTicketProducts({ product_id: product.id, venue_id: venue.id, dates: [SHOW_DATE] })
      const ticketVariant = await tickets.createTicketProductVariants({
        ticket_product_id: ticketProduct.id,
        product_variant_id: product.variants[0].id,
        row_type: "standard",
      })
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      await link.create([
        { [TICKET_BOOKING_MODULE]: { ticket_product_id: ticketProduct.id }, [Modules.PRODUCT]: { product_id: product.id } },
        {
          [TICKET_BOOKING_MODULE]: { ticket_product_variant_id: ticketVariant.id },
          [Modules.PRODUCT]: { product_variant_id: product.variants[0].id },
        },
        { [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: (await salesChannel()).id } },
      ])
      if (sellerId) {
        await link.create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      }
      return { product, rowId: row.id, ticketVariantId: ticketVariant.id, ticketProductId: ticketProduct.id }
    }

    /** A published product of `sellerId` that is not a ticket (a poster), in the sales channel. */
    async function makePlainProduct(sellerId: string): Promise<Show["product"]> {
      const id = uid()
      const [product] = await container().resolve(Modules.PRODUCT).createProducts([
        {
          title: `Poster ${id}`,
          handle: `poster-${id}`,
          status: "published",
          options: [{ title: "Size", values: ["one"] }],
          variants: [{ title: `Poster ${id}`, manage_inventory: false, options: { Size: "one" } }],
        },
      ])
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      await link.create([
        { [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: (await salesChannel()).id } },
        { [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } },
      ])
      return product
    }

    /** A cart line that is not a seat of a show: any product, any line metadata a store client sets. */
    type OtherLine = { product: Show["product"]; metadata: Record<string, unknown> }
    const isShow = (line: Show | OtherLine): line is Show => "rowId" in line

    /**
     * A customer's cart holding one seat of each show (and each other line
     * as given) at $5.00 a line, with a Stripe session opened on it.
     */
    async function makeCart(shows: Array<Show | OtherLine>, seat = "7") {
      const id = uid()
      const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `fan-${id}@example.com` }])
      const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
      const carts = container().resolve(Modules.CART)
      const [cart] = await carts.createCarts([
        {
          currency_code: "usd",
          region_id: region.id,
          sales_channel_id: (await salesChannel()).id,
          customer_id: customer.id,
          email: customer.email,
          items: shows.map((s) => ({
            title: "Ticket",
            product_id: s.product.id,
            variant_id: s.product.variants[0].id,
            quantity: 1,
            unit_price: 5,
            requires_shipping: false,
            metadata: isShow(s) ? { venue_row_id: s.rowId, seat_number: seat, show_date: SHOW_DATE } : s.metadata,
          })),
        },
      ])
      const total = 5 * shows.length
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

    const completeCartWithTicketsWorkflow = (c: any) =>
      require("../../src/workflows/complete-cart-with-tickets").completeCartWithTicketsWorkflow(c)
    /** Run the checkout, returning its result and errors rather than throwing. */
    async function checkout(cartId: string) {
      const run = await completeCartWithTicketsWorkflow(container()).run({
        input: { cart_id: cartId },
        throwOnError: false,
      })
      return {
        result: run.result as any,
        errors: ((run.errors ?? []) as any[]).map((e) => `${e.action}: ${e.error?.message}`),
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
          "status",
          "seller.id",
          "ticket_purchases.id",
          "ticket_purchases.seat_number",
          "payment_collections.id",
          "payment_collections.captured_amount",
          "payment_collections.payments.id",
          "payment_collections.payments.captured_at",
        ],
        filters: { id: orderId },
      })
      return data[0] as any
    }

    /** Every ticket purchase of the show, read from the module itself (an order deleted since cannot show its links). */
    async function purchasesOf(show: Show) {
      return (await container().resolve(TICKET_BOOKING_MODULE).listTicketPurchases({ ticket_product_id: show.ticketProductId })) as any[]
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

    /** The customer's orders that are still live (not deleted), with their status. */
    async function liveOrders(customerId: string) {
      return (await container().resolve(Modules.ORDER).listOrders({ customer_id: customerId })) as any[]
    }

    /** The order's payments as the payment module records them. */
    async function moneyOf(collectionId: string) {
      const payments = await container().resolve(Modules.PAYMENT).listPayments(
        { payment_collection_id: collectionId },
        { relations: ["captures", "refunds"] }
      )
      return payments.map((p: any) => ({
        captures: (p.captures ?? []).map((c: any) => Number(c.amount)),
        refunds: (p.refunds ?? []).map((r: any) => Number(r.amount)),
        canceled: !!p.canceled_at,
      }))
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

    /** The `expire` (the lock's hold, in seconds) of every attempt to lock `key`. */
    function lockHolds(key: string) {
      const locking = container().resolve(Modules.LOCKING)
      const acquire = locking.acquire.bind(locking)
      const holds: Array<number | undefined> = []
      const seen = { refused: 0 }
      jest.spyOn(locking, "acquire").mockImplementation(async (keys: any, options?: any) => {
        const mine = [keys].flat().includes(key)
        if (mine) holds.push(options?.expire)
        try {
          return await acquire(keys, options)
        } catch (e) {
          if (mine) seen.refused++
          throw e
        }
      })
      return { holds, seen }
    }

    /** Every read the shared paid check makes (its own field list), by the order id it was handed. */
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

    /**
     * Every read made through Query — what `useQueryGraphStep`, the shared
     * settlement steps and Medusa's own workflows all call — recorded before
     * it runs, so a read that then fails is recorded too. `failOnce`: the
     * first read it matches throws, as a dropped connection would.
     */
    function queryReads(failOnce?: (q: { entity: string; fields: string[] }) => boolean) {
      const query = container().resolve(ContainerRegistrationKeys.QUERY)
      const graph = query.graph.bind(query)
      const seen: Array<{ entity: string; fields: string[]; filters: any }> = []
      let failed = false
      jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
        const read = { entity: q?.entity, fields: q?.fields ?? [], filters: q?.filters }
        seen.push(read)
        if (failOnce && !failed && failOnce(read)) {
          failed = true
          throw new Error("transient: connection terminated unexpectedly")
        }
        return graph(q, ...rest)
      })
      return {
        /** Whether `failOnce` has failed a read. */
        failed: () => failed,
        /**
         * The order ids Medusa's `cancelOrderWorkflow` was started on: its
         * first step is this read ("get-order"), so a run is recorded even
         * where it then fails at that read, as it does on this stack (MikroORM
         * EntityLoader, SD-36 (8)). Independent of that failure.
         */
        cancelOrderStarts: () =>
          seen
            .filter(
              (q) =>
                q.entity === "order" &&
                q.fields.includes("fulfillments.canceled_at") &&
                q.fields.includes("payment_collections.payments.captures.raw_amount")
            )
            .map((q) => q.filters?.id),
        /** The seat-line check's cart read (`requireSeatedTicketCartStep`). */
        seatLineReads: () =>
          seen.filter((q) => q.entity === "cart" && q.fields.includes("items.variant.ticket_product_variant.id")).length,
        /** The checkout's cart read that feeds the seat check (`validateTicketOrderStep`), right before it. */
        seatCheckReads: () =>
          seen.filter((q) => q.entity === "cart" && q.fields.includes("items.variant.ticket_product_variant.purchases.*")).length,
        /** The checkout's read of the order's ticket-purchase links (`retrieve-existing-links`). */
        ticketLinkReads: () =>
          seen.filter((q) => q.fields.length === 1 && q.fields[0] === "ticket_purchase.id").map((q) => q.filters?.order_id),
      }
    }

    /** The order ids a seller–order link was created for, through the link service the settlement steps use. */
    function sellerLinkCreates() {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      const create = link.create.bind(link)
      const orders: string[] = []
      jest.spyOn(link, "create").mockImplementation(async (def: any, ...rest: any[]) => {
        for (const d of [def].flat()) {
          if (d?.[SELLER_MODULE]?.seller_id && d?.[Modules.ORDER]?.order_id) orders.push(d[Modules.ORDER].order_id)
        }
        return create(def, ...rest)
      })
      return orders
    }

    /**
     * Two checkouts of two carts for one seat, run at once, meeting where the
     * seat is sold: each `createTicketPurchases` call waits there until both
     * have arrived (20 s at most), then goes on to the real module. Neither
     * can sell the seat before the other has passed its seat check, which is
     * the race SD-48 (b) leaves open: each run holds only its own cart's lock.
     */
    function meetAtTheSeat() {
      const tickets = container().resolve(TICKET_BOOKING_MODULE)
      const create = tickets.createTicketPurchases.bind(tickets)
      let arrived = 0
      let open: () => void = () => {}
      const both = new Promise<void>((resolve) => (open = resolve))
      jest.spyOn(tickets, "createTicketPurchases").mockImplementation(async (...args: any[]) => {
        if (++arrived === 2) open()
        await Promise.race([both, new Promise((resolve) => setTimeout(resolve, 20_000))])
        return create(...args)
      })
      return { arrived: () => arrived }
    }

    async function relinkProduct(productId: string, from: string, to: string | null) {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss({ [SELLER_MODULE]: { seller_id: from }, [Modules.PRODUCT]: { product_id: productId } })
      if (to) await link.create({ [SELLER_MODULE]: { seller_id: to }, [Modules.PRODUCT]: { product_id: productId } })
    }

    const UNSEATED = "require-seated-ticket-cart: A ticket checkout sells one seat per line and nothing else, and this cart cannot be settled: "
    /** The lines a seat-line refusal names, after its fixed words; it must be the checkout's only error. */
    const unseatedLines = (errors: string[]) => {
      expect(errors).toHaveLength(1)
      expect(errors[0].slice(0, UNSEATED.length)).toBe(UNSEATED)
      return errors[0].slice(UNSEATED.length)
    }

    describe("a ticket checkout, with FF_TICKET_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("the order is linked to its seller, its ticket purchase made before the card is captured, and settles to that seller less the 3%", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart } = await makeCart([show])
        const created = jest.spyOn(container().resolve(TICKET_BOOKING_MODULE), "createTicketPurchases")
        const captures = captureEvents()
        const reads = queryReads()
        const sellerLinks = sellerLinkCreates()

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const orderId = result.order.id as string
        // What the spies other scenarios read the absence of do see, here:
        // the seat-line check's and the seat check's cart reads, the
        // ticket-link read, the seller link.
        expect(reads.seatLineReads()).toBe(1)
        expect(reads.seatCheckReads()).toBe(1)
        expect(reads.ticketLinkReads()).toEqual([orderId])
        expect(sellerLinks).toEqual([orderId])
        expect(reads.cancelOrderStarts()).toEqual([])

        // The seat was sold, then the card captured, once.
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(created).toHaveBeenCalledTimes(1)
        expect(created.mock.invocationCallOrder[0]).toBeLessThan(stripe.capturePayment.mock.invocationCallOrder[0])

        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.ticket_purchases.map((p: any) => p.seat_number)).toEqual(["7"])
        const payment = order.payment_collections[0].payments[0]
        expect(payment.captured_at).toBeTruthy()
        expect(Number(order.payment_collections[0].captured_amount)).toBe(5)
        expect(captures).toEqual([payment.id])
        expect(stripe.refundPayment).not.toHaveBeenCalled()

        const { purchase, fee, sellerLeg } = await settled(orderId, payment.id)
        expect(cents(purchase.amount)).toBe(500)
        expect(purchase.debit_account_id).toBe((await clearing()).id)
        expect(cents(fee.amount)).toBe(15)
        expect(cents(sellerLeg.amount)).toBe(485)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
      })

      stallRetry.it("a cart holding two sellers' tickets is refused before the card is touched", async () => {
        const a = await makeShow((await makeSeller()).id)
        const b = await makeShow((await makeSeller()).id)
        const { cart, customer } = await makeCart([a, b])

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          "resolve-ticket-seller: A ticket order is sold by one seller, and this cart cannot be: its products belong to 2 sellers.",
        ])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(await liveOrders(customer.id)).toEqual([])
        expect([...(await purchasesOf(a)), ...(await purchasesOf(b))]).toEqual([])
      })

      stallRetry.it("a ticket product with no seller (an admin-created one without seller_id) is refused before the card is touched", async () => {
        const show = await makeShow(null)
        const { cart, customer } = await makeCart([show])

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          "resolve-ticket-seller: A ticket order is sold by one seller, and this cart cannot be: a product has no seller.",
        ])
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(await liveOrders(customer.id)).toEqual([])
      })

      stallRetry.it("a ticket line naming no seat (only its show date) is refused before the card is touched: nothing authorized or captured, no order, no seller link", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, customer } = await makeCart([{ product: show.product, metadata: { show_date: SHOW_DATE } }])

        const { errors } = await checkout(cart.id)
        expect(unseatedLines(errors)).toMatch(/^line \S+ names no venue_row_id, seat_number\.$/)
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(await liveOrders(customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await purchasesOf(show)).toEqual([])
      })

      stallRetry.it("a cart holding a seat and a line that is not a ticket (a plain product of the same seller, carrying a show date) is refused before the card is touched", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const poster = await makePlainProduct(seller.id)
        const { cart, customer } = await makeCart([show, { product: poster, metadata: { show_date: SHOW_DATE } }])

        const { errors } = await checkout(cart.id)
        // Only the poster's line is named: the seat is one seat.
        expect(unseatedLines(errors)).toMatch(/^line \S+ is not a ticket\.$/)
        expect(stripe.authorizePayment).not.toHaveBeenCalled()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(await liveOrders(customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await purchasesOf(show)).toEqual([])
      })

      stallRetry.it("a seat sold meanwhile is refused before the capture: the authorization is cancelled, nothing captured or refunded", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, customer } = await makeCart([show])
        // Someone else bought seat 7 for this date after this cart was made.
        await container().resolve(TICKET_BOOKING_MODULE).createTicketPurchases({
          order_id: "order_someone_else",
          ticket_product_id: show.ticketProductId,
          ticket_variant_id: show.ticketVariantId,
          venue_row_id: show.rowId,
          seat_number: "7",
          show_date: new Date(SHOW_DATE),
        })


        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([`validate-ticket-order: Seat 7 has already been purchased for show date ${SHOW_DATE}`])
        // completeCartWorkflow's compensation released the hold, once; no money moved.
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).toHaveBeenCalledTimes(1)
        expect(await liveOrders(customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual(["order_someone_else"])
      })

      stallRetry.it("a capture Stripe refuses fails the checkout: the seat's purchase is deleted and the seat free again, no live order or seller link; the hold is cancelled and nothing refunded", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, customer, collection } = await makeCart([show])
        const created = jest.spyOn(container().resolve(TICKET_BOOKING_MODULE), "createTicketPurchases")
        stripe.capturePayment.mockImplementation(async () => {
          throw new Error("card_declined")
        })
        const reads = queryReads()

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual(["capture-payment-workflow-as-step: card_declined"])
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        // completeCartWorkflow's compensation deleted the order and released
        // the hold, once. The seat check's compensation was told not to cancel
        // the order, so Medusa's cancelOrderWorkflow was never started (it
        // would cancel the authorization a second time and emit
        // order.canceled): that holds whether or not cancelOrderWorkflow can
        // read an order on this stack.
        expect(reads.cancelOrderStarts()).toEqual([])
        expect(stripe.cancelPayment).toHaveBeenCalledTimes(1)
        // The seat was sold before the capture, and its purchase deleted by
        // createTicketPurchasesStep's compensation when the capture failed.
        expect(created).toHaveBeenCalledTimes(1)
        expect(created.mock.invocationCallOrder[0]).toBeLessThan(stripe.capturePayment.mock.invocationCallOrder[0])
        expect(await purchasesOf(show)).toEqual([])
        expect(await liveOrders(customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await moneyOf(collection.id)).toEqual([{ captures: [], refunds: [], canceled: true }])
        // The checkout's compensation released the cart's lock.
        const locking = container().resolve(Modules.LOCKING)
        await locking.acquire(cart.id, { expire: 5 })
        await locking.release(cart.id)

        // The seat is free again: another cart buys it.
        stripe.capturePayment.mockImplementation(async (input: any) => ({ data: { ...(input?.data ?? {}), status: "succeeded" } }))
        const next = await makeCart([show])
        const sold = await checkout(next.cart.id)
        expect(sold.errors).toEqual([])
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([sold.result.order.id])
      })

      stallRetry.it("a failure after the capture (the order's refetch, the one step after it, fails once) leaves no live order, seller link or ticket purchase, and the capture is refunded when Stripe takes the refund", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, customer, collection } = await makeCart([show])
        const created = jest.spyOn(container().resolve(TICKET_BOOKING_MODULE), "createTicketPurchases")
        const reads = queryReads((q) => q.entity === "order" && q.fields.includes("discount_total"))

        const { errors } = await checkout(cart.id)
        expect(reads.failed()).toBe(true)
        expect(errors).toEqual(["refetch-order: transient: connection terminated unexpectedly"])
        expect(created).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        // completeCartWorkflow's compensatePaymentIfNeededStep: best effort
        // (SD-48 (b)). Stripe cancels are not counted: the stub takes a cancel
        // of the captured PaymentIntent that real Stripe refuses.
        expect(stripe.refundPayment).toHaveBeenCalledTimes(1)
        expect(reads.cancelOrderStarts()).toEqual([])
        expect(await liveOrders(customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await purchasesOf(show)).toEqual([])
        expect(await moneyOf(collection.id)).toEqual([expect.objectContaining({ captures: [5], refunds: [5] })])
      })

      stallRetry.it("two carts for one seat at once (SD-48 (b)): both pass the seat check; the seat's unique index refuses the second before any money moves — one capture, nothing refunded, the loser's hold cancelled and its order and seller link gone", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const x = await makeCart([show])
        const y = await makeCart([show])
        const seat = meetAtTheSeat()
        const reads = queryReads()

        const runs = await Promise.all([checkout(x.cart.id), checkout(y.cart.id)])
        expect(seat.arrived()).toBe(2)
        const winner = runs.findIndex((r) => r.errors.length === 0)
        expect(winner).toBeGreaterThanOrEqual(0)
        const [won, lost] = winner === 0 ? [x, y] : [y, x]
        const lostRun = runs[1 - winner]
        expect(lostRun.errors).toEqual([expect.stringMatching(/^create-ticket-purchases: /)])
        const wonOrderId = runs[winner].result.order.id as string

        // The seat's purchase is made before the capture, so the loser was
        // refused while its card was only authorized: completeCartWorkflow's
        // compensation cancelled that hold, and nothing was captured or
        // refunded for it. Capturing first, the loser was captured and then
        // refunded, best effort (SD-48 (b)).
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).toHaveBeenCalledTimes(1)
        expect(await moneyOf(won.collection.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        expect(await moneyOf(lost.collection.id)).toEqual([{ captures: [], refunds: [], canceled: true }])
        expect(reads.cancelOrderStarts()).toEqual([])
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([wonOrderId])
        expect(await liveOrders(lost.customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([{ order_id: wonOrderId }])
      })

      stallRetry.it("a product moved to another seller while the card was authorized is refused at the link: rolled back, nothing captured", async () => {
        const a = await makeSeller()
        const b = await makeSeller()
        const show = await makeShow(a.id)
        const { cart, customer } = await makeCart([show])
        stripe.authorizePayment.mockImplementation(async (input: any) => {
          await relinkProduct(show.product.id, a.id, b.id)
          return { status: "authorized", data: { ...(input?.data ?? {}), status: "requires_capture" } }
        })

        const { errors } = await checkout(cart.id)
        expect(errors).toEqual([
          expect.stringMatching(
            new RegExp(`^link-ticket-order-seller: Ticket order order_\\w+ is sold by ${b.id}, not ${a.id} as checked before payment$`)
          ),
        ])
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(await purchasesOf(show)).toEqual([])
        expect(await liveOrders(customer.id)).toEqual([])
        expect(await liveSellerOrderLinks(a.id)).toEqual([])
        expect(await liveSellerOrderLinks(b.id)).toEqual([])
      })

      stallRetry.it("the store route answers 200 with the order, linked and captured; and refuses a two-seller cart and a seat-less ticket line with 400, before the card is touched", async () => {
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart } = await makeCart([show])

        const ok = await api.post(`/store/carts/${cart.id}/complete-tickets`, {}, pak).catch((e: any) => e.response)
        expect(ok.status).toBe(200)
        expect(ok.data.type).toBe("order")
        const order = await readOrder(ok.data.order.id)
        expect(order.seller?.id).toBe(seller.id)
        expect(order.payment_collections[0].payments[0].captured_at).toBeTruthy()
        expect(order.ticket_purchases).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)

        const two = await makeCart([await makeShow((await makeSeller()).id), await makeShow((await makeSeller()).id)])
        const refused = await api.post(`/store/carts/${two.cart.id}/complete-tickets`, {}, pak).catch((e: any) => e.response)
        expect(refused.status).toBe(400)
        expect(refused.data.message).toMatch(/^A ticket order is sold by one seller/)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(await liveOrders(two.customer.id)).toEqual([])

        const seatless = await makeCart([{ product: show.product, metadata: { show_date: SHOW_DATE } }])
        const unseated = await api.post(`/store/carts/${seatless.cart.id}/complete-tickets`, {}, pak).catch((e: any) => e.response)
        expect(unseated.status).toBe(400)
        expect(unseated.data.message).toMatch(/^A ticket checkout sells one seat per line and nothing else/)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(await liveOrders(seatless.customer.id)).toEqual([])
      })
    })

    describe("a replay — the checkout run again on a cart it already completed — with FF_TICKET_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("returns the same order: captured once, nothing refunded or cancelled, one ticket purchase", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, collection } = await makeCart([show])
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
        const order = await readOrder(orderId)
        expect(captures).toEqual([order.payment_collections[0].payments[0].id])
        expect(order.seller?.id).toBe(seller.id)
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([orderId])
        expect(await moneyOf(collection.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([{ order_id: orderId }])
      })

      stallRetry.it("a replay that fails after the order is found refunds nothing, and leaves the order, its seat and its seller as they were", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, collection } = await makeCart([show])
        const first = await checkout(cart.id)
        expect(first.errors).toEqual([])
        const orderId = first.result.order.id as string

        // The replay's last read (the refetch of the order) fails once, as a
        // dropped connection would. Run through completeCartWorkflow, its
        // compensation would refund the captured sale (SD-48 (1)).
        const query = container().resolve(ContainerRegistrationKeys.QUERY)
        const graph = query.graph.bind(query)
        let failed = false
        const read = jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
          if (!failed && q?.entity === "order" && (q.fields ?? []).includes("discount_total")) {
            failed = true
            throw new Error("transient: connection terminated unexpectedly")
          }
          return graph(q, ...rest)
        })
        const second = await checkout(cart.id)
        read.mockRestore()
        expect(failed).toBe(true)
        expect(second.errors.join("\n")).toMatch(/transient: connection terminated unexpectedly/)

        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await moneyOf(collection.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
        const order = await readOrder(orderId)
        expect(order.status).not.toBe("canceled")
        expect(order.seller?.id).toBe(seller.id)
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([orderId])
      })

      stallRetry.it("of an order its first completion left unlinked and uncaptured: the retry links it, sells the seat, and only then captures it, once", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, collection } = await makeCart([show])
        const created = jest.spyOn(container().resolve(TICKET_BOOKING_MODULE), "createTicketPurchases")
        // What a first completion that stopped straight after
        // completeCartWorkflow leaves (a restart mid-checkout; Medusa's own
        // Stripe webhook): an order, its card authorized, no seller link.
        const { completeCartWorkflow } = require("@medusajs/medusa/core-flows")
        const run = await completeCartWorkflow(container()).run({ input: { id: cart.id }, throwOnError: false })
        expect(run.errors ?? []).toEqual([])
        const orderId = run.result.id as string
        expect((await readOrder(orderId)).seller ?? null).toBeNull()

        const retry = await checkout(cart.id)
        expect(retry.errors).toEqual([])
        expect(retry.result.order.id).toBe(orderId)
        const order = await readOrder(orderId)
        expect(order.seller?.id).toBe(seller.id)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(created).toHaveBeenCalledTimes(1)
        expect(created.mock.invocationCallOrder[0]).toBeLessThan(stripe.capturePayment.mock.invocationCallOrder[0])
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([orderId])
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(await moneyOf(collection.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
      })

      stallRetry.it("of an order its first completion left unlinked and uncaptured, a capture Stripe refuses fails the retry: the seat's purchase is undone, nothing refunded", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart } = await makeCart([show])
        const created = jest.spyOn(container().resolve(TICKET_BOOKING_MODULE), "createTicketPurchases")
        const { completeCartWorkflow } = require("@medusajs/medusa/core-flows")
        const run = await completeCartWorkflow(container()).run({ input: { id: cart.id }, throwOnError: false })
        expect(run.errors ?? []).toEqual([])
        const orderId = run.result.id as string
        stripe.capturePayment.mockImplementation(async () => {
          throw new Error("card_declined")
        })
        const reads = queryReads()

        const retry = await checkout(cart.id)
        expect(retry.errors).toEqual(["capture-payment-workflow-as-step: card_declined"])
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        // Sold before the capture, deleted by its compensation after it.
        expect(created).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(await purchasesOf(show)).toEqual([])
        // The retry's seller link is undone with it; the order stays for an
        // operator, as the digital checkout leaves one (SD-48 (o)) — by
        // design, not because cancelOrderWorkflow cannot read it here: it was
        // never started.
        expect(reads.cancelOrderStarts()).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect((await readOrder(orderId)).status).not.toBe("canceled")
      })

      stallRetry.it("of an order its first completion left uncaptured, a retry refused at the seat's purchase captures nothing and keeps the order; the next retry sells the seat and captures once", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, collection } = await makeCart([show])
        const { completeCartWorkflow } = require("@medusajs/medusa/core-flows")
        const run = await completeCartWorkflow(container()).run({ input: { id: cart.id }, throwOnError: false })
        expect(run.errors ?? []).toEqual([])
        const orderId = run.result.id as string
        // Fails once, then calls through to the module.
        jest.spyOn(container().resolve(TICKET_BOOKING_MODULE), "createTicketPurchases").mockImplementationOnce(async () => {
          throw new Error("ticket store down")
        })
        const reads = queryReads()

        const retry = await checkout(cart.id)
        expect(retry.errors).toEqual(["create-ticket-purchases: ticket store down"])
        // Refused before the capture: no money moved. Nothing on a replay
        // refunds or cancels either (no completeCartWorkflow compensation, and
        // the seat check's compensation was told not to run cancelOrderWorkflow).
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(reads.cancelOrderStarts()).toEqual([])
        expect((await readOrder(orderId)).status).not.toBe("canceled")
        expect(await moneyOf(collection.id)).toEqual([{ captures: [], refunds: [], canceled: false }])
        expect(await purchasesOf(show)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])

        const again = await checkout(cart.id)
        expect(again.errors).toEqual([])
        expect(again.result.order.id).toBe(orderId)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([orderId])
        expect((await readOrder(orderId)).seller?.id).toBe(seller.id)
        expect(await moneyOf(collection.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
      })

      stallRetry.it("of an order the checkout completed with the flag off, holding a seat and a ticket line naming no seat: the replay is refused before anything is linked or captured, though the order's seat is sold", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, collection } = await makeCart([show, { product: show.product, metadata: { show_date: SHOW_DATE } }])
        delete process.env[TICKETS]
        const first = await checkout(cart.id)
        expect(first.errors).toEqual([])
        const orderId = first.result.order.id as string
        // Flag off, the seat-less line was passed over: one seat sold for two lines.
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([orderId])
        process.env[TICKETS] = "true"
        const sellerLinks = sellerLinkCreates()

        const replay = await checkout(cart.id)
        // The order already has its ticket purchase, so the seat check is
        // skipped on this replay; the seat-line check is not.
        expect(unseatedLines(replay.errors)).toMatch(/^line \S+ names no venue_row_id, seat_number\.$/)
        expect(sellerLinks).toEqual([])
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await moneyOf(collection.id)).toEqual([{ captures: [], refunds: [], canceled: false }])
        expect((await readOrder(orderId)).status).not.toBe("canceled")
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([orderId])
      })

      stallRetry.it("of an order Medusa's own completion made from a seat-less ticket line: the replay is refused before anything is linked or captured, and the order left as it was", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, collection } = await makeCart([{ product: show.product, metadata: { show_date: SHOW_DATE } }])
        const { completeCartWorkflow } = require("@medusajs/medusa/core-flows")
        const run = await completeCartWorkflow(container()).run({ input: { id: cart.id }, throwOnError: false })
        expect(run.errors ?? []).toEqual([])
        const orderId = run.result.id as string
        const sellerLinks = sellerLinkCreates()

        const replay = await checkout(cart.id)
        expect(unseatedLines(replay.errors)).toMatch(/^line \S+ names no venue_row_id, seat_number\.$/)
        expect(sellerLinks).toEqual([])
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect(await moneyOf(collection.id)).toEqual([{ captures: [], refunds: [], canceled: false }])
        expect((await readOrder(orderId)).status).not.toBe("canceled")
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await purchasesOf(show)).toEqual([])
      })
    })

    describe("a first completion Medusa's workflow engine leaves unfinished (helpers/stalled-workflows.ts), with FF_TICKET_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      it("the checkout is refused for want of an order id, and its retry is refused at the paid check: no seat sold, no seller link, Stripe never called", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, customer, collection } = await makeCart([show])
        for (const call of Object.values(stripe)) call.mockClear()
        const stall = stallNextCartCompletion(container)

        const first = await checkout(cart.id)
        expect(stall.stalled()).toBe(true)
        expect(first.errors).toEqual([`require-completed-cart-order: ${CART_COMPLETION_INCOMPLETE_MESSAGE}`])
        expect(first.refusals).toEqual([
          { action: "require-completed-cart-order", code: "cart_completion_incomplete", reason: "no_order_id" },
        ])
        expect((await clearStalledWorkflows(container, 1000)).map((w) => w.workflow_id)).toEqual(["complete-cart"])
        expect(await liveOrders(customer.id)).toHaveLength(1)

        // The retry finds that order as a replay, which skips the completion
        // and the guard after it; the ticket paid check refuses it, before the
        // seat check's cart read, the seat check, the seller link or any money
        // step: none of them ran, not merely none of them left a trace. (The
        // seat-line check reads the cart before it, and passes: the line is
        // one seat.)
        const [stalledOrder] = await liveOrders(customer.id)
        const reads = queryReads()
        const sellerLinks = sellerLinkCreates()
        const retry = await checkout(cart.id)
        expect(retry.errors).toEqual([`ticket-order-paid: ${CART_COMPLETION_INCOMPLETE_MESSAGE}`])
        expect(retry.refusals).toEqual([
          { action: "ticket-order-paid", code: "cart_completion_incomplete", reason: "order_unpaid" },
        ])
        expect(reads.seatCheckReads()).toBe(0)
        expect(reads.ticketLinkReads()).toEqual([])
        expect(sellerLinks).toEqual([])
        expect(reads.cancelOrderStarts()).toEqual([])
        expect((await readOrder(stalledOrder.id)).status).not.toBe("canceled")
        expect(await purchasesOf(show)).toEqual([])
        expect(await liveSellerOrderLinks(seller.id)).toEqual([])
        expect(await container().resolve(Modules.PAYMENT).listPayments({ payment_collection_id: collection.id })).toEqual([])
        for (const [name, call] of Object.entries(stripe)) {
          expect([name, call.mock.calls.length]).toEqual([name, 0])
        }
      })
    })

    describe("two checkouts of one cart at the same time (a double submit), with FF_TICKET_ORDER_SETTLEMENT_V1", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("with a capture slower than the old 2 s wait, the second waits for the first and replays it: one order, one capture, one seat", async () => {
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart, customer, collection } = await makeCart([show])
        stripe.capturePayment.mockImplementation(async (input: any) => {
          await new Promise((r) => setTimeout(r, 2500))
          return { data: { ...(input?.data ?? {}), status: "succeeded" } }
        })
        const lock = lockHolds(cart.id)

        const [x, y] = await Promise.all([checkout(cart.id), checkout(cart.id)])
        expect([x.errors, y.errors]).toEqual([[], []])
        expect(y.result.order.id).toBe(x.result.order.id)
        // Medusa's completion lock: held 120 s, and the second run kept trying.
        expect(lock.holds.every((h) => h === 120)).toBe(true)
        expect(lock.seen.refused).toBeGreaterThan(0)

        expect(await liveOrders(customer.id)).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).toHaveBeenCalledTimes(1)
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect(stripe.cancelPayment).not.toHaveBeenCalled()
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([x.result.order.id])
        expect(await moneyOf(collection.id)).toEqual([{ captures: [5], refunds: [], canceled: false }])
      })
    })

    describe("flag off", () => {
      afterEach(settleBeforeTeardown)

      stallRetry.it("as before — no seller link, the payment only authorized, the seat sold, nothing settles — even with the digital and subscription settlement flags on", async () => {
        delete process.env[TICKETS]
        process.env[DIGITAL] = "true"
        process.env[SUBS] = "true"
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const { cart } = await makeCart([show])
        const paid = paidChecks()
        const lock = lockHolds(cart.id)

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const orderId = result.order.id as string
        const order = await readOrder(orderId)
        expect(order.seller ?? null).toBeNull()
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        expect(order.ticket_purchases).toHaveLength(1)
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        // The ticket paid check is dark with its flag (the SD-53 guard has run),
        // and the lock is the old 10 s hold.
        expect(paid).not.toHaveBeenCalled()
        expect(lock.holds).toEqual([10])
        await placed(orderId)
        expect(await legs(orderId)).toEqual([])
      })

      stallRetry.it("as before — a replay returns the same order with its one seat, still unlinked and uncaptured", async () => {
        delete process.env[TICKETS]
        const show = await makeShow((await makeSeller()).id)
        const { cart } = await makeCart([show])

        const first = await checkout(cart.id)
        const second = await checkout(cart.id)
        expect([first.errors, second.errors]).toEqual([[], []])
        expect(second.result.order.id).toBe(first.result.order.id)
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([first.result.order.id])
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        const order = await readOrder(first.result.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
      })

      stallRetry.it("as before — two carts for one seat at once: the seat's unique index refuses the second, which was only authorized, so nothing is captured or refunded; the seat check's compensation still starts cancelOrderWorkflow", async () => {
        delete process.env[TICKETS]
        const show = await makeShow((await makeSeller()).id)
        const x = await makeCart([show])
        const y = await makeCart([show])
        const seat = meetAtTheSeat()
        const reads = queryReads()

        const runs = await Promise.all([checkout(x.cart.id), checkout(y.cart.id)])
        expect(seat.arrived()).toBe(2)
        const winner = runs.findIndex((r) => r.errors.length === 0)
        expect(winner).toBeGreaterThanOrEqual(0)
        const lost = winner === 0 ? y : x
        expect(runs[1 - winner].errors).toEqual([expect.stringMatching(/^create-ticket-purchases: /)])
        const wonOrderId = runs[winner].result.order.id as string

        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(stripe.refundPayment).not.toHaveBeenCalled()
        expect((await moneyOf(lost.collection.id)).map((m) => ({ captures: m.captures, refunds: m.refunds }))).toEqual([
          { captures: [], refunds: [] },
        ])
        expect((await purchasesOf(show)).map((p) => p.order_id)).toEqual([wonOrderId])
        expect(await liveOrders(lost.customer.id)).toEqual([])
        // Unchanged with the flag off: the seat check hands its compensation
        // the order id, and cancelOrderWorkflow is started on the loser's
        // order (here it then fails at that read; SD-36 (8)). Also shows the
        // read the flag-on scenarios find absent is seen when it happens.
        expect(reads.cancelOrderStarts()).toHaveLength(1)
        expect(reads.cancelOrderStarts()[0]).not.toBe(wonOrderId)
      })

      stallRetry.it("as before — a ticket line naming no seat and a line that is not a ticket complete into one order with no ticket purchase for them, its payment only authorized", async () => {
        delete process.env[TICKETS]
        const seller = await makeSeller()
        const show = await makeShow(seller.id)
        const poster = await makePlainProduct(seller.id)
        const { cart, collection } = await makeCart([
          { product: show.product, metadata: { show_date: SHOW_DATE } },
          { product: poster, metadata: { show_date: SHOW_DATE } },
        ])
        const reads = queryReads()

        const { result, errors } = await checkout(cart.id)
        expect(errors).toEqual([])
        const order = await readOrder(result.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.ticket_purchases ?? []).toEqual([])
        expect(await purchasesOf(show)).toEqual([])
        expect(stripe.authorizePayment).toHaveBeenCalledTimes(1)
        expect(stripe.capturePayment).not.toHaveBeenCalled()
        expect(await moneyOf(collection.id)).toEqual([{ captures: [], refunds: [], canceled: false }])
        // Flag off, the seat-line check read nothing (the flag-on checkout above reads it once).
        expect(reads.seatLineReads()).toBe(0)
      })

      stallRetry.it("as before — a two-seller cart still completes into one unlinked, uncaptured order, over the store route", async () => {
        delete process.env[TICKETS]
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const { cart } = await makeCart([await makeShow((await makeSeller()).id), await makeShow((await makeSeller()).id)])

        const response = await api.post(`/store/carts/${cart.id}/complete-tickets`, {}, pak).catch((e: any) => e.response)
        expect(response.status).toBe(200)
        const order = await readOrder(response.data.order.id)
        expect(order.seller ?? null).toBeNull()
        expect(order.ticket_purchases).toHaveLength(2)
        expect(order.payment_collections[0].payments[0].captured_at).toBeFalsy()
        expect(stripe.capturePayment).not.toHaveBeenCalled()
      })
    })
  },
})
