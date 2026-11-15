import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ORDER_DISPUTE_MODULE } from "../../src/modules/order-dispute"
import type OrderDisputeService from "../../src/modules/order-dispute/service"
import { DisputeReason, DisputeStatus } from "../../src/modules/order-dispute/resolution"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * `GET /vendor/disputes`, `GET /vendor/disputes/:id` and
 * `POST /vendor/disputes/:id`, through a real vendor login on a real
 * database.
 *
 * The admin Disputes screen tells the operator the seller reads the decision
 * note in their claim record and can reply while a case is open or under
 * review. Both vendor routes took the seller id from `auth_context.actor_id`,
 * which for a vendor login is the member id (mem_*), and compared it with
 * `order_dispute.seller_id`, a seller id (sel_*): every list was empty and
 * every read and reply answered 404, so neither was true. They now resolve
 * the seller with `requireSellerId` (the SD-74 fix for the analytics routes).
 *
 * The token is the real login's, a member id, which is what the vendor panel
 * would send. Disputes are opened through the module service with the
 * vendor's real seller id, as the store intake writes it.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const service = () => container().resolve(ORDER_DISPUTE_MODULE) as OrderDisputeService

    const openAgainst = (sellerId: string, description = "Tracking says delivered; nothing arrived.") =>
      service().open({
        orderId: `order_${uid()}`,
        sellerId,
        customerId: `cus_${uid()}`,
        orderPlacedAt: new Date(),
        orderTotalCents: 2599,
        currencyCode: "usd",
        reason: DisputeReason.NOT_RECEIVED,
        description,
      })

    it("a vendor lists the live disputes against its seller and reads a decided one with its note", async () => {
      const vendor = await createAuthenticatedSeller({ api, getContainer })
      const rival = await createAuthenticatedSeller({ api, getContainer })
      // The shape that broke the routes: the login's actor is a member, not the seller.
      expect(vendor.actorId.startsWith("mem_")).toBe(true)

      const live = await openAgainst(vendor.seller.id)
      const decided = await openAgainst(vendor.seller.id)
      await service().resolve({
        disputeId: decided.id,
        adminId: "user_ops",
        status: DisputeStatus.RESOLVED_RELEASE,
        note: "Signed for at the door; the photo matches the address.",
      })
      const theirs = await openAgainst(rival.seller.id)

      const list = await safe(api.get("/vendor/disputes", authHeader(vendor.token)))
      expect(list.status).toBe(200)
      expect(list.data.disputes.map((d: { id: string }) => d.id)).toEqual([live.id])
      expect(list.data.count).toBe(1)

      const history = await safe(api.get("/vendor/disputes?status=resolved_release", authHeader(vendor.token)))
      expect(history.status).toBe(200)
      expect(history.data.disputes.map((d: { id: string }) => d.id)).toEqual([decided.id])

      const file = await safe(api.get(`/vendor/disputes/${decided.id}`, authHeader(vendor.token)))
      expect(file.status).toBe(200)
      expect(file.data.dispute).toMatchObject({
        id: decided.id,
        status: "resolved_release",
        description: "Tracking says delivered; nothing arrived.",
        claim_amount: 2599,
        award_amount: 0,
        resolution_note: "Signed for at the door; the photo matches the address.",
      })
      // Only what the vendor view allows: no admin or customer ids, no escrow id, no metadata.
      for (const hidden of ["resolved_by", "customer_id", "escrow_agreement_id", "metadata", "seller_id"]) {
        expect(file.data.dispute).not.toHaveProperty(hidden)
      }
      expect(file.data.events.map((e: { kind: string }) => e.kind)).toEqual(["opened", "resolved"])
      expect(file.data.events[1]).toMatchObject({ actor_type: "admin", to_status: "resolved_release" })
      for (const e of file.data.events) {
        expect(e).not.toHaveProperty("actor_id")
        expect(e).not.toHaveProperty("metadata")
      }

      // The rival sees none of it: not in its list, and the same 404 as no dispute.
      const rivalList = await safe(api.get("/vendor/disputes", authHeader(rival.token)))
      expect(rivalList.data.disputes.map((d: { id: string }) => d.id)).toEqual([theirs.id])
      const rivalRead = await safe(api.get(`/vendor/disputes/${decided.id}`, authHeader(rival.token)))
      expect(rivalRead.status).toBe(404)
      const missing = await safe(api.get(`/vendor/disputes/odsp_${uid()}`, authHeader(vendor.token)))
      expect(missing.status).toBe(404)
      expect(missing.data).toEqual(rivalRead.data)
    })

    it("a vendor replies to a live dispute, which records it without moving the case; a closed one refuses", async () => {
      const vendor = await createAuthenticatedSeller({ api, getContainer })
      const rival = await createAuthenticatedSeller({ api, getContainer })
      const live = await openAgainst(vendor.seller.id)
      await service().takeUnderReview({ disputeId: live.id, adminId: "user_ops" })

      // Another vendor cannot answer it, and is told nothing about it.
      const intruder = await safe(
        api.post(`/vendor/disputes/${live.id}`, { response: "Not mine to answer." }, authHeader(rival.token))
      )
      expect(intruder.status).toBe(404)

      const reply = await safe(
        api.post(
          `/vendor/disputes/${live.id}`,
          { response: "Shipped on the 3rd with tracking; I have asked the carrier." },
          authHeader(vendor.token)
        )
      )
      expect(reply.status).toBe(200)
      expect(reply.data.dispute).toMatchObject({
        id: live.id,
        status: "under_review",
        seller_response: "Shipped on the 3rd with tracking; I have asked the carrier.",
      })
      expect(reply.data.dispute).not.toHaveProperty("metadata")

      const [row] = (await service().listOrderDisputes({ id: live.id })) as any[]
      expect(row).toMatchObject({
        status: "under_review",
        seller_response: "Shipped on the 3rd with tracking; I have asked the carrier.",
      })
      expect(row.seller_responded_at).not.toBeNull()
      const events = (await service().listOrderDisputeEvents(
        { dispute_id: live.id },
        { order: { created_at: "ASC" } }
      )) as any[]
      expect(events.map((e) => e.kind)).toEqual(["opened", "status_changed", "seller_responded"])
      // Recorded against the seller, not the member who signed in.
      expect(events[2]).toMatchObject({ actor_type: "seller", actor_id: vendor.seller.id })

      // Once decided, the case takes no more replies.
      await service().resolve({
        disputeId: live.id,
        adminId: "user_ops",
        status: DisputeStatus.RESOLVED_REFUND,
        note: "The carrier confirms it was lost.",
      })
      const late = await safe(
        api.post(`/vendor/disputes/${live.id}`, { response: "One more thing." }, authHeader(vendor.token))
      )
      expect(late.status).toBe(409)
    })

    it("refuses a caller with no vendor login", async () => {
      const res = await safe(api.get("/vendor/disputes"))
      expect(res.status).toBe(401)
    })
  },
})
