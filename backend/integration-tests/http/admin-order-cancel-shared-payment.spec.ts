import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { cardOrderFixtures } from "./helpers/card-orders"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { cancelOrderWorkflowId } from "@medusajs/medusa/core-flows"
import { findOrdersSharingPayment, SHARED_PAYMENT_CANCEL_REFUSED } from "../../src/lib/shared-payment-cancel"
import { REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID } from "../../src/api/middlewares/shared-payment-order-cancel"

jest.setTimeout(240 * 1000)

/**
 * SD-36 (8) on a real migrated database, through the real HTTP stack: Medusa's
 * admin authentication, FBM's middleware on `POST /admin/orders/:id/cancel`
 * and on Medusa's workflow runner (`POST /admin/workflows-executions/:id/run`),
 * and Medusa's own routes and `cancelOrderWorkflow` behind them.
 *
 * The cart is built the way Mercur's split-and-complete-cart leaves one: one
 * payment collection linked to every seller's order, a split row per order
 * (helpers/card-orders.ts). The money is taken with Medusa's
 * `pp_system_default` provider (no network) and left on it, so a cancel that
 * got through would really refund or void the payment: the assertions read
 * the payment Medusa stored, not a stub.
 *
 * Without the guard, a cancel of the $40 order on a $40 + $30 cart refunds
 * all $70 and then fails (Medusa's order-transaction step finds no single
 * order on a shared collection): 500, order still open, refund gone. That
 * was seen on this database with MikroORM's populate crash (below) patched
 * locally; under the repo's patch as committed, Medusa's cancel of a paid
 * order dies earlier, on its first read (see medusaCancelCanRead).
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const { container, uid, makeSeller, makeOrder, pay, split, setProvider } = cardOrderFixtures(getContainer)

    let drainSubscribers: () => Promise<void> = async () => {}
    beforeEach(() => {
      drainSubscribers = trackSubscribers(container)
    })

    /** A real admin user and a bearer token Medusa's admin auth accepts. */
    async function asAdmin() {
      const [user] = await container()
        .resolve(Modules.USER)
        .createUsers([{ email: `admin+${uid()}@example.com` }])
      const secret = process.env.JWT_SECRET
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      const token = jwt.sign(
        { actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } },
        secret,
        { expiresIn: "1h" }
      )
      return { headers: { authorization: `Bearer ${token}` } }
    }

    const cancel = async (orderId: string) =>
      api.post(`/admin/orders/${orderId}/cancel`, {}, await asAdmin()).catch((e: any) => e.response)

    const runWorkflow = async (workflowId: string, body: unknown) =>
      api
        .post(`/admin/workflows-executions/${workflowId}/run`, body, await asAdmin())
        .catch((e: any) => e.response)

    /** Paid through the system provider and left on it, so Medusa's cancel can really refund or void. */
    async function paidCart(amounts: number[], opts: { capture: boolean }) {
      const orders: Array<{ id: string }> = []
      for (const amount of amounts) orders.push(await makeOrder((await makeSeller()).id, amount))
      const total = amounts.reduce((a, b) => a + b, 0)
      const { collectionId, paymentId } = await pay(
        orders.map((o) => o.id),
        total,
        opts
      )
      await setProvider(paymentId, "pp_system_default")
      for (let i = 0; i < orders.length; i++) await split(orders[i].id, collectionId, amounts[i])
      return { orders, collectionId, paymentId }
    }

    async function money(paymentId: string, collectionId: string) {
      const payments = container().resolve(Modules.PAYMENT)
      const payment = await payments.retrievePayment(paymentId, { relations: ["refunds", "captures"] })
      const collection = await payments.retrievePaymentCollection(collectionId)
      return {
        refunded: (payment.refunds ?? []).reduce((sum: number, r: { amount: unknown }) => sum + Number(r.amount), 0),
        payment_canceled: !!payment.canceled_at,
        collection_status: collection.status as string,
      }
    }

    const statusOf = async (orderId: string) =>
      (await container().resolve(Modules.ORDER).retrieveOrder(orderId)).status as string

    /**
     * Whether Medusa's cancel can make its first read of this order here: the
     * `get-order` step of `cancelOrderWorkflow` (@medusajs/core-flows 2.14.2),
     * same fields. Under MikroORM 6.6.14 it depends on the install:
     *  - without scripts/patch-mikro-orm.js (an install that skipped
     *    postinstall) every such read dies in `pruneToOneRelations`;
     *  - with it (CI's postinstall, railway-start.js in production) an unpaid
     *    order reads, but a PAID one still dies: the planner derives a
     *    `captures_id` populate hint on Payment and
     *    `EntityLoader.populateField`, which the patch does not guard,
     *    dereferences it. A separate defect from the one tested here.
     * When the read fails, Medusa's cancel fails before it moves money; the
     * pass-through tests assert whichever outcome is true, exactly.
     */
    async function medusaCancelCanRead(orderId: string): Promise<boolean> {
      try {
        await container()
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({
            entity: "order",
            fields: [
              "id",
              "status",
              "items.id",
              "fulfillments.canceled_at",
              "payment_collections.payments.id",
              "payment_collections.payments.amount",
              "payment_collections.payments.refunds.id",
              "payment_collections.payments.refunds.amount",
              "payment_collections.payments.refunds.raw_amount",
              "payment_collections.payments.captures.id",
              "payment_collections.payments.captures.amount",
              "payment_collections.payments.captures.raw_amount",
            ],
            filters: { id: orderId },
          })
        return true
      } catch {
        return false
      }
    }

    describe("POST /admin/orders/:id/cancel on a Mercur multi-seller cart", () => {
      afterEach(() => drainSubscribers())

      it("refuses to cancel one seller's order on a captured $40 + $30 cart, and refunds nothing", async () => {
        const { orders, collectionId, paymentId } = await paidCart([40, 30], { capture: true })
        const [o1, o2] = orders
        const before = await money(paymentId, collectionId)
        expect(before).toMatchObject({ refunded: 0, payment_canceled: false })
        expect(before.collection_status).not.toBe("canceled")

        const res = await cancel(o1.id)

        expect(res.status).toBe(409)
        expect(res.data).toMatchObject({
          code: SHARED_PAYMENT_CANCEL_REFUSED,
          order_id: o1.id,
          shared_payment_collections: [{ payment_collection_id: collectionId, other_order_ids: [o2.id] }],
        })
        expect(res.data.message).toContain(o2.id)
        expect(res.data.message).toContain("vendor panel")
        // Nothing moved: no refund, the payment and collection as they were, both orders open.
        expect(await money(paymentId, collectionId)).toEqual(before)
        expect(await statusOf(o1.id)).toBe("pending")
        expect(await statusOf(o2.id)).toBe("pending")
      })

      it("refuses on an authorized-only cart, and leaves the shared authorization alone", async () => {
        const { orders, collectionId, paymentId } = await paidCart([40, 30], { capture: false })
        const [o1, o2] = orders
        const before = await money(paymentId, collectionId)
        expect(before.payment_canceled).toBe(false)

        const res = await cancel(o2.id)

        expect(res.status).toBe(409)
        expect(res.data.code).toBe(SHARED_PAYMENT_CANCEL_REFUSED)
        expect(res.data.shared_payment_collections).toEqual([
          { payment_collection_id: collectionId, other_order_ids: [o1.id] },
        ])
        expect(await money(paymentId, collectionId)).toEqual(before)
        expect(await statusOf(o2.id)).toBe("pending")
      })

      it("refuses even when the other order is already canceled and refunded", async () => {
        const { orders, collectionId, paymentId } = await paidCart([40, 30], { capture: true })
        const [o1, o2] = orders
        // o2 as Mercur's split-aware vendor cancel leaves it: its $30 refunded
        // off the shared payment, the order canceled. Medusa's refund on what
        // is left would still be written against no order (see the header).
        await container().resolve(Modules.PAYMENT).refundPayment({ payment_id: paymentId, amount: 30 })
        await container().resolve(Modules.ORDER).cancel(o2.id)
        const before = await money(paymentId, collectionId)
        expect(before.refunded).toBe(30)

        const res = await cancel(o1.id)

        expect(res.status).toBe(409)
        expect(res.data.shared_payment_collections).toEqual([
          { payment_collection_id: collectionId, other_order_ids: [o2.id] },
        ])
        expect(await money(paymentId, collectionId)).toEqual(before)
        expect(await statusOf(o1.id)).toBe("pending")
      })
    })

    describe("POST /admin/orders/:id/cancel on an order whose payment is its own", () => {
      afterEach(() => drainSubscribers())

      it("hands an unpaid single-seller order to Medusa's cancel unchanged", async () => {
        const o1 = await makeOrder((await makeSeller()).id, 40)
        const payments = container().resolve(Modules.PAYMENT)
        const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: 40 }])
        await container().resolve(ContainerRegistrationKeys.LINK).create({
          [Modules.ORDER]: { order_id: o1.id },
          [Modules.PAYMENT]: { payment_collection_id: collection.id },
        })
        const readable = await medusaCancelCanRead(o1.id)

        const res = await cancel(o1.id)

        expect(res.status).not.toBe(409)
        expect(res.data?.code).not.toBe(SHARED_PAYMENT_CANCEL_REFUSED)
        if (readable) {
          // Medusa's cancel, end to end: the order and its collection canceled.
          expect(res.status).toBe(200)
          expect(res.data.order.id).toBe(o1.id)
          expect(await statusOf(o1.id)).toBe("canceled")
          expect((await payments.retrievePaymentCollection(collection.id)).status).toBe("canceled")
        } else {
          // An install without scripts/patch-mikro-orm.js: Medusa's cancel dies on its first read.
          // The guard's own reads succeed here and find no other order, so the
          // 500 is Medusa's, after the guard passed the request on.
          expect(res.status).toBe(500)
          expect(await findOrdersSharingPayment(container(), o1.id)).toEqual([])
          expect(await statusOf(o1.id)).toBe("pending")
        }
      })

      it("hands a paid single-seller order to Medusa's cancel unchanged", async () => {
        const { orders, collectionId, paymentId } = await paidCart([40], { capture: true })
        const [o1] = orders
        const readable = await medusaCancelCanRead(o1.id)

        const res = await cancel(o1.id)

        expect(res.status).not.toBe(409)
        expect(res.data?.code).not.toBe(SHARED_PAYMENT_CANCEL_REFUSED)
        if (readable) {
          // Medusa's cancel as designed: the order canceled, its whole payment refunded.
          expect(res.status).toBe(200)
          expect(await statusOf(o1.id)).toBe("canceled")
          expect(await money(paymentId, collectionId)).toEqual({
            refunded: 40,
            payment_canceled: false,
            collection_status: "canceled",
          })
        } else {
          // Medusa's cancel as it runs today (see medusaCancelCanRead): it
          // fails reading the order, before it touches money. The guard's own
          // reads succeed and find no other order, so the 500 is Medusa's.
          expect(res.status).toBe(500)
          expect(await findOrdersSharingPayment(container(), o1.id)).toEqual([])
          expect(await statusOf(o1.id)).toBe("pending")
          expect((await money(paymentId, collectionId)).refunded).toBe(0)
        }
      })
    })

    describe("POST /admin/workflows-executions/:workflow_id/run, Medusa's generic workflow runner", () => {
      afterEach(() => drainSubscribers())

      // Without this guard, either run on the $40 order refunded all $70 and
      // answered 500 with both orders open (seen with Medusa's read crash
      // patched out locally; on an install where that read crashes, the run
      // fails before money moves, so these 409s are the guard's either way).
      it.each([
        [cancelOrderWorkflowId, "canceled"],
        [REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID, "refunded"],
      ])("refuses %s on one seller's order of a captured $40 + $30 cart, and refunds nothing", async (workflowId, verb) => {
        const { orders, collectionId, paymentId } = await paidCart([40, 30], { capture: true })
        const [o1, o2] = orders
        const before = await money(paymentId, collectionId)

        const res = await runWorkflow(workflowId, { input: { order_id: o1.id } })

        expect(res.status).toBe(409)
        expect(res.data).toMatchObject({
          code: SHARED_PAYMENT_CANCEL_REFUSED,
          order_id: o1.id,
          shared_payment_collections: [{ payment_collection_id: collectionId, other_order_ids: [o2.id] }],
        })
        expect(res.data.message).toContain(`cannot be ${verb} here`)
        expect(await money(paymentId, collectionId)).toEqual(before)
        expect(await statusOf(o1.id)).toBe("pending")
        expect(await statusOf(o2.id)).toBe("pending")
      })

      it.each<[string, (orderIds: string[]) => unknown]>([
        ["no order_id", () => ({ input: {} })],
        ["no input", () => ({})],
        ["order_id as an array", (orderIds) => ({ input: { order_id: orderIds } })],
      ])("fails closed on a cancel-order run with %s: 400, nothing moved", async (_label, bodyFor) => {
        const { orders, collectionId, paymentId } = await paidCart([40, 30], { capture: true })
        const before = await money(paymentId, collectionId)

        const res = await runWorkflow(cancelOrderWorkflowId, bodyFor(orders.map((o) => o.id)))

        expect(res.status).toBe(400)
        expect(res.data.type).toBe("invalid_data")
        expect(await money(paymentId, collectionId)).toEqual(before)
        for (const o of orders) expect(await statusOf(o.id)).toBe("pending")
      })

      it("hands a cancel-order run on a paid single-seller order to Medusa's runner unchanged", async () => {
        const { orders, collectionId, paymentId } = await paidCart([40], { capture: true })
        const [o1] = orders
        const readable = await medusaCancelCanRead(o1.id)

        const res = await runWorkflow(cancelOrderWorkflowId, { input: { order_id: o1.id } })

        expect(res.status).not.toBe(409)
        expect(res.status).not.toBe(400)
        expect(res.data?.code).not.toBe(SHARED_PAYMENT_CANCEL_REFUSED)
        expect(await findOrdersSharingPayment(container(), o1.id)).toEqual([])
        if (readable) {
          expect(res.status).toBe(200)
          expect(await statusOf(o1.id)).toBe("canceled")
          expect(await money(paymentId, collectionId)).toEqual({
            refunded: 40,
            payment_canceled: false,
            collection_status: "canceled",
          })
        } else {
          // Medusa's own read fails (see medusaCancelCanRead), before money moves.
          expect(res.status).toBe(500)
          expect(await statusOf(o1.id)).toBe("pending")
          expect((await money(paymentId, collectionId)).refunded).toBe(0)
        }
      })
    })

    describe("POST /admin/orders/:id/cancel without an admin", () => {
      afterEach(() => drainSubscribers())

      it("answers 401 before the guard reads anything, so a shared cart is not told apart", async () => {
        const { orders } = await paidCart([40, 30], { capture: true })
        const res = await api.post(`/admin/orders/${orders[0].id}/cancel`, {}).catch((e: any) => e.response)
        expect(res.status).toBe(401)
        const run = await api
          .post(`/admin/workflows-executions/${cancelOrderWorkflowId}/run`, { input: { order_id: orders[0].id } })
          .catch((e: any) => e.response)
        expect(run.status).toBe(401)
        expect(await statusOf(orders[0].id)).toBe("pending")
      })
    })
  },
})
