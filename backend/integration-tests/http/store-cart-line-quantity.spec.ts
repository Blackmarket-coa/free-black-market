import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { TICKET_BOOKING_MODULE } from "../../src/modules/ticket-booking"
import { ONE_TICKET_PER_SEAT } from "../../src/workflows/hooks/ticket-line-rules"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows } from "./helpers/stalled-workflows"

jest.setTimeout(300 * 1000)

/**
 * The quantity a buyer asks for on a cart line, through the three store routes
 * that set it, on Postgres: `POST /store/carts` with `items` (Medusa's
 * `createCartWorkflow`), `POST /store/carts/:id/line-items`
 * (`addToCartWorkflow`) and `POST /store/carts/:id/line-items/:line_id`
 * (`updateLineItemInCartWorkflow`).
 *
 * FBM's validate hook on the add (`workflows/hooks/add-to-cart-validation.ts`)
 * carries the ticket rule, one ticket per seat. The rule's quantity test sat
 * above the test for a seat, so it refused every line not added at quantity 1,
 * whatever the product: a crate of tomatoes at 2 answered 400 "You can only
 * purchase one ticket for a seat." The product page got by because it adds one
 * and raises the line through the update route; an order-cycle add
 * (`storefront/src/lib/data/order-cycles.ts`) sends the buyer's quantity with
 * line metadata, which always goes through the add route, so any cycle add of
 * 2 or more was refused. And nothing held a seat to one ticket on the update
 * route, which the cart page's + button calls on every line, nor on the create
 * route, nor on an add that Medusa puts into a line already in the cart.
 *
 * Every call is recorded and the whole record compared at once, so a tree
 * without the fix shows each call that answers wrongly, not just the first.
 */

