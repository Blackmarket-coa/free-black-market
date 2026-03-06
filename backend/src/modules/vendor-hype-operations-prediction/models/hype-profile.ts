import { model } from "@medusajs/framework/utils"

export enum HypeProfileType {
  VENDOR = "vendor",
  ORGANIZER = "organizer",
  ORGANIZATION = "organization",
}

export enum HypeProfileStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

const HypeProfile = model
  .define("hype_profile", {
    id: model.id().primaryKey(),
    profile_type: model.enum(Object.values(HypeProfileType)),
    owner_id: model.text(),
    slug: model.text().searchable(),
    display_name: model.text(),
    mission: model.text(),
    story_markdown: model.text().nullable(),
    trust_score: model.number().nullable(),
    readiness_score: model.number().nullable(),
    capital_need_amount: model.bigNumber().nullable(),
    status: model
      .enum(Object.values(HypeProfileStatus))
      .default(HypeProfileStatus.DRAFT),
    published_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["owner_id"], name: "IDX_hype_profile_owner" },
    { on: ["slug"], name: "IDX_hype_profile_slug" },
    { on: ["status"], name: "IDX_hype_profile_status" },
  ])

export default HypeProfile
