import { model } from "@medusajs/framework/utils"

export enum CreatorDealStatus {
  ACTIVE = "active",
  FULFILLED = "fulfilled",
  VIOLATED = "violated",
  EXPIRED = "expired",
  CANCELED = "canceled",
}

const CreatorDeal = model
  .define("creator_deal", {
    id: model.id().primaryKey(),

    program_id: model.text(),
    application_id: model.text(),
    creator_seller_id: model.text(),
    vendor_id: model.text(),

    status: model
      .enum(Object.values(CreatorDealStatus))
      .default(CreatorDealStatus.ACTIVE),

    effective_from: model.dateTime(),
    effective_until: model.dateTime().nullable(),

    // Frozen terms snapshot so retroactive program edits don't change paid-out
    // commissions on already-attributed orders.
    terms_snapshot: model.json(),

    total_attributed_cents: model.bigNumber().default(0),
    total_paid_out_cents: model.bigNumber().default(0),

    // Convenience back-reference to the auto-generated default link
    default_affiliate_link_id: model.text().nullable(),

    violation_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["creator_seller_id", "status"],
      name: "IDX_creator_deal_creator_status",
    },
    {
      on: ["program_id"],
      name: "IDX_creator_deal_program",
    },
    {
      on: ["vendor_id"],
      name: "IDX_creator_deal_vendor",
    },
  ])

export default CreatorDeal
