import { model } from "@medusajs/framework/utils"

export enum CreatorProgramType {
  AFFILIATE_OPEN = "affiliate_open",
  AFFILIATE_INVITE = "affiliate_invite",
  SPONSORED_BRIEF = "sponsored_brief",
  COMMISSION_BOOST = "commission_boost",
  ENGAGEMENT_POOL = "engagement_pool",
}

export enum CreatorProgramStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  PAUSED = "paused",
  CLOSED = "closed",
  ARCHIVED = "archived",
}

export enum CreatorProgramAttributionModel {
  LAST_CLICK = "last_click",
  FIRST_CLICK = "first_click",
  LINEAR = "linear",
}

const CreatorProgram = model
  .define("creator_program", {
    id: model.id().primaryKey(),

    vendor_id: model.text(),
    title: model.text(),
    slug: model.text(),
    description: model.text().nullable(),
    brief_markdown: model.text().nullable(),

    program_type: model.enum(Object.values(CreatorProgramType)),
    status: model
      .enum(Object.values(CreatorProgramStatus))
      .default(CreatorProgramStatus.DRAFT),

    // Financial terms (snapshot copied to deal at acceptance time)
    commission_percent: model.number().nullable(),
    commission_flat_cents: model.number().nullable(),
    sponsorship_flat_cents: model.number().nullable(),
    pool_total_cents: model.number().nullable(),
    pool_period: model.text().nullable(), // "weekly" | "monthly"
    cookie_window_days: model.number().default(7),
    hold_days: model.number().default(7),
    attribution_model: model
      .enum(Object.values(CreatorProgramAttributionModel))
      .default(CreatorProgramAttributionModel.LAST_CLICK),
    currency_code: model.text().default("usd"),

    // Targeting
    product_ids: model.json().nullable(),
    collection_ids: model.json().nullable(),
    category_ids: model.json().nullable(),
    required_platforms: model.json().nullable(),
    min_followers: model.number().nullable(),
    geo_allowlist: model.json().nullable(),

    // Lifecycle
    starts_at: model.dateTime().nullable(),
    ends_at: model.dateTime().nullable(),
    budget_cap_cents: model.number().nullable(),
    budget_spent_cents: model.number().default(0),

    // Anti-fraud / KYC gating (uses vendor-verification levels)
    requires_kyc: model.boolean().default(false),
    min_verification_level: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["vendor_id"],
      name: "IDX_creator_program_vendor",
    },
    {
      on: ["status"],
      name: "IDX_creator_program_status",
    },
    {
      on: ["vendor_id", "slug"],
      name: "UQ_creator_program_vendor_slug",
      unique: true,
    },
  ])

export default CreatorProgram
