import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { COTTAGE_FOOD_MODULE } from "../../src/modules/cottage-food"
import { WELLNESS_MODULE } from "../../src/modules/wellness"
import { PROGRESSION_MODULE } from "../../src/modules/progression"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../src/modules/marketplace-webhooks"
import { BLACK_MASK_PLAN_METADATA_KEY } from "../../src/modules/marketplace-webhooks/black-mask"
import { SELLER_EXTENSION_MODULE } from "../../src/modules/seller-extension"
import { createSellerMetadataRecord } from "../../src/modules/seller-extension/metadata-service"
import { WellnessAutomationService } from "../../src/modules/wellness/automation-service"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { ORDER_LINE_ITEM_COLUMNS, ORDER_LINE_ITEM_RELATIONS } from "../../src/shared/order-line-item-fields"
import cottageFoodRecordSale from "../../src/subscribers/cottage-food-record-sale"
import cottageFoodReverseSale from "../../src/subscribers/cottage-food-reverse-sale"
import emitBlackoutOrderPlaced from "../../src/subscribers/emit-blackout-order-placed"
import emitBlackoutOrderUpdated from "../../src/subscribers/emit-blackout-order-updated"
import emitBlackoutOrderRefundCancel from "../../src/subscribers/emit-blackout-order-refund-cancel"
import wellnessOrderPlaced from "../../src/subscribers/wellness-order-placed"
import { NON_SALE_ORDER_FILTERS, getSellerOrders } from "../../src/shared/seller-orders"
import { logger } from "../../src/shared/logger"
import { collectCrossChannelRevenue } from "../../src/shared/cross-channel-revenue"
import { itemCount, loadOrderForSellerPush } from "../../src/shared/native-push-seller"
import { enqueueBlackMaskProvisioning } from "../../src/lib/black-mask-provisioning"
import { GET as dataExport } from "../../src/api/store/customers/me/data-export/route"
import { GET as growerDashboard } from "../../src/api/vendor/farm/grower-dashboard/route"
import { GET as nurseryPayouts } from "../../src/api/vendor/plant-nursery/payouts/current-period/route"
import { cardOrderFixtures } from "./helpers/card-orders"

jest.setTimeout(240 * 1000)

