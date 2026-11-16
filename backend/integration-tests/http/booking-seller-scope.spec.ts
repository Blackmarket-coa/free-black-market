import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { WELLNESS_MODULE } from "../../src/modules/wellness"
import { BOOKING_MODULE } from "../../src/modules/booking"
import { BookingStatus } from "../../src/modules/booking/models/booking"
import { WellnessAutomationService } from "../../src/modules/wellness/automation-service"
import { logger } from "../../src/shared/logger"
import linkBookingOnOrderPlaced from "../../src/subscribers/link-booking-on-order-placed"
import wellnessRemindersJob from "../../src/jobs/wellness-reminders"
import { POST as saveConfig } from "../../src/api/vendor/bookings/config/route"
import { POST as createSessionType } from "../../src/api/vendor/wellness/session-types/route"
import { POST as updateSessionType } from "../../src/api/vendor/wellness/session-types/[id]/route"
import { POST as embedBook } from "../../src/api/store/embed/bookings/route"
import { GET as availability } from "../../src/api/store/vendors/[handle]/availability/route"
import { cardOrderFixtures } from "./helpers/card-orders"

jest.setTimeout(240 * 1000)

/**
 * SD-81 addendum, on a real migrated database: the booking module's sibling
 * of the cross-seller flaw SD-81 closed for wellness classes and tiers.
 *
 * POST /vendor/bookings/config and POST /vendor/wellness/session-types wrote a
 * product_booking_config for any product id with seller_id = the caller, the
 * session-type update spread the whole body into the row, and the config
 * lookup took the product alone. Product ids are public, and product_id is
 * unique on the config table, so seller B could make seller A's product
 * bookable under B: B's embed key booked A's product and deep-linked its
 * checkout to A's product page, order.placed then confirmed B's booking with
 * A's order and A's customer, and A could neither book its own product (the
 * embed route found B's config and refused A's key) nor configure it (the
 * create hit the unique constraint).
 *
 * Handlers and the subscriber are called directly, with a seller actor or an
 * embed key's seller, as wellness-seller-scope.spec.ts does.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, uid, makeSeller } = cardOrderFixtures(getContainer)
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const booking = () => container().resolve(BOOKING_MODULE)
    const wellness = () => container().resolve(WELLNESS_MODULE)

    const HOUR = 3_600_000
    const DAY = 24 * HOUR
    const REFUSED = { status: 403, json: { message: "You do not have access to this record.", type: "not_allowed" } }

    async function makeProduct(sellerId: string) {
      const id = uid()
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([{ title: `Session ${id}`, handle: `session-${id}`, status: "published" }])
      await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      return product as { id: string; handle: string }
    }
    /** Open 09:00-17:00 every day, so any config of this seller has slots. */
    async function openEveryDay(sellerId: string) {
      await booking().createVendorAvailabilities(
        [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({ seller_id: sellerId, day_of_week, start_time: "09:00", end_time: "17:00" }))
      )
    }
    /**
     * A config written straight to the table: a row from before the vendor
     * routes checked ownership, or any other writer. The routes now refuse it.
     */
    async function foreignConfig(sellerId: string, productId: string, fields: Record<string, unknown> = {}) {
      return (await booking().createProductBookingConfigs({
        seller_id: sellerId,
        product_id: productId,
        timezone: "UTC",
        duration_minutes: 60,
        ...fields,
      })) as { id: string }
    }
    /** 10:00 UTC three days out: a slot of a UTC, 60-minute config with the default 24h notice. */
    function slot() {
      const d = new Date(Date.now() + 3 * DAY)
      const date = d.toISOString().slice(0, 10)
      return { date, starts_at: `${date}T10:00:00.000Z` }
    }
    async function makeCustomer() {
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: `buyer-${uid()}@example.com` }])
      return customer as { id: string; email: string }
    }
    /**
     * A placed order carrying `bookingId`, linked to `sellerId` as Mercur's
     * split links it, or to no seller (`null`) as FBM's non-split completions
     * leave it.
     */
    async function makeOrder(sellerId: string | null, productIds: string[], buyer: { id: string; email: string }, bookingId: string) {
      const [order] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            customer_id: buyer.id,
            email: buyer.email,
            metadata: { booking_id: bookingId },
            items: productIds.map((product_id) => ({ title: "Session", product_id, quantity: 1, unit_price: 80 })),
          },
        ])
      if (sellerId) await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.ORDER]: { order_id: order.id } })
      return order as { id: string }
    }
    async function makeBooking(sellerId: string, productId: string) {
      const starts = new Date(Date.now() + 3 * DAY)
      return (await booking().createBookings({
        seller_id: sellerId,
        product_id: productId,
        customer_email: `booker-${uid()}@example.com`,
        starts_at: starts,
        ends_at: new Date(starts.getTime() + HOUR),
        status: BookingStatus.PENDING,
      })) as { id: string }
    }
    const placed = (orderId: string) => ({ event: { data: { id: orderId } }, container: container() }) as any

    function fakeRes() {
      const out: { status: number; json: any } = { status: 200, json: null }
      const res: any = {
        status(code: number) {
          out.status = code
          return res
        },
        json(j: unknown) {
          out.json = j
          return res
        },
        setHeader() {
          return res
        },
      }
      return { out, res }
    }
    /** Call a vendor route handler as `sellerId`. */
    async function call(handler: any, sellerId: string, opts: { body?: unknown; params?: Record<string, string> } = {}) {
      const { out, res } = fakeRes()
      await handler(
        {
          auth_context: { actor_id: sellerId, actor_type: "seller" },
          scope: container(),
          headers: {},
          body: opts.body ?? {},
          params: opts.params ?? {},
          query: {},
        },
        res
      )
      return out
    }
    /** POST /store/embed/bookings with an embed key of `sellerId`. */
    async function embed(sellerId: string, productId: string, startsAt: string) {
      const { out, res } = fakeRes()
      await embedBook(
        {
          embed_seller_id: sellerId,
          scope: container(),
          headers: {},
          body: { product_id: productId, starts_at: startsAt, customer_email: `visitor-${uid()}@example.com` },
          params: {},
          query: {},
        } as any,
        res
      )
      return out
    }
    async function slotsOf(handle: string, productId: string, date: string) {
      const { out, res } = fakeRes()
      await availability({ scope: container(), headers: {}, params: { handle }, query: { product_id: productId, date } } as any, res)
      return out
    }

    let warn: jest.SpyInstance
    let notify: jest.SpyInstance
    beforeEach(() => {
      // Every createLogger() logger shares this prototype.
      warn = jest.spyOn(Object.getPrototypeOf(logger), "warn")
      notify = jest.spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications").mockResolvedValue([])
    })
    afterEach(() => {
      warn.mockRestore()
      notify.mockRestore()
    })
    const configsOf = (productId: string) => booking().listProductBookingConfigs({ product_id: productId })

    describe("vendor booking writes take only the caller's own products", () => {
      it("POST /vendor/bookings/config: another seller's product, or none, is 403 and writes nothing; the caller's own is saved", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productB = await makeProduct(sellerB.id)

        expect(await call(saveConfig, sellerB.id, { body: { product_id: productA.id } })).toEqual(REFUSED)
        // A product that does not exist answers the same.
        expect(await call(saveConfig, sellerB.id, { body: { product_id: "prod_does_not_exist" } })).toEqual(REFUSED)
        expect(await configsOf(productA.id)).toEqual([])

        const own = await call(saveConfig, sellerB.id, { body: { product_id: productB.id, duration_minutes: 30 } })
        expect(own.status).toBe(200)
        expect(own.json.config).toEqual(expect.objectContaining({ seller_id: sellerB.id, product_id: productB.id, duration_minutes: 30 }))
      })

      it("B's config on A's product: B can no longer touch it, and A's save takes the row over with every field A's", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        await foreignConfig(sellerB.id, productA.id, { timezone: "Asia/Tokyo", advance_days: 365, min_notice_hours: 0, buffer_minutes: 90 })

        expect(await call(saveConfig, sellerB.id, { body: { product_id: productA.id, timezone: "UTC" } })).toEqual(REFUSED)

        // product_id is unique on the table: this create used to fail on it (500).
        const own = await call(saveConfig, sellerA.id, { body: { product_id: productA.id, duration_minutes: 45 } })
        expect(own.status).toBe(200)
        const rows = await configsOf(productA.id)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toEqual(
          expect.objectContaining({
            seller_id: sellerA.id,
            duration_minutes: 45,
            buffer_minutes: 0,
            timezone: "America/New_York",
            advance_days: 30,
            min_notice_hours: 24,
            is_active: true,
          })
        )
        expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(
          expect.arrayContaining([expect.stringContaining(`took over product ${productA.id}'s booking config from seller ${sellerB.id}`)])
        )
      })

      it("POST /vendor/wellness/session-types: another seller's product is 403 and creates neither a session type nor a config", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productB = await makeProduct(sellerB.id)

        expect(await call(createSessionType, sellerB.id, { body: { name: "Reiki", product_id: productA.id } })).toEqual(REFUSED)
        expect(await call(createSessionType, sellerB.id, { body: { name: "Reiki", product_id: "prod_does_not_exist" } })).toEqual(REFUSED)
        expect(await wellness().listSessionTypes({ seller_id: sellerB.id })).toEqual([])
        expect(await configsOf(productA.id)).toEqual([])

        expect((await call(createSessionType, sellerB.id, { body: { name: "Reiki", timezone: "Mars/Olympus" } })).status).toBe(400)

        const own = await call(createSessionType, sellerB.id, { body: { name: "Reiki", product_id: productB.id, duration_minutes: 50 } })
        expect(own.status).toBe(201)
        expect(own.json.session_type).toEqual(expect.objectContaining({ seller_id: sellerB.id, product_id: productB.id }))
        expect(await configsOf(productB.id)).toEqual([expect.objectContaining({ seller_id: sellerB.id, duration_minutes: 50 })])
      })

      it("A's session type on A's product takes over B's config on it; A's own config is left as A set it", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        await foreignConfig(sellerB.id, productA.id, { advance_days: 365, min_notice_hours: 0 })

        const st = await call(createSessionType, sellerA.id, {
          body: { name: "Breathwork", product_id: productA.id, duration_minutes: 30, timezone: "Europe/Paris" },
        })
        expect(st.status).toBe(201)
        expect(await configsOf(productA.id)).toEqual([
          expect.objectContaining({
            seller_id: sellerA.id,
            duration_minutes: 30,
            timezone: "Europe/Paris",
            advance_days: 30,
            min_notice_hours: 24,
            is_active: true,
          }),
        ])

        // A second session type on the product does not overwrite A's config.
        await call(saveConfig, sellerA.id, { body: { product_id: productA.id, duration_minutes: 90, is_active: false } })
        expect((await call(createSessionType, sellerA.id, { body: { name: "Again", product_id: productA.id } })).status).toBe(201)
        expect(await configsOf(productA.id)).toEqual([expect.objectContaining({ seller_id: sellerA.id, duration_minutes: 90, is_active: false })])
      })

      it("updating a session type: another seller's product is 403 and changes nothing; fields off the allow-list are ignored", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productB = await makeProduct(sellerB.id)
        const st = (await wellness().createSessionTypes({ seller_id: sellerB.id, name: "Reiki", product_id: productB.id })) as { id: string }

        expect(await call(updateSessionType, sellerB.id, { params: { id: st.id }, body: { product_id: productA.id, name: "Renamed" } })).toEqual(
          REFUSED
        )
        expect(await wellness().retrieveSessionType(st.id)).toEqual(expect.objectContaining({ product_id: productB.id, name: "Reiki" }))

        const ok = await call(updateSessionType, sellerB.id, {
          params: { id: st.id },
          body: { name: "Renamed", seller_id: sellerA.id, metadata: { x: 1 }, created_at: "2000-01-01T00:00:00Z", product_id: null },
        })
        expect(ok.status).toBe(200)
        const row = await wellness().retrieveSessionType(st.id)
        expect(row).toEqual(expect.objectContaining({ name: "Renamed", seller_id: sellerB.id, metadata: null, product_id: null }))
        expect(new Date(row.created_at).getUTCFullYear()).not.toBe(2000)

        const relinked = await call(updateSessionType, sellerB.id, { params: { id: st.id }, body: { product_id: productB.id } })
        expect(relinked.status).toBe(200)
        expect(await wellness().retrieveSessionType(st.id)).toEqual(expect.objectContaining({ product_id: productB.id }))
      })
    })

    describe("the embed route and the availability lookup go by the product's own seller", () => {
      it("B's config on A's product books nothing for B's key; A, once it saves its own config, books, past B's old booking", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        await openEveryDay(sellerA.id)
        await openEveryDay(sellerB.id)
        const productA = await makeProduct(sellerA.id)
        await foreignConfig(sellerB.id, productA.id)
        const { starts_at } = slot()

        // Used to be 201, with a checkout link to A's product page.
        const byB = await embed(sellerB.id, productA.id, starts_at)
        expect(byB.status).toBe(404)
        // A has no config of its own on the product yet; B's is not A's.
        expect((await embed(sellerA.id, productA.id, starts_at)).status).toBe(404)
        expect(await booking().listBookings({ product_id: productA.id })).toEqual([])

        // A booking B's key made on A's product before the fix holds no slot of A's.
        await booking().createBookings({
          seller_id: sellerB.id,
          product_id: productA.id,
          customer_email: "old@example.com",
          starts_at: new Date(starts_at),
          ends_at: new Date(Date.parse(starts_at) + HOUR),
          status: BookingStatus.PENDING,
        })

        expect((await call(saveConfig, sellerA.id, { body: { product_id: productA.id, timezone: "UTC" } })).status).toBe(200)
        const byA = await embed(sellerA.id, productA.id, starts_at)
        expect(byA.status).toBe(201)
        expect(byA.json.checkout_url).toContain(`/products/${productA.handle}?booking_id=${byA.json.booking.id}`)
        expect(await booking().retrieveBooking(byA.json.booking.id)).toEqual(
          expect.objectContaining({ seller_id: sellerA.id, product_id: productA.id, status: BookingStatus.PENDING })
        )
        expect((await embed(sellerB.id, productA.id, starts_at)).status).toBe(404)
      })

      it("availability: B's handle shows no slots for A's product, even over B's config on it; A's handle shows A's", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        await openEveryDay(sellerA.id)
        await openEveryDay(sellerB.id)
        const productA = await makeProduct(sellerA.id)
        await foreignConfig(sellerB.id, productA.id, { timezone: "Asia/Tokyo" })
        const { date } = slot()

        expect((await slotsOf(sellerB.handle, productA.id, date)).json).toEqual(
          expect.objectContaining({ slots: [], timezone: null, duration_minutes: null })
        )
        expect((await slotsOf(sellerA.handle, productA.id, date)).json).toEqual(expect.objectContaining({ slots: [], timezone: null }))

        await call(saveConfig, sellerA.id, { body: { product_id: productA.id, timezone: "UTC" } })
        const own = (await slotsOf(sellerA.handle, productA.id, date)).json
        expect(own.timezone).toBe("UTC")
        expect(own.slots).toEqual(expect.arrayContaining([expect.objectContaining({ starts_at: slot().starts_at })]))
        expect((await slotsOf(sellerB.handle, productA.id, date)).json.slots).toEqual([])
      })
    })

    describe("order.placed confirms a booking only for the seller who sold its product on that order", () => {
      it("B's booking on A's product is not confirmed by A's order and gets none of A's order, customer or email", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        await foreignConfig(sellerB.id, productA.id)
        // What B's embed key made before the fix.
        const bookingB = await makeBooking(sellerB.id, productA.id)

        const buyer = await makeCustomer()
        const order = await makeOrder(sellerA.id, [productA.id], buyer, bookingB.id)
        await linkBookingOnOrderPlaced(placed(order.id))
        // An order with no seller link (a non-split completion): the product's
        // own seller link is all that refuses it.
        const unlinked = await makeOrder(null, [productA.id], buyer, bookingB.id)
        await linkBookingOnOrderPlaced(placed(unlinked.id))

        expect(await booking().retrieveBooking(bookingB.id)).toEqual(
          expect.objectContaining({ status: BookingStatus.PENDING, order_id: null, customer_id: null })
        )
        expect(notify).not.toHaveBeenCalled()
        const warnings = warn.mock.calls.map((c) => String(c[0]))
        for (const o of [order, unlinked]) {
          expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining(`order ${o.id}: booking ${bookingB.id} of seller ${sellerB.id}`)]))
        }
      })

      it("A's booking is not confirmed by another seller's order of the same cart, and is by A's own, with its id and customer", async () => {
        const sellerA = await makeSeller()
        const sellerC = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productC = await makeProduct(sellerC.id)
        const bookingA = await makeBooking(sellerA.id, productA.id)
        const buyer = await makeCustomer()

        const stillPending = async () =>
          expect(await booking().retrieveBooking(bookingA.id)).toEqual(expect.objectContaining({ status: BookingStatus.PENDING, order_id: null }))

        // Mercur splits a cart into one order per seller; each carries the cart's booking_id.
        const orderC = await makeOrder(sellerC.id, [productC.id], buyer, bookingA.id)
        await linkBookingOnOrderPlaced(placed(orderC.id))
        await stillPending()
        // No seller link and no line for the booking's product.
        const unlinked = await makeOrder(null, [productC.id], buyer, bookingA.id)
        await linkBookingOnOrderPlaced(placed(unlinked.id))
        await stillPending()
        // A's product on an order linked to another seller (not what Mercur's
        // split writes): the order's seller link must agree too.
        const mislinked = await makeOrder(sellerC.id, [productA.id], buyer, bookingA.id)
        await linkBookingOnOrderPlaced(placed(mislinked.id))
        await stillPending()
        expect(notify).not.toHaveBeenCalled()

        const orderA = await makeOrder(sellerA.id, [productA.id], buyer, bookingA.id)
        await linkBookingOnOrderPlaced(placed(orderA.id))
        expect(await booking().retrieveBooking(bookingA.id)).toEqual(
          expect.objectContaining({ status: BookingStatus.CONFIRMED, order_id: orderA.id, customer_id: buyer.id })
        )
        expect(notify).toHaveBeenCalledTimes(1)
        expect(notify.mock.calls[0][0]).toEqual(expect.objectContaining({ template: "booking-confirmation" }))
      })
    })

    describe("the 24-hour booking reminder reads the booking seller's own config", () => {
      it("A's booking on A's product is not timed on B's config on it", async () => {
        const runTrigger = jest.spyOn(WellnessAutomationService.prototype, "runTrigger").mockResolvedValue({ sent: 1, skipped: 0 })
        try {
          const sellerA = await makeSeller()
          const sellerB = await makeSeller()
          const productA = await makeProduct(sellerA.id)
          await foreignConfig(sellerB.id, productA.id, { timezone: "Asia/Tokyo" })
          await wellness().createSessionTypes({ seller_id: sellerA.id, product_id: productA.id, name: "Reiki" })
          const starts = new Date(Date.now() + 23.5 * HOUR)
          await booking().createBookings({
            seller_id: sellerA.id,
            product_id: productA.id,
            customer_email: "tomorrow@example.com",
            starts_at: starts,
            ends_at: new Date(starts.getTime() + HOUR),
            status: BookingStatus.CONFIRMED,
          })

          await wellnessRemindersJob(container())

          const sent = runTrigger.mock.calls
            .map((c) => c[0] as { seller_id: string; trigger: string; vars: Record<string, unknown> })
            .filter((c) => c.seller_id === sellerA.id && c.trigger === "booking_reminder_24h")
          expect(sent).toHaveLength(1)
          // A has no config of its own on the product (product_id is unique, and
          // B's row holds it), so the job's no-zone fallback, UTC: not B's Tokyo.
          expect(sent[0].vars).toEqual(expect.objectContaining({ session_type: "Reiki", time: expect.stringMatching(/ UTC$/) }))
        } finally {
          runTrigger.mockRestore()
        }
      })
    })
  },
})
