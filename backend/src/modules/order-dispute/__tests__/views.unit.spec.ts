import { toBuyerDisputeView, toVendorDisputeEventView, toVendorDisputeView } from "../views"

/**
 * Each party's view of a dispute is an allow-list. These pin what is left
 * out: the deciding admin's user id, the escrow id, the metadata (intake
 * bookkeeping and the corrective script's record), and each event actor's
 * internal id. The routes that use them: `GET /store/orders/:id/dispute`
 * (buyer) and `GET/POST /vendor/disputes[/:id]` (vendor, also on Postgres in
 * `integration-tests/http/vendor-disputes.spec.ts`).
 */

const row = {
  id: "odsp_1",
  order_id: "order_1",
  seller_id: "sel_a",
  customer_id: "cus_1",
  status: "resolved_release",
  reason: "not_received",
  description: "Never arrived.",
  currency_code: "usd",
  claim_amount: 2599,
  award_amount: 0,
  seller_response: "Signed for; photo attached to the carrier record.",
  seller_responded_at: "2026-11-02T00:00:00Z",
  resolution_note: "Signed for at the door.",
  resolved_at: "2026-11-03T00:00:00Z",
  resolved_by: "user_01ADMIN",
  escrow_agreement_id: "esc_1",
  metadata: { amount_unit: "minor", amount_units_corrected: { by: "script" }, legacy_request_id: "req_1" },
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-03T00:00:00Z",
  deleted_at: null,
}

const INTERNAL = ["resolved_by", "escrow_agreement_id", "metadata", "deleted_at"]

describe("dispute views", () => {
  it("the buyer reads the claim and the decision with its note, not the reply or anything internal", () => {
    const view = toBuyerDisputeView(row)
    expect(view).toMatchObject({ id: "odsp_1", seller_id: "sel_a", status: "resolved_release", resolution_note: "Signed for at the door." })
    for (const key of [...INTERNAL, "customer_id", "seller_response", "seller_responded_at"]) {
      expect(view).not.toHaveProperty(key)
    }
  })

  it("the vendor reads the claim, its own reply and the decision with its note, not the buyer's id or anything internal", () => {
    const view = toVendorDisputeView(row)
    expect(view).toMatchObject({
      id: "odsp_1",
      description: "Never arrived.",
      seller_response: "Signed for; photo attached to the carrier record.",
      resolution_note: "Signed for at the door.",
      claim_amount: 2599,
    })
    for (const key of [...INTERNAL, "customer_id", "seller_id"]) {
      expect(view).not.toHaveProperty(key)
    }
  })

  it("the vendor's event log says which party acted, not which person", () => {
    const view = toVendorDisputeEventView({
      id: "ev_1",
      dispute_id: "odsp_1",
      kind: "resolved",
      actor_type: "admin",
      actor_id: "user_01ADMIN",
      from_status: "open",
      to_status: "resolved_release",
      message: "Signed for at the door.",
      metadata: { award_amount: 0 },
      created_at: "2026-11-03T00:00:00Z",
    })
    expect(view).toEqual({
      id: "ev_1",
      kind: "resolved",
      actor_type: "admin",
      from_status: "open",
      to_status: "resolved_release",
      message: "Signed for at the door.",
      created_at: "2026-11-03T00:00:00Z",
    })
  })

  it("copies only fields that are there, and reads anything else as empty", () => {
    expect(toBuyerDisputeView({ id: "odsp_2" })).toEqual({ id: "odsp_2" })
    expect(toVendorDisputeView(null)).toEqual({})
  })
})
