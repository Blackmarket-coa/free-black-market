import { model } from "@medusajs/framework/utils"

export enum ContentPostVerificationStatus {
  UNVERIFIED = "unverified",
  VERIFIED = "verified",
  REJECTED = "rejected",
}

export enum ContentPostVerifiedVia {
  OAUTH = "oauth",
  WEBHOOK = "webhook",
  MANUAL_ADMIN = "manual_admin",
}

const ContentPost = model
  .define("content_post", {
    id: model.id().primaryKey(),

    creator_seller_id: model.text(),
    deal_id: model.text().nullable(),
    program_id: model.text().nullable(),

    platform: model.text(),
    external_post_id: model.text(),
    external_url: model.text(),
    caption: model.text().nullable(),
    thumbnail_url: model.text().nullable(),

    affiliate_link_id: model.text().nullable(),

    verification_status: model
      .enum(Object.values(ContentPostVerificationStatus))
      .default(ContentPostVerificationStatus.UNVERIFIED),
    verified_at: model.dateTime().nullable(),
    verified_via: model.text().nullable(),

    qualified: model.boolean().default(false),
    disqualified_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["creator_seller_id"],
      name: "IDX_content_post_creator",
    },
    {
      on: ["deal_id"],
      name: "IDX_content_post_deal",
    },
    {
      on: ["platform", "external_post_id"],
      name: "UQ_content_post_platform_post",
      unique: true,
    },
    {
      on: ["verification_status"],
      name: "IDX_content_post_verification",
    },
  ])

export default ContentPost
