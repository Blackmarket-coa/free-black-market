import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { ORDER_DISPUTE_MODULE } from "../../src/modules/order-dispute"
import type OrderDisputeService from "../../src/modules/order-dispute/service"
import { DisputeReason, DisputeStatus } from "../../src/modules/order-dispute/resolution"
import { openDisputeForOrder } from "../../src/shared/order-dispute-intake"
import { fixOrderDisputeMinorUnits } from "../../src/scripts/fix-order-dispute-minor-units"

jest.setTimeout(240 * 1000)

/**
 * The admin disputes API, as the admin panel's Disputes screens read it
 * (`admin-panel/src/routes/disputes`), on a real migrated database through
 * Medusa's admin authentication.
 *
 * Until those screens existed nothing called these routes, so nothing held
 * them to a shape. The panel reads `{ disputes, count }` from the queue,
 * `{ dispute, events }` from the case file, and sends `{ status,
 * award_amount?, note? }` to decide; these tests pin exactly that, plus the
 * refusals the panel explains before sending (a second decision, an award
 * over the claim, an award on a release).
 *
 * Most cases open disputes through the module service with a hand-fed
 * minor-unit claim, to test the admin side on its own. The intake cases go
 * through `openDisputeForOrder`, the path both storefront routes take, on a
 * real order with a Mercur-linked seller: the screen shows exactly what the
 * intake stores, and a claim the panel reads as minor units must be stored
 * as minor units. They were added when the review found the intake stored
 * Medusa's major-unit totals floored ($25.99 as 25); running them showed it
 * could not store anything at all (see `ORDER_FIELDS_FOR_DISPUTE`).
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const service = () => container().resolve(ORDER_DISPUTE_MODULE) as OrderDisputeService

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
      return { user, headers: { headers: { authorization: `Bearer ${token}` } } }
    }

    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)

    /** A $25.99 claim, opened `daysAgo` days ago. */
    async function openDispute(daysAgo = 0) {
      const dispute = await service().open({
        orderId: `order_${uid()}`,
        sellerId: `sel_${uid()}`,
        customerId: `cus_${uid()}`,
        orderPlacedAt: new Date(),
        orderTotalCents: 2599,
        currencyCode: "usd",
        reason: DisputeReason.NOT_RECEIVED,
        description: "Tracking says delivered; nothing arrived.",
      })
      if (daysAgo) {
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await pg.raw(`UPDATE order_dispute SET created_at = now() - (? * interval '1 day') WHERE id = ?`, [
          daysAgo,
          dispute.id,
        ])
      }
      return dispute
    }

    /**
     * A real order whose lines are a real product linked to a real Mercur
     * seller, and (as Mercur's cart split does) the order linked to that
     * seller too. Unit prices are Medusa major units.
     */
    async function sellerOrder(unitPrices: number[], opts: { productLink?: boolean } = {}) {
      const c = container()
      const created = await c
        .resolve(SELLER_MODULE)
        .createSellers({ name: `Grower ${uid()}`, handle: `grower-${uid()}` })
      const seller = Array.isArray(created) ? created[0] : created
      const [product] = await c.resolve(Modules.PRODUCT).createProducts([{ title: "Tomatoes", status: "published" }])
      const link = c.resolve(ContainerRegistrationKeys.LINK)
      if (opts.productLink !== false) {
        await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.PRODUCT]: { product_id: product.id } })
      }
      const customerId = `cus_${uid()}`
      const [order] = await c.resolve(Modules.ORDER).createOrders([
        {
          currency_code: "usd",
          customer_id: customerId,
          email: "buyer@example.com",
          items: unitPrices.map((unit_price) => ({
            title: "Tomatoes",
            quantity: 1,
            unit_price,
            ...(opts.productLink !== false ? { product_id: product.id } : {}),
          })),
        },
      ])
      await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.ORDER]: { order_id: order.id } })
      return { order, sellerId: seller.id as string, customerId }
    }

    it("is admin-only", async () => {
      const res = await call(api.get("/admin/disputes"))
      expect(res.status).toBe(401)
    })

    it("the queue is open and under review, oldest first, with the fields the panel reads", async () => {
      const { headers, user } = await asAdmin()
      const newer = await openDispute(1)
      const older = await openDispute(5)
      const reviewing = await openDispute(3)
      const decided = await openDispute(4)
      await service().takeUnderReview({ disputeId: reviewing.id, adminId: user.id })
      await service().resolve({
        disputeId: decided.id,
        adminId: user.id,
        status: DisputeStatus.RESOLVED_RELEASE,
        note: "Signed for at the door.",
      })

      const res = await call(api.get("/admin/disputes", headers))
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(res.data.disputes.length)
      const mine = [older.id, reviewing.id, newer.id, decided.id]
      const ids = res.data.disputes.map((d: { id: string }) => d.id).filter((id: string) => mine.includes(id))
      expect(ids).toEqual([older.id, reviewing.id, newer.id])

      const row = res.data.disputes.find((d: { id: string }) => d.id === older.id)
      expect(row).toMatchObject({
        order_id: older.order_id,
        seller_id: older.seller_id,
        customer_id: older.customer_id,
        status: "open",
        reason: "not_received",
        description: "Tracking says delivered; nothing arrived.",
        currency_code: "usd",
        claim_amount: 2599,
        award_amount: 0,
        escrow_agreement_id: null,
      })
      expect(Number.isNaN(new Date(row.created_at).getTime())).toBe(false)

      const history = await call(api.get("/admin/disputes?status=resolved_release", headers))
      expect(history.status).toBe(200)
      expect(history.data.disputes.map((d: { id: string }) => d.id)).toContain(decided.id)
      expect(history.data.disputes.every((d: { status: string }) => d.status === "resolved_release")).toBe(true)

      const bogus = await call(api.get("/admin/disputes?status=refunded", headers))
      expect(bogus.status).toBe(400)
    })

    it("take up, then refund part of the claim: recorded, logged in order, and final", async () => {
      const { headers, user } = await asAdmin()
      const dispute = await openDispute()

      const file = await call(api.get(`/admin/disputes/${dispute.id}`, headers))
      expect(file.status).toBe(200)
      expect(file.data.dispute.id).toBe(dispute.id)
      expect(file.data.events.map((e: { kind: string }) => e.kind)).toEqual(["opened"])
      expect(file.data.events[0]).toMatchObject({ actor_type: "buyer", actor_id: dispute.customer_id, to_status: "open" })

      const taken = await call(api.patch(`/admin/disputes/${dispute.id}`, { status: "under_review" }, headers))
      expect(taken.status).toBe(200)
      expect(taken.data).toMatchObject({ dispute: { status: "under_review" }, escrow_transition: null })

      const decided = await call(
        api.patch(
          `/admin/disputes/${dispute.id}`,
          { status: "resolved_refund", award_amount: 1250, note: "Half: one of two items arrived." },
          headers
        )
      )
      expect(decided.status).toBe(200)
      expect(decided.data.dispute).toMatchObject({
        status: "resolved_refund",
        award_amount: 1250,
        resolution_note: "Half: one of two items arrived.",
        resolved_by: user.id,
      })
      // Not escrowed: the decision names no escrow transition, and moves no money.
      expect(decided.data.escrow_transition).toBeNull()

      const again = await call(
        api.patch(`/admin/disputes/${dispute.id}`, { status: "withdrawn", note: "x" }, headers)
      )
      expect(again.status).toBe(409)

      const after = await call(api.get(`/admin/disputes/${dispute.id}`, headers))
      expect(after.data.events.map((e: { kind: string }) => e.kind)).toEqual(["opened", "status_changed", "resolved"])
      expect(after.data.events[2]).toMatchObject({
        actor_type: "admin",
        actor_id: user.id,
        from_status: "under_review",
        to_status: "resolved_refund",
        metadata: { award_amount: 1250 },
      })
    })

    it("a refund with no amount awards the whole claim", async () => {
      const { headers } = await asAdmin()
      const dispute = await openDispute()
      const res = await call(
        api.patch(`/admin/disputes/${dispute.id}`, { status: "resolved_refund", note: "Never shipped." }, headers)
      )
      expect(res.status).toBe(200)
      expect(res.data.dispute.award_amount).toBe(2599)
    })

    it("refuses an award over the claim and an award on a release, and writes nothing", async () => {
      const { headers } = await asAdmin()
      const dispute = await openDispute()

      const over = await call(
        api.patch(`/admin/disputes/${dispute.id}`, { status: "resolved_refund", award_amount: 2600, note: "x" }, headers)
      )
      expect(over.status).toBe(409)

      const release = await call(
        api.patch(`/admin/disputes/${dispute.id}`, { status: "resolved_release", award_amount: 5, note: "x" }, headers)
      )
      expect(release.status).toBe(409)

      const file = await call(api.get(`/admin/disputes/${dispute.id}`, headers))
      expect(file.data.dispute).toMatchObject({ status: "open", award_amount: 0, resolution_note: null })
      expect(file.data.events.map((e: { kind: string }) => e.kind)).toEqual(["opened"])
    })

    it("a claim filed through the real intake is stored, shown and decided in minor units", async () => {
      const { headers } = await asAdmin()
      // Two $12.99 lines: $25.98, which flooring each line used to make 24.
      const { order, sellerId, customerId } = await sellerOrder([12.99, 12.99])

      const filed = await openDisputeForOrder(container(), {
        customerId,
        orderId: order.id,
        reason: DisputeReason.NOT_RECEIVED,
        description: "Neither box arrived.",
        metadata: { contacted_seller: true, evidence_urls: [], intake_source: "store/order-claims" },
      })
      expect(filed).toMatchObject({ ok: true })
      if (!filed.ok) return

      const file = await call(api.get(`/admin/disputes/${filed.dispute.id}`, headers))
      expect(file.status).toBe(200)
      expect(file.data.dispute).toMatchObject({
        order_id: order.id,
        seller_id: sellerId,
        customer_id: customerId,
        currency_code: "usd",
        claim_amount: 2598,
        award_amount: 0,
        metadata: { contacted_seller: true, intake_source: "store/order-claims" },
      })

      const decided = await call(
        api.patch(`/admin/disputes/${filed.dispute.id}`, { status: "resolved_refund", note: "Never shipped." }, headers)
      )
      expect(decided.status).toBe(200)
      expect(decided.data.dispute.award_amount).toBe(2598)

      // Someone else's order is the same 404 as no order.
      const stranger = await openDisputeForOrder(container(), {
        customerId: `cus_${uid()}`,
        orderId: order.id,
        reason: DisputeReason.OTHER,
        description: "Not mine.",
      })
      expect(stranger).toMatchObject({ ok: false, status: 404 })
    })

    it("a line with no product link is the order's seller's, as Mercur splits orders per seller", async () => {
      const { order, sellerId, customerId } = await sellerOrder([25.99], { productLink: false })
      const filed = await openDisputeForOrder(container(), {
        customerId,
        orderId: order.id,
        reason: DisputeReason.DAMAGED,
        description: "Arrived crushed.",
      })
      expect(filed).toMatchObject({ ok: true, dispute: { seller_id: sellerId, claim_amount: 2599 } })
    })

    it("the corrective script puts an old floored claim and its award into minor units, once", async () => {
      const { user } = await asAdmin()
      const { order, sellerId, customerId } = await sellerOrder([25.99])
      // What the old intake stored for this order: floor(25.99) = 25.
      const legacy = await service().open({
        orderId: order.id,
        sellerId,
        customerId,
        orderPlacedAt: new Date(),
        orderTotalCents: 25,
        currencyCode: "usd",
        reason: DisputeReason.NOT_RECEIVED,
        description: "Never arrived.",
      })
      await service().resolve({
        disputeId: legacy.id,
        adminId: user.id,
        status: DisputeStatus.RESOLVED_REFUND,
        note: "Refund in full.",
      })
      const read = async () => (await service().listOrderDisputes({ id: legacy.id }))[0] as any

      const dry = await fixOrderDisputeMinorUnits(container(), { dryRun: true })
      expect(dry.corrected).toContain(legacy.id)
      expect(await read()).toMatchObject({ claim_amount: 25, award_amount: 25 })

      const applied = await fixOrderDisputeMinorUnits(container())
      expect(applied.corrected).toContain(legacy.id)
      const fixed = await read()
      expect(fixed).toMatchObject({ claim_amount: 2599, award_amount: 2599, status: "resolved_refund" })
      expect(fixed.metadata.amount_units_corrected).toMatchObject({
        claim_amount: { from: 25, to: 2599 },
        award_amount: { from: 25, to: 2599 },
      })
      const events = (await service().listOrderDisputeEvents(
        { dispute_id: legacy.id },
        { order: { created_at: "ASC" } }
      )) as any[]
      expect(events.map((e) => e.kind)).toEqual(["opened", "resolved", "amount_corrected"])
      expect(events[2]).toMatchObject({ actor_type: "system", actor_id: "script:fix-order-dispute-minor-units" })

      const again = await fixOrderDisputeMinorUnits(container())
      expect(again.corrected).not.toContain(legacy.id)
      expect(await read()).toMatchObject({ claim_amount: 2599, award_amount: 2599 })
    })

    it("a decision made from a stale read is refused and overwrites nothing", async () => {
      const { headers, user } = await asAdmin()
      const dispute = await openDispute()
      const stale = (await service().listOrderDisputes({ id: dispute.id }))[0]

      // Admin A releases it.
      await service().resolve({
        disputeId: dispute.id,
        adminId: user.id,
        status: DisputeStatus.RESOLVED_RELEASE,
        note: "Signed for.",
      })

      // Admin B's request read the case before A's write landed: replay
      // that interleaving by handing B's read the row as it was.
      const spy = jest.spyOn(service() as any, "require")
      try {
        spy.mockResolvedValueOnce(stale)
        const refund = await call(
          api.patch(`/admin/disputes/${dispute.id}`, { status: "resolved_refund", note: "Refund." }, headers)
        )
        expect(refund.status).toBe(409)

        spy.mockResolvedValueOnce(stale)
        const withdraw = await call(
          api.patch(`/admin/disputes/${dispute.id}`, { status: "withdrawn", note: "Dropped." }, headers)
        )
        expect(withdraw.status).toBe(409)
      } finally {
        spy.mockRestore()
      }

      const file = await call(api.get(`/admin/disputes/${dispute.id}`, headers))
      expect(file.data.dispute).toMatchObject({ status: "resolved_release", award_amount: 0, resolution_note: "Signed for." })
      expect(file.data.events.map((e: { kind: string }) => e.kind)).toEqual(["opened", "resolved"])
    })
  },
})