const SHOW_DATE = "2027-03-14"

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

    /** Before the runner's teardown: subscribers finished, no execution left unfinished. */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    /** Link a price in dollars to `variantId`. */
    async function price(variantId: string, amount: number) {
      const [priceSet] = await container()
        .resolve(Modules.PRICING)
        .createPriceSets([{ prices: [{ amount, currency_code: "usd" }] }])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.PRODUCT]: { variant_id: variantId },
        [Modules.PRICING]: { price_set_id: priceSet.id },
      })
    }

    /**
     * A storefront: a publishable key on one sales channel, a US region in
     * dollars, a crate of tomatoes at $10.00, and a seated show at $5.00 a
     * seat, built as `create-ticket-product` builds one (a venue with one row,
     * a product with `Date` and `Row Type` options, its ticket product and
     * ticket variant linked to the product and its variant).
     */
    async function makeStore() {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      const products = container().resolve(Modules.PRODUCT)
      const tickets = container().resolve(TICKET_BOOKING_MODULE)
      const id = uid()

      const [channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${id}` }])
      const [key] = await container()
        .resolve(Modules.API_KEY)
        .createApiKeys([{ title: "storefront", type: "publishable", created_by: "test" }])
      await link.create({
        [Modules.API_KEY]: { publishable_key_id: key.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
      })
      const {
        result: [region],
      } = await createRegionsWorkflow(container()).run({
        input: { regions: [{ name: `United States ${id}`, currency_code: "usd", countries: ["us"], payment_providers: ["pp_system_default"] }] },
      })

      const [tomatoes] = await products.createProducts([
        {
          title: `Tomatoes ${id}`,
          handle: `tomatoes-${id}`,
          status: "published",
          options: [{ title: "Size", values: ["Crate"] }],
          variants: [{ title: "Crate", manage_inventory: false, options: { Size: "Crate" } }],
        },
      ])
      await price(tomatoes.variants[0].id, 10)

      const venue = await tickets.createVenues({ name: `Hall ${id}` })
      const row = await tickets.createVenueRows({ venue_id: venue.id, row_number: "A", row_type: "standard", seat_count: 10 })
      const [show] = await products.createProducts([
        {
          title: `Show ${id}`,
          handle: `show-${id}`,
          status: "published",
          options: [
            { title: "Date", values: [SHOW_DATE] },
            { title: "Row Type", values: ["standard"] },
          ],
          variants: [{ title: `Show ${id} standard`, manage_inventory: false, options: { Date: SHOW_DATE, "Row Type": "standard" } }],
        },
      ])
      await price(show.variants[0].id, 5)
      const ticketProduct = await tickets.createTicketProducts({ product_id: show.id, venue_id: venue.id, dates: [SHOW_DATE] })
      const ticketVariant = await tickets.createTicketProductVariants({
        ticket_product_id: ticketProduct.id,
        product_variant_id: show.variants[0].id,
        row_type: "standard",
      })
      await link.create([
        { [TICKET_BOOKING_MODULE]: { ticket_product_id: ticketProduct.id }, [Modules.PRODUCT]: { product_id: show.id } },
        {
          [TICKET_BOOKING_MODULE]: { ticket_product_variant_id: ticketVariant.id },
          [Modules.PRODUCT]: { product_variant_id: show.variants[0].id },
        },
        { [Modules.PRODUCT]: { product_id: tomatoes.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } },
        { [Modules.PRODUCT]: { product_id: show.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } },
      ])

      return {
        pak: { headers: { "x-publishable-api-key": key.token as string } },
        region: region as { id: string },
        tomatoes: tomatoes.variants[0].id as string,
        show: show.variants[0].id as string,
        /** The line metadata the storefront's seat picker sends (`TicketPurchasePanel`). */
        seat: (seat_number: string) => ({ venue_row_id: row.id as string, seat_number, show_date: SHOW_DATE }),
      }
    }
    type Store = Awaited<ReturnType<typeof makeStore>>

    const send = (request: Promise<any>) => request.catch((e: any) => e.response ?? { status: `no response: ${e?.message}` })

    /** Records what each labelled call answered: its status, and the message of a refusal. */
    function recorder() {
      const answered: Record<string, { status: unknown; message?: string }> = {}
      const call = async (label: string, request: Promise<any>) => {
        const res = await send(request)
        answered[label] = res.status === 200 ? { status: 200 } : { status: res.status, message: res.data?.message }
        return res.status === 200 ? res.data : undefined
      }
      return { answered, call }
    }

    const newCart = async (s: Store) => (await api.post(`/store/carts`, { region_id: s.region.id }, s.pak)).data.cart as { id: string }
    const readCart = async (s: Store, cartId: string) => (await api.get(`/store/carts/${cartId}`, s.pak)).data.cart
    const add = (s: Store, cartId: string, body: Record<string, unknown>) => api.post(`/store/carts/${cartId}/line-items`, body, s.pak)
    const update = (s: Store, cartId: string, lineId: string | undefined, body: Record<string, unknown>) =>
      lineId ? api.post(`/store/carts/${cartId}/line-items/${lineId}`, body, s.pak) : Promise.reject(new Error("no such line"))

    describe("a line that is not a ticket", () => {
      afterEach(settleBeforeTeardown)

      it("is added at the quantity asked, alone or for an order cycle, and raised through the update route as before", async () => {
        const s = await makeStore()
        const cart = await newCart(s)
        const { answered, call } = recorder()

        // addToCart with nothing in the cart: sdk.store.cart.createLineItem at the buyer's quantity.
        const two = await call("add tomatoes x2", add(s, cart.id, { variant_id: s.tomatoes, quantity: 2 }))
        // addCycleProductToCart: the cycle on the line's metadata, which always goes through the add route.
        await call(
          "add tomatoes x3 for an order cycle",
          add(s, cart.id, { variant_id: s.tomatoes, quantity: 3, metadata: { order_cycle_id: "ordcyc_test" } })
        )
        const plainLine = two?.cart?.items?.[0]?.id as string | undefined
        // UpdateCartItemButton's +, on a line that is not a ticket.
        await call("raise the first line to 4", update(s, cart.id, plainLine, { quantity: 4 }))

        expect(answered).toEqual({
          "add tomatoes x2": { status: 200 },
          "add tomatoes x3 for an order cycle": { status: 200 },
          "raise the first line to 4": { status: 200 },
        })

        expect(two.cart.items).toEqual([expect.objectContaining({ variant_id: s.tomatoes, quantity: 2, unit_price: 10 })])
        expect(two.cart).toEqual(expect.objectContaining({ item_total: 20, total: 20 }))

        const after = await readCart(s, cart.id)
        expect(after.items).toHaveLength(2)
        expect(after.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: plainLine, variant_id: s.tomatoes, quantity: 4, unit_price: 10 }),
            expect.objectContaining({
              variant_id: s.tomatoes,
              quantity: 3,
              unit_price: 10,
              metadata: { order_cycle_id: "ordcyc_test" },
            }),
          ])
        )
        expect(after).toEqual(expect.objectContaining({ item_total: 70, total: 70 }))
      })
    })

    describe("a ticket line", () => {
      afterEach(settleBeforeTeardown)

      it("holds one ticket, on the add and on the update route, and every seat rule still refuses", async () => {
        const s = await makeStore()
        const cart = await newCart(s)
        const { answered, call } = recorder()

        await call("add seat 7 x2", add(s, cart.id, { variant_id: s.show, quantity: 2, metadata: s.seat("7") }))
        const empty = await readCart(s, cart.id)

        const one = await call("add seat 7 x1", add(s, cart.id, { variant_id: s.show, quantity: 1, metadata: s.seat("7") }))
        const seatLine = one?.cart?.items?.[0]?.id as string | undefined
        await call("add seat 7 x1 again", add(s, cart.id, { variant_id: s.show, quantity: 1, metadata: s.seat("7") }))
        await call("add seat 8 with no show date", add(s, cart.id, { variant_id: s.show, quantity: 1, metadata: { seat_number: "8" } }))

        // The cart page's + on the seat line.
        await call("raise the seat line to 2", update(s, cart.id, seatLine, { quantity: 2 }))
        // Medusa merges update metadata into the line's, and "" deletes a key.
        await call("drop the seat and raise to 2", update(s, cart.id, seatLine, { quantity: 2, metadata: { seat_number: "" } }))
        const held = await readCart(s, cart.id)

        // A ticket variant on a line naming no seat: still a ticket, as it was before the fix.
        await call("add the show with no seat x2", add(s, cart.id, { variant_id: s.show, quantity: 2 }))
        const seatless = await call("add the show with no seat x1", add(s, cart.id, { variant_id: s.show, quantity: 1 }))
        const seatlessLine = (seatless?.cart?.items ?? []).find((i: any) => i.id !== seatLine)?.id as string | undefined
        // The same again: Medusa would put it into the line above (same variant, metadata both empty).
        await call("add the show with no seat x1 again", add(s, cart.id, { variant_id: s.show, quantity: 1 }))
        await call("raise the seatless ticket line to 2", update(s, cart.id, seatlessLine, { quantity: 2 }))

        // The cart page's delete sends quantity 0 through the same route: still open.
        await call("set the seat line to 0", update(s, cart.id, seatLine, { quantity: 0 }))

        expect(answered).toEqual({
          "add seat 7 x2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "add seat 7 x1": { status: 200 },
          "add seat 7 x1 again": { status: 400, message: `Seat 7 is already in your cart for show date ${SHOW_DATE}` },
          "add seat 8 with no show date": { status: 400, message: expect.stringMatching(/^Show date is required for seat 8 in product prod_/) },
          "raise the seat line to 2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "drop the seat and raise to 2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "add the show with no seat x2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "add the show with no seat x1": { status: 200 },
          "add the show with no seat x1 again": { status: 400, message: ONE_TICKET_PER_SEAT },
          "raise the seatless ticket line to 2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "set the seat line to 0": { status: 200 },
        })

        // The refused add left no line; the refused updates left the seat line as it was.
        expect(empty.items).toEqual([])
        expect(one.cart.items).toEqual([expect.objectContaining({ variant_id: s.show, quantity: 1, unit_price: 5, metadata: s.seat("7") })])
        expect(held.items).toEqual([expect.objectContaining({ id: seatLine, quantity: 1, metadata: s.seat("7") })])
        expect(held).toEqual(expect.objectContaining({ item_total: 5, total: 5 }))

        const after = await readCart(s, cart.id)
        expect(after.items).toEqual([expect.objectContaining({ id: seatlessLine, variant_id: s.show, quantity: 1 })])
        expect(after).toEqual(expect.objectContaining({ item_total: 5, total: 5 }))
      })

      it("left above one by an older cart, can be stepped down through the update route and not raised again", async () => {
        const s = await makeStore()
        const cart = await newCart(s)
        const { answered, call } = recorder()

        const one = await call("add seat 7 x1", add(s, cart.id, { variant_id: s.show, quantity: 1, metadata: s.seat("7") }))
        const seatLine = one?.cart?.items?.[0]?.id as string
        // A cart from before these hooks: the seat line at 3, written past every route.
        await container().resolve(Modules.CART).updateLineItems([{ id: seatLine, quantity: 3 }])

        // A step down that changes the metadata too is judged as any other update.
        await call("step the seat line down to 2, renaming the seat", update(s, cart.id, seatLine, { quantity: 2, metadata: { seat_number: "8" } }))
        // UpdateCartItemButton's -, which sends the quantity alone.
        await call("step the seat line down to 2", update(s, cart.id, seatLine, { quantity: 2 }))
        await call("raise it back to 3", update(s, cart.id, seatLine, { quantity: 3 }))

        expect(answered).toEqual({
          "add seat 7 x1": { status: 200 },
          "step the seat line down to 2, renaming the seat": { status: 400, message: ONE_TICKET_PER_SEAT },
          "step the seat line down to 2": { status: 200 },
          "raise it back to 3": { status: 400, message: ONE_TICKET_PER_SEAT },
        })
        const after = await readCart(s, cart.id)
        expect(after.items).toEqual([expect.objectContaining({ id: seatLine, quantity: 2, metadata: s.seat("7") })])
      })
    })

    describe("a cart created with items", () => {
      afterEach(settleBeforeTeardown)

      it("holds a ticket line to one ticket and a seat to one line, creates any other line at the quantity asked, and leaves no cart when it refuses", async () => {
        const s = await makeStore()
        const carts = container().resolve(Modules.CART)
        const cartsInRegion = async () => (await carts.listCarts({ region_id: s.region.id })).length
        const create = (items: Array<Record<string, unknown>>) => api.post(`/store/carts`, { region_id: s.region.id, items }, s.pak)
        const { answered, call } = recorder()

        const before = await cartsInRegion()
        await call("create with seat 7 x2", create([{ variant_id: s.show, quantity: 2, metadata: s.seat("7") }]))
        await call(
          "create with seat 7 twice",
          create([
            { variant_id: s.show, quantity: 1, metadata: s.seat("7") },
            { variant_id: s.show, quantity: 1, metadata: s.seat("7") },
          ])
        )
        await call("create with the show with no seat x2", create([{ variant_id: s.show, quantity: 2 }]))
        await call("create with seat 8 with no show date", create([{ variant_id: s.show, quantity: 1, metadata: { seat_number: "8" } }]))
        const afterRefusals = await cartsInRegion()

        const made = await call(
          "create with tomatoes x2, seat 7 and seat 8",
          create([
            { variant_id: s.tomatoes, quantity: 2 },
            { variant_id: s.show, quantity: 1, metadata: s.seat("7") },
            { variant_id: s.show, quantity: 1, metadata: s.seat("8") },
          ])
        )

        expect(answered).toEqual({
          "create with seat 7 x2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "create with seat 7 twice": { status: 400, message: `Seat 7 is already in your cart for show date ${SHOW_DATE}` },
          "create with the show with no seat x2": { status: 400, message: ONE_TICKET_PER_SEAT },
          "create with seat 8 with no show date": {
            status: 400,
            message: expect.stringMatching(/^Show date is required for seat 8 in product prod_/),
          },
          "create with tomatoes x2, seat 7 and seat 8": { status: 200 },
        })

        expect(afterRefusals).toBe(before)
        expect(made.cart.items).toHaveLength(3)
        expect(made.cart.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ variant_id: s.tomatoes, quantity: 2, unit_price: 10 }),
            expect.objectContaining({ variant_id: s.show, quantity: 1, unit_price: 5, metadata: s.seat("7") }),
            expect.objectContaining({ variant_id: s.show, quantity: 1, unit_price: 5, metadata: s.seat("8") }),
          ])
        )
        expect(made.cart).toEqual(expect.objectContaining({ item_total: 30, total: 30 }))
      })
    })
  },
})
