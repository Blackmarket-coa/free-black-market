import { model } from "@medusajs/framework/utils"

export enum AffiliateLinkStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  REVOKED = "revoked",
}

const AffiliateLink = model
  .define("affiliate_link", {
    id: model.id().primaryKey(),

    short_code: model.text().unique(),
    creator_seller_id: model.text(),
    deal_id: model.text().nullable(),
    program_id: model.text().nullable(),
    vendor_id: model.text().nullable(),

    product_id: model.text().nullable(),
    collection_id: model.text().nullable(),
    destination_path: model.text(),

    utm_source: model.text().default("creator"),
    utm_medium: model.text().nullable(),
    utm_campaign: model.text().nullable(),
    utm_content: model.text().nullable(),

    allowed_origins: model.json().nullable(),

    status: model
      .enum(Object.values(AffiliateLinkStatus))
      .default(AffiliateLinkStatus.ACTIVE),

    click_count: model.number().default(0),
    attributed_order_count: model.number().default(0),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["creator_seller_id"],
      name: "IDX_affiliate_link_creator",
    },
    {
      on: ["program_id"],
      name: "IDX_affiliate_link_program",
    },
    {
      on: ["status"],
      name: "IDX_affiliate_link_status",
    },
  ])

export default AffiliateLink
