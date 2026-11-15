import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { ORDER_DISPUTE_MODULE } from "../../src/modules/order-dispute"
import type OrderDisputeService from "../../src/modules/order-dispute/service"
import { DisputeReason, DisputeStatus } from "../../src/modules/order-dispute/resolution"

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
 * Disputes are opened through the module service rather than the storefront
 * intake: what is under test is the admin side, and the intake needs a real
 * seller-attributed order that has nothing to do with it.
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
  },
})
