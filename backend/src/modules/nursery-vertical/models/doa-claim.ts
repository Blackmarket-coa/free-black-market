import { model } from "@medusajs/framework/utils"

export const DOA_CLAIM_STATUSES = ["open", "resolved"] as const
export type DoaClaimStatus = (typeof DOA_CLAIM_STATUSES)[number]

/**
 * DOA (dead-on-arrival) Claim — a buyer's report that a live plant arrived
 * dead or dying. Surfaced on the vendor's Orders page so claims get resolved
 * (reship/refund) quickly; unresolved claims hurt seller health.
 */
const DoaClaim = model.define("nursery_doa_claim", {
  id: model.id().primaryKey(),

  // Owning vendor — every list query is seller-scoped.
  seller_id: model.text(),

  order_id: model.text(),
  species_name: model.text(),
  buyer_reason: model.text(),

  opened_at: model.dateTime(),
  status: model.enum(DOA_CLAIM_STATUSES).default("open"),
  resolved_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_nursery_doa_claim_seller_id" },
    { on: ["status"], name: "IDX_nursery_doa_claim_status" },
    { on: ["order_id"], name: "IDX_nursery_doa_claim_order_id" },
  ])

export default DoaClaim
