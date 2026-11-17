import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { WELLNESS_MODULE } from "../../src/modules/wellness"
import { BOOKING_MODULE } from "../../src/modules/booking"
import { WellnessAutomationService } from "../../src/modules/wellness/automation-service"
import { logger } from "../../src/shared/logger"
import wellnessOrderPlaced from "../../src/subscribers/wellness-order-placed"
import wellnessRemindersJob from "../../src/jobs/wellness-reminders"
import { POST as createClass } from "../../src/api/vendor/wellness/classes/route"
import { POST as updateClass } from "../../src/api/vendor/wellness/classes/[id]/route"
import { GET as roster } from "../../src/api/vendor/wellness/classes/[id]/attendees/route"
import { POST as createTier } from "../../src/api/vendor/wellness/memberships/route"
import { POST as updateTier } from "../../src/api/vendor/wellness/memberships/[id]/route"
import { cardOrderFixtures } from "./helpers/card-orders"

jest.setTimeout(240 * 1000)

/**
 * SD-52 re-review, on a real migrated database. Fixing the order read
 * (SD-52) switched on the wellness order subscriber, and with it:
 *
 * - Cross-seller linking. The subscriber found classes and membership tiers
 *   by product id alone, and the vendor routes stored whatever product id
 *   they were sent (the class and tier updates spread the whole body into the
 *   row). Product ids are public, so seller B could point a class or tier at
 *   seller A's product, and every order for it seated A's buyer in B's class
 *   or made them B's member: B's roster showed their email and customer id,
 *   and B's automation messaged them.
 * - The hourly reminder job reminded every attendee on every run (up to 24
 *   times), on the server's clock.
 * - The "You're registered" message arrived with literal [date] [time] [link].
 * - registerForClass read, inserted, then wrote `status: "open"` back, so a
 *   vendor cancel landing mid-registration was reopened, and two buyers of the
 *   last seat were both seated.
 *
 * Orders are made through the order module and linked to their seller as
 * Mercur's split links them; handlers are called directly with a seller
 * actor, as integration-tests/http/order-items-quantity-read.spec.ts does.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, uid, makeSeller } = cardOrderFixtures(getContainer)
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const wellness = () => container().resolve(WELLNESS_MODULE)

    const HOUR = 3_600_000
    const DAY = 24 * HOUR

    async function makeProduct(sellerId: string) {
      const id = uid()
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([{ title: `Ticket ${id}`, handle: `ticket-${id}`, status: "published" }])
      await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      return product as { id: string }
    }
    async function makeCustomer() {
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: `buyer-${uid()}@example.com` }])
      return customer as { id: string; email: string }
    }
    /** A placed order for `productIds`, linked to `sellerId` as Mercur's split links it. */
    async function makeOrder(sellerId: string, productIds: string[], buyer: { id: string; email: string }) {
      const [order] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            customer_id: buyer.id,
            email: buyer.email,
            items: productIds.map((product_id) => ({ title: "Ticket", product_id, quantity: 1, unit_price: 25 })),
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.ORDER]: { order_id: order.id } })
      return order as { id: string }
    }
    async function makeClass(sellerId: string, fields: Record<string, unknown> = {}) {
      return (await wellness().createClassEvents({
        seller_id: sellerId,
        title: "Sound bath",
        starts_at: new Date(Date.now() + DAY),
        ends_at: new Date(Date.now() + DAY + HOUR),
        capacity: 5,
        seats_taken: 0,
        status: "open",
        ...fields,
      })) as { id: string; product_id: string | null; seller_id: string }
    }
    const placed = (orderId: string) => ({ event: { data: { id: orderId } }, container: container() }) as any

    /**
     * Call a vendor route handler as `sellerId`, as a request the vendor gate
     * let through. In production `ensureSellerContext` runs before every
     * /vendor handler and attaches the store it resolved (`_seller_id`, with
     * `_sellerContextResolved`); a bare seller id without them is refused by
     * `requireSellerId`, since a seller-id actor acts for its store only
     * through the live member at its login's address (SD-144). Called
     * directly, the handler gets what the gate would have attached.
     */
    async function call(handler: any, sellerId: string, opts: { body?: unknown; params?: Record<string, string> } = {}) {
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
      }
      const req: any = {
        auth_context: { actor_id: sellerId, actor_type: "seller" },
        _seller_id: sellerId,
        _sellerContextResolved: true,
        scope: container(),
        headers: {},
        body: opts.body ?? {},
        params: opts.params ?? {},
        query: {},
      }
      await handler(req, res)
      return out
    }

    let runTrigger: jest.SpyInstance
    let warn: jest.SpyInstance
    beforeEach(() => {
      runTrigger = jest.spyOn(WellnessAutomationService.prototype, "runTrigger").mockResolvedValue({ sent: 1, skipped: 0 })
      // Every createLogger() logger shares this prototype.
      warn = jest.spyOn(Object.getPrototypeOf(logger), "warn")
    })
    afterEach(() => {
      runTrigger.mockRestore()
      warn.mockRestore()
    })
    const triggersFor = (sellerId: string) =>
      runTrigger.mock.calls
        .map((c) => c[0] as { seller_id: string; trigger: string; vars: Record<string, unknown>; recipients: unknown[] })
        .filter((c) => c.seller_id === sellerId)
    const warningsFor = (orderId: string) =>
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wellness-order-placed]") && m.includes(orderId))

    describe("the order subscriber hands a buyer only to the seller who sold the line", () => {
      it("B's class on A's product seats nobody: B's roster stays empty and B sends nothing", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        // Written straight to the table: a row from before the route check, or
        // any other writer. The route itself now refuses this (below).
        const classB = await makeClass(sellerB.id, { product_id: productA.id })

        const buyer = await makeCustomer()
        const order = await makeOrder(sellerA.id, [productA.id], buyer)
        await wellnessOrderPlaced(placed(order.id))

        const r = await call(roster, sellerB.id, { params: { id: classB.id } })
        expect(r.status).toBe(200)
        expect(r.json.attendees).toEqual([])
        expect(await wellness().retrieveClassEvent(classB.id)).toEqual(expect.objectContaining({ seats_taken: 0, status: "open" }))
        expect(triggersFor(sellerB.id)).toEqual([])
        expect(warningsFor(order.id)).toEqual([expect.stringContaining(`class ${classB.id} of seller ${sellerB.id}`)])
      })

      it("beside B's class and B's tier on the same product, A's own class seats A's buyer and B gets no member", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const classA = await makeClass(sellerA.id, { product_id: productA.id, title: "A's class" })
        const classB = await makeClass(sellerB.id, { product_id: productA.id, title: "B's class" })
        const tierB = (await wellness().createMembershipTiers({
          seller_id: sellerB.id,
          product_id: productA.id,
          name: "B tier",
          credits_per_period: 3,
        })) as { id: string }

        const buyer = await makeCustomer()
        const order = await makeOrder(sellerA.id, [productA.id], buyer)
        await wellnessOrderPlaced(placed(order.id))

        // B's class no longer makes A's product ambiguous: A's class seats.
        expect(await wellness().listClassAttendees({ class_event_id: classA.id })).toEqual([
          expect.objectContaining({ seller_id: sellerA.id, order_id: order.id, customer_email: buyer.email, status: "registered" }),
        ])
        expect(await wellness().listClassAttendees({ class_event_id: classB.id })).toEqual([])
        expect(await wellness().listMembers({ seller_id: sellerB.id })).toEqual([])
        expect(await wellness().listMembers({ membership_tier_id: tierB.id })).toEqual([])
        expect(triggersFor(sellerB.id)).toEqual([])
        expect(triggersFor(sellerA.id).map((c) => c.trigger)).toEqual(["class_registered"])
        const warnings = warningsFor(order.id)
        expect(warnings).toHaveLength(2)
        expect(warnings.some((w) => w.includes(`class ${classB.id}`))).toBe(true)
        expect(warnings.some((w) => w.includes(`membership tier ${tierB.id}`))).toBe(true)
      })

      it("B's tier on A's product creates no member and sends no welcome; A's own tier still does", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const tierA = (await wellness().createMembershipTiers({
          seller_id: sellerA.id,
          product_id: productA.id,
          name: "A tier",
          credits_per_period: 2,
        })) as { id: string }
        await wellness().createMembershipTiers({ seller_id: sellerB.id, product_id: productA.id, name: "B tier", credits_per_period: 9 })

        const buyer = await makeCustomer()
        const order = await makeOrder(sellerA.id, [productA.id], buyer)
        await wellnessOrderPlaced(placed(order.id))

        expect(await wellness().listMembers({ seller_id: sellerB.id })).toEqual([])
        expect(await wellness().listMembers({ seller_id: sellerA.id })).toEqual([
          expect.objectContaining({ membership_tier_id: tierA.id, email: buyer.email, credits_balance: 2 }),
        ])
        expect(triggersFor(sellerB.id)).toEqual([])
        expect(triggersFor(sellerA.id).map((c) => c.trigger)).toEqual(["membership_welcome"])
      })

      it("a line on an order Mercur linked to another seller seats nobody, even in the product owner's own class", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productB = await makeProduct(sellerB.id)
        const classB = await makeClass(sellerB.id, { product_id: productB.id })

        const buyer = await makeCustomer()
        // Not something Mercur's split writes (it groups lines by the
        // product's seller); the order's link and the product's must agree.
        const order = await makeOrder(sellerA.id, [productB.id], buyer)
        await wellnessOrderPlaced(placed(order.id))

        expect(await wellness().listClassAttendees({ class_event_id: classB.id })).toEqual([])
        expect(triggersFor(sellerB.id)).toEqual([])
        expect(warningsFor(order.id)).toEqual([expect.stringContaining("which no seller of this order sold")])
      })
    })

    describe("the vendor class and tier routes take only the caller's own products", () => {
      it("creating a class with another seller's product is 403 and creates nothing; the caller's own product is stored", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productB = await makeProduct(sellerB.id)
        const when = { starts_at: new Date(Date.now() + DAY).toISOString(), ends_at: new Date(Date.now() + DAY + HOUR).toISOString() }

        const refused = await call(createClass, sellerB.id, { body: { title: "Grab", ...when, product_id: productA.id } })
        expect(refused).toEqual({ status: 403, json: { message: "You do not have access to this record.", type: "not_allowed" } })
        // A product that does not exist answers the same.
        const missing = await call(createClass, sellerB.id, { body: { title: "Grab", ...when, product_id: "prod_does_not_exist" } })
        expect(missing).toEqual(refused)
        expect(await wellness().listClassEvents({ seller_id: sellerB.id })).toEqual([])

        const own = await call(createClass, sellerB.id, { body: { title: "Mine", ...when, product_id: productB.id } })
        expect(own.status).toBe(201)
        expect(own.json.class).toEqual(expect.objectContaining({ seller_id: sellerB.id, product_id: productB.id }))

        const badZone = await call(createClass, sellerB.id, { body: { title: "Mine", ...when, timezone: "Mars/Olympus" } })
        expect(badZone.status).toBe(400)
      })

      it("updating a class: another seller's product is 403 and changes nothing; fields off the allow-list are ignored", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productB = await makeProduct(sellerB.id)
        const classB = await makeClass(sellerB.id, { product_id: productB.id, seats_taken: 2 })

        const refused = await call(updateClass, sellerB.id, { params: { id: classB.id }, body: { product_id: productA.id, title: "Renamed" } })
        expect(refused.status).toBe(403)
        expect(await wellness().retrieveClassEvent(classB.id)).toEqual(
          expect.objectContaining({ product_id: productB.id, title: "Sound bath" })
        )

        const ok = await call(updateClass, sellerB.id, {
          params: { id: classB.id },
          body: { title: "Renamed", seller_id: sellerA.id, seats_taken: 0, metadata: { class_reminder: { starts_at: "x" } }, product_id: null },
        })
        expect(ok.status).toBe(200)
        expect(await wellness().retrieveClassEvent(classB.id)).toEqual(
          expect.objectContaining({ title: "Renamed", seller_id: sellerB.id, seats_taken: 2, metadata: null, product_id: null })
        )
      })

      it("updating a tier: another seller's product is 403 and changes nothing; the caller's own product is linked", async () => {
        const sellerA = await makeSeller()
        const sellerB = await makeSeller()
        const productA = await makeProduct(sellerA.id)
        const productB = await makeProduct(sellerB.id)
        const t = await call(createTier, sellerB.id, { body: { name: "B tier", credits_per_period: 2 } })
        expect(t.status).toBe(201)
        const tierId = t.json.membership_tier.id as string

        const refused = await call(updateTier, sellerB.id, { params: { id: tierId }, body: { product_id: productA.id } })
        expect(refused.status).toBe(403)
        expect(await wellness().retrieveMembershipTier(tierId)).toEqual(expect.objectContaining({ product_id: null }))

        const ok = await call(updateTier, sellerB.id, { params: { id: tierId }, body: { product_id: productB.id, seller_id: sellerA.id, name: "Root" } })
        expect(ok.status).toBe(200)
        expect(await wellness().retrieveMembershipTier(tierId)).toEqual(
          expect.objectContaining({ product_id: productB.id, seller_id: sellerB.id, name: "Root" })
        )
      })
    })

    describe("class messages", () => {
      it("'You're registered' carries the date and time on the class's clock and its link, with no literal tokens", async () => {
        runTrigger.mockRestore()
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        // 03:00 UTC two days out; Asia/Kolkata (no daylight saving) reads 08:30.
        const d = new Date(Date.now() + 2 * DAY)
        const startsAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0))
        await makeClass(seller.id, {
          product_id: product.id,
          starts_at: startsAt,
          ends_at: new Date(startsAt.getTime() + HOUR),
          timezone: "Asia/Kolkata",
          location_detail: "https://meet.example/sound-bath",
        })
        await wellness().seedDefaultAutomationTemplates(seller.id)
        const [tpl] = await wellness().listAutomationTemplates({ seller_id: seller.id, trigger: "class_registered" })
        await wellness().updateAutomationTemplates({ id: tpl.id, enabled: true, channel: "email" })
        const send = jest.spyOn(WellnessAutomationService.prototype, "sendDM").mockResolvedValue({ channel: "email", ok: true })
        try {
          const buyer = await makeCustomer()
          const order = await makeOrder(seller.id, [product.id], buyer)
          await wellnessOrderPlaced(placed(order.id))

          const bodies = send.mock.calls.map((c) => (c[0] as { body: string }).body)
          // The wall-clock date in Kolkata, computed without the zone database.
          const kolkataDate = new Date(startsAt.getTime() + 5.5 * HOUR).toLocaleDateString("en-US", {
            timeZone: "UTC",
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          expect(bodies).toEqual([
            `You're registered for Sound bath on ${kolkataDate} at 8:30 AM GMT+5:30! ` +
              "Here's what to bring and where to meet: https://meet.example/sound-bath",
          ])
        } finally {
          send.mockRestore()
          runTrigger = jest.spyOn(WellnessAutomationService.prototype, "runTrigger").mockResolvedValue({ sent: 1, skipped: 0 })
        }
      })
    })

    describe("the hourly reminder job", () => {
      const remindersFor = (sellerId: string) => triggersFor(sellerId).filter((c) => c.trigger === "class_reminder")

      async function classSoon(timezone = "Asia/Kolkata") {
        const seller = await makeSeller()
        const cls = await makeClass(seller.id, {
          title: "Soon",
          starts_at: new Date(Date.now() + 2 * HOUR),
          ends_at: new Date(Date.now() + 3 * HOUR),
          timezone,
        })
        await wellness().registerForClass({ seller_id: seller.id, class_event_id: cls.id, email: `a-${uid()}@example.com` })
        return { seller, cls }
      }

      it("two runs remind a class's attendees once, with the date and time on the class's clock", async () => {
        const { seller, cls } = await classSoon()

        await wellnessRemindersJob(container())
        await wellnessRemindersJob(container())

        const reminders = remindersFor(seller.id)
        expect(reminders).toHaveLength(1)
        const startsAt = new Date((await wellness().retrieveClassEvent(cls.id)).starts_at)
        const kolkata = new Date(startsAt.getTime() + 5.5 * HOUR)
        const hh = kolkata.getUTCHours() % 12 || 12
        const mm = String(kolkata.getUTCMinutes()).padStart(2, "0")
        const ampm = kolkata.getUTCHours() < 12 ? "AM" : "PM"
        expect(reminders[0].vars).toEqual(
          expect.objectContaining({ session_type: "Soon", time: `${hh}:${mm} ${ampm} GMT+5:30`, date: expect.any(String) })
        )
        expect((await wellness().retrieveClassEvent(cls.id)).metadata).toEqual({
          class_reminder: { starts_at: startsAt.toISOString(), sent_at: expect.any(String) },
        })
      })

      it("a run that reached nobody gives its claim back; the next run reminds, and the one after does not", async () => {
        const { seller } = await classSoon()
        // This seller's first send reaches nobody (template off, budget
        // spent, every send failed); other classes in the window are untouched.
        let first = true
        runTrigger.mockImplementation(async (p: { seller_id: string }) => {
          if (p.seller_id === seller.id && first) {
            first = false
            return { sent: 0, skipped: 1 }
          }
          return { sent: 1, skipped: 0 }
        })

        await wellnessRemindersJob(container())
        await wellnessRemindersJob(container())
        await wellnessRemindersJob(container())

        expect(remindersFor(seller.id)).toHaveLength(2)
      })

      it("a class moved to a new time is reminded again, once, for the new time", async () => {
        const { seller, cls } = await classSoon()
        await wellnessRemindersJob(container())
        await wellness().updateClassEvents({ id: cls.id, starts_at: new Date(Date.now() + 4 * HOUR), ends_at: new Date(Date.now() + 5 * HOUR) })
        await wellnessRemindersJob(container())
        await wellnessRemindersJob(container())

        expect(remindersFor(seller.id)).toHaveLength(2)
      })

      it("the 24-hour booking reminder goes to a booking 23-24h out, not to one 2h out, on the booking's clock", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const booking = container().resolve(BOOKING_MODULE)
        await booking.createProductBookingConfigs({ product_id: product.id, seller_id: seller.id, timezone: "Asia/Tokyo" })
        await wellness().createSessionTypes({ seller_id: seller.id, product_id: product.id, name: "Reiki", duration_minutes: 60 })
        const at = (ms: number) => ({ starts_at: new Date(Date.now() + ms), ends_at: new Date(Date.now() + ms + HOUR) })
        await booking.createBookings([
          { seller_id: seller.id, product_id: product.id, customer_email: "tomorrow@example.com", status: "confirmed", ...at(23.5 * HOUR) },
          { seller_id: seller.id, product_id: product.id, customer_email: "soon@example.com", status: "confirmed", ...at(2 * HOUR) },
        ])

        await wellnessRemindersJob(container())

        const sent = triggersFor(seller.id).filter((c) => c.trigger === "booking_reminder_24h")
        expect(sent).toHaveLength(1)
        expect(sent[0].recipients).toEqual([expect.objectContaining({ email: "tomorrow@example.com" })])
        expect(sent[0].vars).toEqual(expect.objectContaining({ session_type: "Reiki", time: expect.stringMatching(/ GMT\+9$/) }))
      })
    })

    describe("registerForClass takes the seat in one statement", () => {
      it("a class cancelled between the read and the seat stays cancelled and seats nobody", async () => {
        const seller = await makeSeller()
        const cls = await makeClass(seller.id)
        const svc = wellness()
        const read = svc.retrieveClassEvent.bind(svc)
        // The vendor DELETE lands just after registerForClass has read the class.
        const spy = jest.spyOn(svc, "retrieveClassEvent").mockImplementationOnce(async (...args: unknown[]) => {
          const row = await read(...(args as [string]))
          await svc.updateClassEvents({ id: cls.id, status: "cancelled" })
          return row
        })
        try {
          const result = await svc.registerForClass({ seller_id: seller.id, class_event_id: cls.id, email: "b@example.com" })
          expect(result).toEqual({ attendee: null, sold_out: false, full: false, refused: "cancelled" })
        } finally {
          spy.mockRestore()
        }
        expect(await svc.listClassAttendees({ class_event_id: cls.id })).toEqual([])
        expect(await svc.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "cancelled", seats_taken: 0 }))
      })

      it("two buyers of the last seat: one is seated, the other is not, and the count is the capacity", async () => {
        const seller = await makeSeller()
        const cls = await makeClass(seller.id, { capacity: 1 })
        const svc = wellness()

        const results = await Promise.all(
          ["c1@example.com", "c2@example.com"].map((email) => svc.registerForClass({ seller_id: seller.id, class_event_id: cls.id, email }))
        )

        expect(results.filter((r: { attendee: unknown }) => r.attendee).length).toBe(1)
        expect(results.filter((r: { full: boolean }) => r.full).length).toBe(1)
        expect(await svc.listClassAttendees({ class_event_id: cls.id })).toHaveLength(1)
        expect(await svc.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ seats_taken: 1, status: "full" }))
      })

      it("a paid ticket waitlisted on a full class is logged like an unseated one", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const cls = await makeClass(seller.id, { product_id: product.id, capacity: 1, seats_taken: 1, status: "full", waitlist_enabled: true })
        const buyer = await makeCustomer()
        const order = await makeOrder(seller.id, [product.id], buyer)

        await wellnessOrderPlaced(placed(order.id))

        expect(await wellness().listClassAttendees({ class_event_id: cls.id })).toEqual([
          expect.objectContaining({ status: "waitlisted", order_id: order.id }),
        ])
        expect(triggersFor(seller.id)).toEqual([])
        expect(warningsFor(order.id)).toEqual([expect.stringContaining("were waitlisted (class full)")])
      })
    })
  },
})
