import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { COTTAGE_FOOD_MODULE } from "../../src/modules/cottage-food"
import { WELLNESS_MODULE } from "../../src/modules/wellness"
import { PROGRESSION_MODULE } from "../../src/modules/progression"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../src/modules/marketplace-webhooks"
import { BLACK_MASK_PLAN_METADATA_KEY } from "../../src/modules/marketplace-webhooks/black-mask"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import cottageFoodRecordSale from "../../src/subscribers/cottage-food-record-sale"
import cottageFoodReverseSale from "../../src/subscribers/cottage-food-reverse-sale"
import emitBlackoutOrderPlaced from "../../src/subscribers/emit-blackout-order-placed"
import wellnessOrderPlaced from "../../src/subscribers/wellness-order-placed"
import { getSellerOrders } from "../../src/shared/seller-orders"
import { collectCrossChannelRevenue } from "../../src/shared/cross-channel-revenue"
import { itemCount, loadOrderForSellerPush } from "../../src/shared/native-push-seller"
import { enqueueBlackMaskProvisioning } from "../../src/lib/black-mask-provisioning"
import { GET as dataExport } from "../../src/api/store/customers/me/data-export/route"
import { GET as growerDashboard } from "../../src/api/vendor/farm/grower-dashboard/route"
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

    type Line = { productId: string; quantity: number; unitPrice: number; title?: string }

    /** A placed order of `lines` (unit prices in Medusa's major units), linked to `sellerId`. */
    async function makeOrder(sellerId: string, lines: Line[], buyer: { customerId?: string; email?: string } = {}) {
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
            })),
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.ORDER]: { order_id: order.id } })
      return order as { id: string }
    }

    async function makeCustomer(metadata?: Record<string, unknown>) {
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: `buyer-${uid()}@example.com`, metadata }])
      return customer as { id: string; email: string }
    }

    const placed = (orderId: string) => ({ event: { data: { id: orderId } }, container: container() }) as any

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

    describe("Blackout order-placed events", () => {
      let restore: () => void = () => {}
      beforeEach(() => {
        // The emitter is a no-op unless both are set; nothing is sent from a test.
        restore = withEnv({ FREEBLACKMARKET_WEBHOOK_SECRET: "sd52-test-secret", BLACKOUT_API_BASE: "https://blackout.invalid" })
      })
      afterEach(() => restore())

      it("enqueues order.created and purchase.succeeded with the line's quantity, in minor units", async () => {
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        const customer = await makeCustomer({ blackout_user_id: "bo_user_sd52" })
        const order = await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }], {
          customerId: customer.id,
          email: customer.email,
        })

        await emitBlackoutOrderPlaced(placed(order.id))

        const [created] = await webhooks().listWebhookDeliveries({ event_id: `order.created:${order.id}` })
        expect(created?.payload).toEqual(
          expect.objectContaining({
            type: "order.created",
            orderId: order.id,
            userId: "bo_user_sd52",
            totalCents: 3750,
            items: [{ sku: null, title: "Jam", qty: 3, priceCents: 1250 }],
          })
        )

        const purchases = (await webhooks().listWebhookDeliveries({ event: "purchase.succeeded" })) as Array<{
          payload: Record<string, any>
        }>
        const mine = purchases.filter((d) => d.payload?.metadata?.fbmOrderId === order.id)
        expect(mine).toHaveLength(1)
        expect(mine[0].payload).toEqual(
          expect.objectContaining({ userId: "bo_user_sd52", providerListingId: product.id, amountCents: 3750 })
        )
      })
    })

    describe("wellness order subscriber", () => {
      async function wellnessSale() {
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
          capacity: 1,
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
            { productId: classProduct.id, quantity: 1, unitPrice: 30, title: "Sound bath" },
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

      it("the grower dashboard's sales block counts units and cents when handed the seller id", async () => {
        // The route keys by auth_context.actor_id, which is the member id in
        // production (SD-49): it still finds no seller there. This proves the
        // order read itself, which threw for every seller.
        const seller = await makeSeller()
        const product = await makeProduct(seller.id)
        await makeOrder(seller.id, [{ productId: product.id, quantity: 3, unitPrice: 12.5 }])

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