/**
 * SD-52 on a real migrated database: every order read that used to select
 * `items.quantity`, run against a real order, with its side effect checked in
 * the real module tables.
 *
 * Medusa 2.14.2 rewrites an order read's `items.quantity` to
 * `items.item.quantity` (`@medusajs/order/dist/utils/transform-order.js`), and
 * OrderLineItem has no `quantity` (the order's per-line quantity lives on
 * OrderItem). The read throws for any order that has a line item. CI applies
 * `scripts/patch-mikro-orm.js` and logs "Entity 'OrderLineItem' does not have
 * property 'quantity'" (run 43273089067: 43 times each under
 * cottage-food-record-sale, emit-blackout-order-placed,
 * grower-karma-on-order-placed and wellness-order-placed); without that patch
 * the same read fails earlier with "reading 'kind'". Every caller caught it,
 * so no test failed. The unit specs mocked `query.graph`, which is how it hid.
 *
 * Orders are created through the order module and linked to their seller as
 * Mercur's split links them (helpers/card-orders.ts does the same); the
 * failure is in the read's field path, not in how the order was placed.
 * Subscribers are called directly with the `order.placed` payload.
 *
 * Not here, on purpose: `subscribers/grower-karma-on-order-placed.ts` and the
 * read it depends on (`modules/agriculture/plant-order-helpers.ts`) still
 * select `items.quantity`. Fixing that read starts awarding grower KARMA for
 * sales, which docs/F7_FLAT_PAYOUT_INVENTORY.md §10 item 8 leaves to the
 * operator. The wellness subscriber's sale KARMA waits on the same decision
 * (FF_WELLNESS_SALE_KARMA_V1, default off).
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, uid, makeSeller } = cardOrderFixtures(getContainer)
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const query = () => container().resolve(ContainerRegistrationKeys.QUERY)
    const webhooks = () => container().resolve(MARKETPLACE_WEBHOOKS_MODULE)

    async function makeProduct(sellerId: string, metadata?: Record<string, unknown>) {
      const id = uid()
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([{ title: `Jam ${id}`, handle: `jam-${id}`, status: "published", metadata }])
      await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      return product as { id: string }
    }

    type Line = {
      productId: string
      quantity: number
      unitPrice: number
      title?: string
      metadata?: Record<string, unknown>
    }

    /**
     * A placed order of `lines` (unit prices in Medusa's major units), linked
     * to `sellerId` as Mercur's split links it; `null` leaves it unlinked.
     */
    async function makeOrder(sellerId: string | null, lines: Line[], buyer: { customerId?: string; email?: string } = {}) {
      const [order] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            customer_id: buyer.customerId ?? `cus_${uid()}`,
            email: buyer.email ?? "buyer@example.com",
            items: lines.map((l) => ({
              title: l.title ?? "Jam",
              product_id: l.productId,
              quantity: l.quantity,
              unit_price: l.unitPrice,
              ...(l.metadata ? { metadata: l.metadata } : {}),
            })),
          },
        ])
      if (sellerId) {
        await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.ORDER]: { order_id: order.id } })
      }
      return order as { id: string }
    }

    async function makeCustomer(metadata?: Record<string, unknown>) {
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: `buyer-${uid()}@example.com`, metadata }])
      return customer as { id: string; email: string }
    }

    const placed = (orderId: string) => ({ event: { data: { id: orderId } }, container: container() }) as any
    const evt = (name: string, data: Record<string, unknown>) => ({ event: { name, data }, container: container() }) as any

    /** Set env vars for one test; returns the restore. */
    function withEnv(vars: Record<string, string>) {
      const before: Record<string, string | undefined> = {}
      for (const [k, v] of Object.entries(vars)) {
        before[k] = process.env[k]
        process.env[k] = v
      }
      return () => {
        for (const [k, v] of Object.entries(before)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
    }

    describe("the field path", () => {
      it("an order read selecting items.quantity throws for an order with a line; items.* returns the quantity", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])

        await expect(
          query().graph({ entity: "order", fields: ["id", "items.quantity"], filters: { id: order.id } })
        ).rejects.toThrow(/does not have property 'quantity'|reading 'kind'/)

        const { data } = await query().graph({ entity: "order", fields: ["id", "items.*"], filters: { id: order.id } })
        expect(data[0].items).toEqual([expect.objectContaining({ product_id: product.id, quantity: 3, unit_price: 12.5 })])
      })

      it("items.total throws the same way: the failure is any field OrderLineItem lacks, not quantity alone", async () => {
        // shared/order-dispute-intake.ts selects items.total (open, SD-52 follow-up).
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])

        await expect(
          query().graph({ entity: "order", fields: ["id", "items.total"], filters: { id: order.id } })
        ).rejects.toThrow(/does not have property 'total'|reading 'kind'/)
      })

      it("every field the guard allows under items. reads on a real order, and the column list is the table's", async () => {
        // The guard (shared/__tests__/order-items-quantity-guard.unit.spec.ts)
        // allows exactly ORDER_READ_ITEM_FIELDS; this is the evidence for it.
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const { rows } = await pg.raw(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'order_line_item' AND table_schema = current_schema()`
        )
        // `totals_id` is on the table (Medusa's order Migration20240219102530)
        // but OrderLineItem has no property for it, so it is not allowed; it is
        // read below to show it fails the same way.
        const NOT_LINE_PROPERTIES = ["totals_id"]
        const columns = rows.map((r: { column_name: string }) => r.column_name)
        expect(columns.filter((c: string) => !NOT_LINE_PROPERTIES.includes(c)).sort()).toEqual([...ORDER_LINE_ITEM_COLUMNS].sort())
        expect(columns).toEqual(expect.arrayContaining(NOT_LINE_PROPERTIES))

        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])
        await expect(
          query().graph({ entity: "order", fields: ["id", "items.totals_id"], filters: { id: order.id } })
        ).rejects.toThrow(/does not have property 'totals_id'|reading 'kind'/)
        const failed: string[] = []
        for (const field of [...ORDER_LINE_ITEM_COLUMNS, ...ORDER_LINE_ITEM_RELATIONS]) {
          try {
            const { data } = await query().graph({ entity: "order", fields: ["id", `items.${field}`], filters: { id: order.id } })
            if (data?.[0]?.items?.length !== 1) failed.push(`${field}: no line`)
          } catch (e) {
            failed.push(`${field}: ${(e as Error).message}`)
          }
        }
        expect(failed).toEqual([])
      })
    })

    describe("cottage-food compliance meter", () => {
      it("records a placed order against the seller's meter, in cents with its meal count, and a cancel reverses it", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const cottage = container().resolve(COTTAGE_FOOD_MODULE)
        await cottage.upsertProfileForSeller(seller.id, { operation_type: "HOME_KITCHEN" })
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])

        await cottageFoodRecordSale(placed(order.id))

        const entries = await cottage.listCottageFoodSalesEntries({
          source: "medusa_order",
          source_id: `${order.id}:${seller.id}`,
        })
        expect(entries).toHaveLength(1)
        expect(entries[0]).toEqual(expect.objectContaining({ seller_id: seller.id, meal_count: 3 }))
        // $37.50, not 38 cents: Medusa's unit_price is major units.
        expect(Number(entries[0].amount_cents)).toBe(3750)

        await cottageFoodReverseSale(placed(order.id))

        const [reversal] = await cottage.listCottageFoodSalesEntries({ reverses_entry_id: entries[0].id })
        expect(Number(reversal.amount_cents)).toBe(-3750)
        expect(reversal.meal_count).toBe(-3)
      })
    })

    describe("Blackout order events", () => {
      let restore: () => void = () => {}
      beforeEach(() => {
        // The emitter is a no-op unless both are set; nothing is sent from a test.
        restore = withEnv({ FREEBLACKMARKET_WEBHOOK_SECRET: "sd52-test-secret", BLACKOUT_API_BASE: "https://blackout.invalid" })
      })
      afterEach(() => restore())

      const delivery = async (eventId: string) =>
        ((await webhooks().listWebhookDeliveries({ event_id: eventId })) as Array<{ payload: Record<string, any> }>)[0]
      const purchasesFor = async (orderId: string) =>
        ((await webhooks().listWebhookDeliveries({ event: "purchase.succeeded" })) as Array<{ payload: Record<string, any> }>)
          .filter((d) => d.payload?.metadata?.fbmOrderId === orderId)
          .map((d) => d.payload)

      /** A catalog line as the checkout-session page stamps it. */
      const catalogLine = (productId: string): Line => ({
        productId,
        quantity: 1,
        unitPrice: 4,
        title: "Plugin licence",
        metadata: { creator_listing_id: "lst_sd52", listing_id: "lst_sd52", entitlement_kind: "software_license" },
      })

      it("routes order.created to the order's seller and sends purchase.succeeded only for the Blackout purchase line", async () => {
        const seller = await makeSeller()
        const jam = await makeProduct(seller.id)
        const plugin = await makeProduct(seller.id)
        const customer = await makeCustomer({ blackout_user_id: "bo_user_sd52" })
        const order = await makeOrder(
          seller.id,
          [{ productId: jam.id, quantity: 3, unitPrice: 12.5 }, catalogLine(plugin.id)],
          { customerId: customer.id, email: customer.email }
        )

        await emitBlackoutOrderPlaced(placed(order.id))

        const created = await delivery(`order.created:${order.id}`)
        expect(created?.payload).toEqual(
          expect.objectContaining({
            type: "order.created",
            // The seller through Mercur's link, never "default-seller".
            vendorId: seller.id,
            orderId: order.id,
            userId: "bo_user_sd52",
            totalCents: 4150,
          })
        )
        expect(created.payload.items).toHaveLength(2)
        expect(created.payload.items).toEqual(
          expect.arrayContaining([
            { sku: null, title: "Jam", qty: 3, priceCents: 1250 },
            { sku: null, title: "Plugin licence", qty: 1, priceCents: 400 },
          ])
        )

        // The jar of jam is not a Blackout purchase: one event, for the licence.
        const purchases = await purchasesFor(order.id)
        expect(purchases).toHaveLength(1)
        expect(purchases[0]).toEqual(
          expect.objectContaining({
            userId: "bo_user_sd52",
            providerListingId: "lst_sd52",
            kind: "software_license",
            amountCents: 400,
            metadata: expect.objectContaining({ fbmOrderId: order.id, digitalDelivery: true }),
          })
        )
      })

      it("a physical-only order from a Blackout-linked buyer sends order.created and no purchase.succeeded", async () => {
        const seller = await makeSeller()
        const jam = await makeProduct(seller.id)
        const customer = await makeCustomer({ blackout_user_id: "bo_user_sd52_b" })
        const order = await makeOrder(seller.id, [{ productId: jam.id, quantity: 3, unitPrice: 12.5 }], {
          customerId: customer.id,
          email: customer.email,
        })

        await emitBlackoutOrderPlaced(placed(order.id))

        expect((await delivery(`order.created:${order.id}`))?.payload).toEqual(
          expect.objectContaining({ vendorId: seller.id, totalCents: 3750, items: [{ sku: null, title: "Jam", qty: 3, priceCents: 1250 }] })
        )
        expect(await purchasesFor(order.id)).toEqual([])
      })

      it("an order with no seller link sends no order.created; its Blackout purchase still goes out", async () => {
        const seller = await makeSeller()
        const plugin = await makeProduct(seller.id)
        const customer = await makeCustomer({ blackout_user_id: "bo_user_sd52_c" })
        const order = await makeOrder(null, [catalogLine(plugin.id)], { customerId: customer.id, email: customer.email })

        await emitBlackoutOrderPlaced(placed(order.id))

        expect(await delivery(`order.created:${order.id}`)).toBeUndefined()
        expect(await purchasesFor(order.id)).toEqual([expect.objectContaining({ userId: "bo_user_sd52_c", kind: "software_license" })])
      })

      it("never names the seller's Blackout account as the buyer, now that the seller resolves", async () => {
        const seller = await makeSeller()
        await createSellerMetadataRecord(container().resolve(SELLER_EXTENSION_MODULE), {
          seller_id: seller.id,
          blackout_user_id: "bo_seller_sd52",
        })
        const plugin = await makeProduct(seller.id)
        const buyer = await makeCustomer() // not linked to Blackout
        const order = await makeOrder(seller.id, [catalogLine(plugin.id)], { customerId: buyer.id, email: buyer.email })

        await emitBlackoutOrderPlaced(placed(order.id))

        // No buyer id, so no purchase; order.created carries no userId at all.
        expect(await purchasesFor(order.id)).toEqual([])
        const created = await delivery(`order.created:${order.id}`)
        expect(created?.payload).toEqual(expect.objectContaining({ vendorId: seller.id }))
        expect(created.payload).not.toHaveProperty("userId")
      })

      it("order.updated and order.cancelled go to the order's seller, and are not sent for an unlinked order", async () => {
        const seller = await makeSeller()
        const jam = await makeProduct(seller.id)
        const linked = await makeOrder(seller.id, [{ productId: jam.id, quantity: 1, unitPrice: 5 }])
        const unlinked = await makeOrder(null, [{ productId: jam.id, quantity: 1, unitPrice: 5 }])

        for (const o of [linked, unlinked]) {
          await emitBlackoutOrderUpdated(evt("order.fulfillment_created", { order_id: o.id }))
          await emitBlackoutOrderRefundCancel(evt("order.canceled", { id: o.id }))
        }

        expect((await delivery(`order.updated:${linked.id}:dispatched`))?.payload).toEqual(
          expect.objectContaining({ type: "order.updated", vendorId: seller.id, orderId: linked.id, status: "dispatched" })
        )
        expect((await delivery(`order.cancelled:${linked.id}`))?.payload).toEqual(
          expect.objectContaining({ type: "order.cancelled", vendorId: seller.id, orderId: linked.id })
        )
        expect(await delivery(`order.updated:${unlinked.id}:dispatched`)).toBeUndefined()
        expect(await delivery(`order.cancelled:${unlinked.id}`)).toBeUndefined()
      })
    })

    describe("wellness order subscriber", () => {
      // The automations (Matrix DM / email) are not under test; what is, is
      // whether the subscriber asks for the "You're registered" message.
      let runTrigger: jest.SpyInstance
      beforeEach(() => {
        runTrigger = jest.spyOn(WellnessAutomationService.prototype, "runTrigger").mockResolvedValue({ sent: 0, skipped: 0 })
      })
      afterEach(() => runTrigger.mockRestore())
      const triggers = () => runTrigger.mock.calls.map((c) => (c[0] as { trigger: string }).trigger)

      async function wellnessSale(opts: { capacity?: number; seatsTaken?: number; tickets?: number } = {}) {
        const seller = await makeSeller()
        // A seller member, so the KARMA subject resolves and a gate that leaked
        // would write an xp_event this test can see.
        const sellers = container().resolve(SELLER_MODULE)
        const [member] = await sellers.createMembers([{ name: "Practitioner", email: `p-${uid()}@example.com`, seller_id: seller.id }])
        const classProduct = await makeProduct(seller.id)
        const tierProduct = await makeProduct(seller.id)
        const wellness = container().resolve(WELLNESS_MODULE)
        const cls = await wellness.createClassEvents({
          seller_id: seller.id,
          product_id: classProduct.id,
          title: "Sound bath",
          starts_at: new Date(Date.now() + 86_400_000),
          ends_at: new Date(Date.now() + 90_000_000),
          capacity: opts.capacity ?? 1,
          seats_taken: opts.seatsTaken ?? 0,
          status: "open",
        })
        const tier = await wellness.createMembershipTiers({
          seller_id: seller.id,
          product_id: tierProduct.id,
          name: "Root",
          credits_per_period: 4,
        })
        const customer = await makeCustomer()
        const order = await makeOrder(
          seller.id,
          [
            { productId: classProduct.id, quantity: opts.tickets ?? 1, unitPrice: 30, title: "Sound bath" },
            { productId: tierProduct.id, quantity: 1, unitPrice: 50, title: "Root" },
          ],
          { customerId: customer.id, email: customer.email }
        )
        await wellnessOrderPlaced(placed(order.id))
        return { seller, member, cls, tier, customer, order, wellness }
      }

      const xpEvents = (memberId: string) =>
        container().resolve(PROGRESSION_MODULE).listXpEvents({ customer_id: memberId }) as Promise<Array<{ reason: string }>>

      it("registers the class buyer and creates the member with the tier's credits; no sale KARMA with the flag off", async () => {
        const { member, cls, tier, customer, order, wellness } = await wellnessSale()

        const attendees = await wellness.listClassAttendees({ class_event_id: cls.id })
        expect(attendees).toEqual([
          expect.objectContaining({ order_id: order.id, customer_id: customer.id, customer_email: customer.email, status: "registered" }),
        ])
        const after = await wellness.retrieveClassEvent(cls.id)
        expect(after).toEqual(expect.objectContaining({ seats_taken: 1, status: "full" }))

        const members = await wellness.listMembers({ membership_tier_id: tier.id })
        expect(members).toEqual([
          expect.objectContaining({ email: customer.email, customer_id: customer.id, status: "active", credits_balance: 4 }),
        ])

        expect(await xpEvents(member.id)).toEqual([])
        expect(triggers().sort()).toEqual(["class_registered", "membership_welcome"])
      })

      it("a line of two tickets takes two seats, and redelivering order.placed takes none and adds no member", async () => {
        const { cls, tier, customer, order, wellness } = await wellnessSale({ capacity: 3, tickets: 2 })

        const attendees = await wellness.listClassAttendees({ class_event_id: cls.id })
        expect(attendees).toHaveLength(2)
        expect(attendees.every((a: { order_id: string; status: string }) => a.order_id === order.id && a.status === "registered")).toBe(true)
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ seats_taken: 2, status: "open" }))
        const [member] = await wellness.listMembers({ membership_tier_id: tier.id })
        expect(member).toEqual(expect.objectContaining({ email: customer.email, metadata: { order_id: order.id } }))

        runTrigger.mockClear()
        await wellnessOrderPlaced(placed(order.id))

        expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toHaveLength(2)
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ seats_taken: 2 }))
        expect(await wellness.listMembers({ membership_tier_id: tier.id })).toHaveLength(1)
        // No second "You're registered" and no second welcome.
        expect(triggers()).toEqual([])
      })

      it("a ticket for a full class with no waitlist seats nobody and does not tell the buyer they are registered", async () => {
        const { cls, order, wellness } = await wellnessSale({ capacity: 1, seatsTaken: 1 })

        expect(await wellness.listClassAttendees({ class_event_id: cls.id, order_id: order.id })).toEqual([])
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ seats_taken: 1 }))
        // The membership on the same order still goes through.
        expect(triggers()).toEqual(["membership_welcome"])
      })

      it("with FF_WELLNESS_SALE_KARMA_V1 on, the same sale records the two KARMA events (the gate is what stops them)", async () => {
        const restore = withEnv({ [PHASE0_FEATURE_FLAGS.WELLNESS_SALE_KARMA_V1]: "true" })
        try {
          const { member, tier, wellness } = await wellnessSale()
          const reasons = (await xpEvents(member.id)).map((e) => e.reason).sort()
          expect(reasons).toEqual(["wellness:class_sold_out", "wellness:membership_first_signup"])
          // A KARMA failure (SD-50's missing columns, on a database that still
          // has them missing) must not have stopped the membership.
          expect(await wellness.listMembers({ membership_tier_id: tier.id })).toHaveLength(1)
        } finally {
          restore()
        }
      })
    })

    describe("wellness order subscriber: which class a ticket seats (SD-52 review)", () => {
      // Before this, order.placed called registerForClass for every class
      // linked to the ticket's product, whatever its status or date, and
      // registerForClass wrote status "open" back: a ticket reopened a
      // cancelled class and seated the buyer, a finished class took a seat,
      // and one drop-in ticket took a seat in every session sharing it.
      let runTrigger: jest.SpyInstance
      // Every createLogger() logger shares this prototype, so this sees the
      // subscriber's warnings whatever LOG_LEVEL says.
      let warn: jest.SpyInstance
      beforeEach(() => {
        runTrigger = jest.spyOn(WellnessAutomationService.prototype, "runTrigger").mockResolvedValue({ sent: 0, skipped: 0 })
        warn = jest.spyOn(Object.getPrototypeOf(logger), "warn")
      })
      afterEach(() => {
        runTrigger.mockRestore()
        warn.mockRestore()
      })
      const registeredMessages = () =>
        runTrigger.mock.calls.map((c) => c[0] as { trigger: string; vars: { session_type: string } }).filter((c) => c.trigger === "class_registered")
      const warningsFor = (orderId: string) =>
        warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wellness-order-placed]") && m.includes(orderId))

      const DAY = 86_400_000
      type ClassSpec = { title: string; status?: string; startsInMs?: number; endsInMs?: number; capacity?: number }

      /** A seller, one ticket product, and the given classes all linked to it. */
      async function classesOnOneProduct(specs: ClassSpec[]) {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const wellness = container().resolve(WELLNESS_MODULE)
        const classes: Array<{ id: string; title: string }> = []
        for (const c of specs) {
          classes.push(
            await wellness.createClassEvents({
              seller_id: seller.id,
              product_id: product.id,
              title: c.title,
              starts_at: new Date(Date.now() + (c.startsInMs ?? DAY)),
              ends_at: new Date(Date.now() + (c.endsInMs ?? DAY + 3_600_000)),
              capacity: c.capacity ?? 5,
              seats_taken: 0,
              status: c.status ?? "open",
            })
          )
        }
        const customer = await makeCustomer()
        return { seller, product, classes, customer, wellness }
      }

      async function buy(
        sellerId: string,
        customer: { id: string; email: string },
        lines: Array<{ productId: string; tickets?: number; metadata?: Record<string, unknown> }>
      ) {
        const order = await makeOrder(
          sellerId,
          lines.map((l) => ({ productId: l.productId, quantity: l.tickets ?? 1, unitPrice: 25, title: "Drop-in", metadata: l.metadata })),
          { customerId: customer.id, email: customer.email }
        )
        await wellnessOrderPlaced(placed(order.id))
        return order
      }

      it("a ticket for a cancelled class seats nobody, leaves it cancelled, sends no 'registered' message, and is logged", async () => {
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([{ title: "Cancelled", status: "cancelled" }])
        const [cls] = classes

        const order = await buy(seller.id, customer, [{ productId: product.id }])

        expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "cancelled", seats_taken: 0 }))
        expect(registeredMessages()).toEqual([])
        expect(warningsFor(order.id)).toEqual([expect.stringContaining(`${cls.id} (cancelled)`)])

        // The service refuses it too, on its own, and writes nothing.
        const direct = await wellness.registerForClass({ seller_id: seller.id, class_event_id: cls.id, email: customer.email })
        expect(direct).toEqual({ attendee: null, sold_out: false, full: false, refused: "cancelled" })
        expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "cancelled", seats_taken: 0 }))
      })

      it("a ticket for a class that finished last month seats nobody and leaves its status as it was", async () => {
        // Still "open": nothing marks a class completed when it ends.
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([
          { title: "Last month", status: "open", startsInMs: -31 * DAY, endsInMs: -31 * DAY + 3_600_000 },
        ])
        const [cls] = classes

        const order = await buy(seller.id, customer, [{ productId: product.id }])

        expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "open", seats_taken: 0 }))
        expect(registeredMessages()).toEqual([])
        expect(warningsFor(order.id)).toEqual([expect.stringContaining(`${cls.id} (open)`)])

        const direct = await wellness.registerForClass({ seller_id: seller.id, class_event_id: cls.id, email: customer.email })
        expect(direct).toEqual(expect.objectContaining({ attendee: null, refused: "ended" }))
        expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "open", seats_taken: 0 }))
      })

      it("two live sessions on one product: a ticket that names neither seats nobody in either, and is logged", async () => {
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([
          { title: "Tuesday" },
          { title: "Thursday", startsInMs: 3 * DAY, endsInMs: 3 * DAY + 3_600_000 },
        ])

        const order = await buy(seller.id, customer, [{ productId: product.id }])

        for (const cls of classes) {
          expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
          expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "open", seats_taken: 0 }))
        }
        expect(registeredMessages()).toEqual([])
        const warnings = warningsFor(order.id)
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("2 live classes")
        for (const cls of classes) expect(warnings[0]).toContain(cls.id)
      })

      it("one live session beside a cancelled and a finished one on the same product: the ticket seats the buyer in the live one", async () => {
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([
          { title: "Live" },
          { title: "Cancelled", status: "cancelled" },
          { title: "Finished", status: "open", startsInMs: -2 * DAY, endsInMs: -2 * DAY + 3_600_000 },
        ])
        const [live, cancelled, finished] = classes

        const order = await buy(seller.id, customer, [{ productId: product.id }])

        expect(await wellness.listClassAttendees({ class_event_id: live.id })).toEqual([
          expect.objectContaining({ order_id: order.id, customer_email: customer.email, status: "registered" }),
        ])
        expect(await wellness.retrieveClassEvent(live.id)).toEqual(expect.objectContaining({ seats_taken: 1, status: "open" }))
        expect(registeredMessages()).toEqual([expect.objectContaining({ vars: expect.objectContaining({ session_type: "Live" }) })])
        for (const [cls, status] of [[cancelled, "cancelled"], [finished, "open"]] as const) {
          expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
          expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status, seats_taken: 0 }))
        }
        expect(warningsFor(order.id)).toEqual([])
      })

      it("metadata.class_event_id picks one of two live sessions: both tickets seat there, none in the other", async () => {
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([
          { title: "Tuesday" },
          { title: "Thursday", startsInMs: 3 * DAY, endsInMs: 3 * DAY + 3_600_000 },
        ])
        const [tuesday, thursday] = classes

        const order = await buy(seller.id, customer, [{ productId: product.id, tickets: 2, metadata: { class_event_id: thursday.id } }])

        expect(await wellness.listClassAttendees({ class_event_id: thursday.id })).toHaveLength(2)
        expect(await wellness.retrieveClassEvent(thursday.id)).toEqual(expect.objectContaining({ seats_taken: 2 }))
        expect(await wellness.listClassAttendees({ class_event_id: tuesday.id })).toEqual([])
        expect(await wellness.retrieveClassEvent(tuesday.id)).toEqual(expect.objectContaining({ seats_taken: 0 }))
        expect(registeredMessages()).toEqual([expect.objectContaining({ vars: expect.objectContaining({ session_type: "Thursday" }) })])
        expect(warningsFor(order.id)).toEqual([])
      })

      it("a class_event_id naming a cancelled session, or another product's live class, seats nobody", async () => {
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([
          { title: "Live" },
          { title: "Cancelled", status: "cancelled" },
        ])
        const [live, cancelled] = classes
        // Another product of the same seller, with its own live class.
        const otherProduct = await makeProduct(seller.id)
        const other = await wellness.createClassEvents({
          seller_id: seller.id,
          product_id: otherProduct.id,
          title: "Other",
          starts_at: new Date(Date.now() + DAY),
          ends_at: new Date(Date.now() + DAY + 3_600_000),
          capacity: 5,
          seats_taken: 0,
          status: "open",
        })

        const order = await buy(seller.id, customer, [
          { productId: product.id, metadata: { class_event_id: cancelled.id } },
          { productId: product.id, metadata: { class_event_id: other.id } },
        ])

        for (const cls of [live, cancelled, other]) {
          expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
        }
        expect(await wellness.retrieveClassEvent(cancelled.id)).toEqual(expect.objectContaining({ status: "cancelled", seats_taken: 0 }))
        expect(registeredMessages()).toEqual([])
        const warnings = warningsFor(order.id)
        expect(warnings).toHaveLength(2)
        expect(warnings.some((w) => w.includes(cancelled.id))).toBe(true)
        expect(warnings.some((w) => w.includes(other.id))).toBe(true)
      })

      it("a class cancelled between the lookup and the registration: the service refuses, no seat, no 'registered' message, logged", async () => {
        const { seller, classes, product, customer, wellness } = await classesOnOneProduct([{ title: "About to be cancelled" }])
        const [cls] = classes
        const register = wellness.registerForClass.bind(wellness)
        const spy = jest.spyOn(wellness, "registerForClass").mockImplementationOnce(async (input: unknown) => {
          await wellness.updateClassEvents({ id: cls.id, status: "cancelled" })
          return register(input)
        })
        try {
          const order = await buy(seller.id, customer, [{ productId: product.id }])

          expect(spy).toHaveBeenCalledTimes(1)
          expect(await wellness.listClassAttendees({ class_event_id: cls.id })).toEqual([])
          expect(await wellness.retrieveClassEvent(cls.id)).toEqual(expect.objectContaining({ status: "cancelled", seats_taken: 0 }))
          expect(registeredMessages()).toEqual([])
          expect(warningsFor(order.id)).toEqual([expect.stringContaining("refused registration (cancelled)")])
        } finally {
          spy.mockRestore()
        }
      })
    })

    describe("seller order lists", () => {
      it("getSellerOrders returns the seller's lines only, with quantities, and a total in cents", async () => {
        const seller = await makeSeller()
        const other = await makeSeller()
        const mine = await makeProduct(seller.id)
        const theirs = await makeProduct(other.id)
        const order = await makeOrder(seller.id, [
          { productId: mine.id, quantity: 3, unitPrice: 12.5 },
          { productId: theirs.id, quantity: 1, unitPrice: 99 },
        ])

        const orders = await getSellerOrders(container(), seller.id)
        expect(orders).toEqual([
          expect.objectContaining({
            id: order.id,
            items: [{ product_id: mine.id, title: "Jam", quantity: 3, unit_price: 12.5 }],
            seller_total_cents: 3750,
          }),
        ])

        // Cross-channel revenue (GET /vendor/revenue/channels) reads it: the
        // FBM line was missing for every vendor while the read threw.
        const revenue = await collectCrossChannelRevenue(container(), seller.id, { since: new Date(Date.now() - 86_400_000) })
        expect(revenue.lines).toEqual([expect.objectContaining({ channel: "fbm", orders: 1, gross_amount: 3750 })])
      })

      it("getSellerOrders bounds the read by since in the database; cross-channel revenue passes it", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const recent = await makeOrder(seller.id, [{ productId: product.id, quantity: 1, unitPrice: 10 }])
        const old = await makeOrder(seller.id, [{ productId: product.id, quantity: 1, unitPrice: 20 }])
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await pg.raw(`UPDATE "order" SET created_at = now() - interval '30 days' WHERE id = ?`, [old.id])
        const since = new Date(Date.now() - 86_400_000)

        expect((await getSellerOrders(container(), seller.id)).map((o) => o.id).sort()).toEqual([recent.id, old.id].sort())
        expect((await getSellerOrders(container(), seller.id, { since })).map((o) => o.id)).toEqual([recent.id])

        const revenue = await collectCrossChannelRevenue(container(), seller.id, { since })
        expect(revenue.lines).toEqual([expect.objectContaining({ channel: "fbm", orders: 1, gross_amount: 1000 })])
      })

      /**
       * One seller, one product, and an order in each state a sale list must
       * tell apart, made the way Medusa makes them: cancel and archive through
       * the order module, a draft as the admin draft-order route creates it
       * (status "draft", is_draft_order true).
       */
      async function ordersInEveryState() {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const orders = container().resolve(Modules.ORDER)
        const line = (unitPrice: number) => [{ productId: product.id, quantity: 1, unitPrice }]
        const draft = async (unitPrice: number) => {
          const [o] = await orders.createOrders([
            {
              currency_code: "usd",
              email: "buyer@example.com",
              status: "draft",
              is_draft_order: true,
              items: [{ title: "Jam", product_id: product.id, quantity: 1, unit_price: unitPrice }],
            },
          ])
          await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.ORDER]: { order_id: o.id } })
          return o as { id: string }
        }

        const pending = await makeOrder(seller.id, line(10))
        const archivedSale = await makeOrder(seller.id, line(20))
        await orders.completeOrder(archivedSale.id)
        await orders.archive(archivedSale.id)
        const canceled = await makeOrder(seller.id, line(40))
        await orders.cancel(canceled.id)
        const archivedCanceled = await makeOrder(seller.id, line(50))
        await orders.cancel(archivedCanceled.id)
        await orders.archive(archivedCanceled.id)
        const drafted = await draft(60)
        const archivedDraft = await draft(70)
        await orders.archive(archivedDraft.id)
        // A status written by hand, with no canceled_at. Medusa's and Mercur's
        // cancels both set canceled_at; this is the order only the status
        // condition catches.
        const statusOnlyCanceled = await makeOrder(seller.id, line(80))
        await orders.updateOrders([{ id: statusOnlyCanceled.id, status: "canceled" }])

        return { seller, pending, archivedSale, canceled, archivedCanceled, drafted, archivedDraft, statusOnlyCanceled }
      }

      it("getSellerOrders lists sales only: no cancelled or draft order, archived or not; cross-channel revenue counts only those", async () => {
        const o = await ordersInEveryState()

        const listed = (await getSellerOrders(container(), o.seller.id)).map((x) => x.id).sort()
        expect(listed).toEqual([o.pending.id, o.archivedSale.id].sort())

        // GET /vendor/revenue/channels: two FBM sales, $30.00, and the 3% fee
        // on those alone (it was on all seven).
        const revenue = await collectCrossChannelRevenue(container(), o.seller.id, { since: new Date(Date.now() - 86_400_000) })
        expect(revenue.lines).toEqual([expect.objectContaining({ channel: "fbm", orders: 2, gross_amount: 3000, fee_amount: 90 })])
      })

      it("each non-sale condition filters in Postgres through query.graph, and none alone is enough", async () => {
        const o = await ordersInEveryState()
        const ids = [o.pending, o.archivedSale, o.canceled, o.archivedCanceled, o.drafted, o.archivedDraft, o.statusOnlyCanceled].map((x) => x.id)
        const read = async (filters: Record<string, unknown>) =>
          ((await query().graph({ entity: "order", fields: ["id"], filters: { id: ids, ...filters } })).data as Array<{ id: string }>)
            .map((x) => x.id)
            .sort()
        const sorted = (...xs: Array<{ id: string }>) => xs.map((x) => x.id).sort()
        const { status, canceled_at, is_draft_order } = NON_SALE_ORDER_FILTERS

        // Status alone keeps what archive moved to "archived".
        expect(await read({ status })).toEqual(sorted(o.pending, o.archivedSale, o.archivedCanceled, o.archivedDraft))
        // canceled_at alone keeps drafts, which are never cancelled, and a
        // hand-written "canceled" status.
        expect(await read({ canceled_at })).toEqual(sorted(o.pending, o.archivedSale, o.drafted, o.archivedDraft, o.statusOnlyCanceled))
        // is_draft_order alone keeps cancelled orders.
        expect(await read({ is_draft_order })).toEqual(
          sorted(o.pending, o.archivedSale, o.canceled, o.archivedCanceled, o.statusOnlyCanceled)
        )
        expect(await read({ ...NON_SALE_ORDER_FILTERS })).toEqual(sorted(o.pending, o.archivedSale))
      })

      it("the grower dashboard's sales block counts units and cents when handed the seller id", async () => {
        // The route keys by auth_context.actor_id, which is the member id in
        // production (SD-49): it still finds no seller there. This proves the
        // order read itself, which threw for every seller.
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])

        // Not sales in the period, and left out in the database (SD-52
        // re-review): a cancelled order, a draft, and an order from before the
        // six months the response's `period` names. The read had no status
        // filter and no date bound, so each one counted.
        const orders = container().resolve(Modules.ORDER)
        const canceled = await makeOrder(seller.id, [{ productId: product.id, quantity: 5, unitPrice: 40 }])
        await orders.cancel(canceled.id)
        const [draft] = await orders.createOrders([
          {
            currency_code: "usd",
            email: "buyer@example.com",
            status: "draft",
            is_draft_order: true,
            items: [{ title: "Jam", product_id: product.id, quantity: 7, unit_price: 60 }],
          },
        ])
        await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.ORDER]: { order_id: draft.id } })
        const old = await makeOrder(seller.id, [{ productId: product.id, quantity: 11, unitPrice: 80 }])
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await pg.raw(`UPDATE "order" SET created_at = now() - interval '7 months' WHERE id = ?`, [old.id])

        let body: any
        const res = { json: (b: unknown) => ((body = b), res), status: () => res } as any
        await growerDashboard({ auth_context: { actor_id: seller.id }, scope: container() } as any, res)

        expect(body.sales).toEqual({
          units_sold: 3,
          gross_revenue_cents: 3750,
          top_skus: [{ product_id: product.id, units: 3, revenue_cents: 3750 }],
          source: "orders",
        })
      })

      it("the nursery payouts route's per-product gross and cut are in cents", async () => {
        // getSellerOrders' unit_price is Medusa's major units; the route summed
        // it as cents, so 3 x $12.50 read gross_cents 37.5 (SD-52 re-review).
        // Keyed by the seller id here; production passes the member id (SD-49
        // fault 1). What "your cut" means is F7's to decide (inventory §10.8):
        // only the units are under test.
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5, title: "Fern" }])

        let body: any
        const res = { json: (b: unknown) => ((body = b), res), status: () => res } as any
        await nurseryPayouts({ auth_context: { actor_id: seller.id }, scope: container() } as any, res)

        const split = body.current_period.split_pct as number
        expect(body.split_breakdown).toEqual([
          { product_name: "Fern", units: 3, gross_cents: 3750, your_cut_cents: Math.round((3750 * split) / 100) },
        ])
      })
    })

    describe("seller push", () => {
      it("loadOrderForSellerPush returns the order, its seller and its unit count", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])

        const loaded = await loadOrderForSellerPush(container(), order.id)
        expect(loaded).toEqual(expect.objectContaining({ id: order.id, seller: expect.objectContaining({ id: seller.id }) }))
        expect(itemCount(loaded!)).toBe(3)
      })
    })

    describe("customer data export", () => {
      it("includes the customer's orders and their lines", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const customer = await makeCustomer()
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }], {
          customerId: customer.id,
          email: customer.email,
        })

        let status = 0
        let sent = ""
        const res = {
          status: (s: number) => ((status = s), res),
          send: (b: string) => ((sent = b), res),
          json: (b: unknown) => ((sent = JSON.stringify(b)), res),
          setHeader: () => res,
        } as any
        await dataExport({ auth_context: { actor_id: customer.id }, scope: container() } as any, res)

        expect(status).toBe(200)
        const body = JSON.parse(sent)
        expect(body.order_count).toBe(1)
        expect(body.orders).toEqual([
          expect.objectContaining({ id: order.id, items: [{ title: "Jam", quantity: 3, unit_price: 12.5 }] }),
        ])
      })
    })

    describe("Black Mask provisioning", () => {
      it("with the flag on, a vault order is enqueued with its seat count", async () => {
        const seller = await makeSeller()
        const restore = withEnv({
          [PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1]: "true",
          BLACK_MASK_PROVISIONING_URL: "https://black-mask.invalid/provision",
          BLACK_MASK_WEBHOOK_SECRET: "sd52-test-secret",
          BLACK_MASK_WEBHOOK_KEY_ID: "sd52",
          BLACK_MASK_SELLER_ID: seller.id,
        })
        try {
          const product = await makeProduct(seller.id, { [BLACK_MASK_PLAN_METADATA_KEY]: "vault_family" })
          const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 2, unitPrice: 10 }])

          const outcome = await enqueueBlackMaskProvisioning(container(), "order.placed", { id: order.id })
          expect(outcome).toEqual(expect.objectContaining({ status: "enqueued" }))

          const [delivery] = await webhooks().listWebhookDeliveries({ id: (outcome as { delivery_id: string }).delivery_id })
          expect(delivery.payload).toEqual(
            expect.objectContaining({ event: "placed", plan: "vault_family", seats: 2, subject: { type: "order", id: order.id } })
          )
        } finally {
          restore()
        }
      })
    })
  },
})
