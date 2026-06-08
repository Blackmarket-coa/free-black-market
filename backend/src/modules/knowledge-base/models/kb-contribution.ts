import { model } from "@medusajs/framework/utils"

export enum KbContributionStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

/**
 * A community-submitted tutorial/guide/method awaiting moderation (§14
 * "Community Contributions"). On approval it becomes a published `kb_article`.
 */
const KbContribution = model
  .define("kb_contribution", {
    id: model.id().primaryKey(),
    submitter_id: model.text(),
    submitter_type: model.enum(["CUSTOMER", "SELLER"]).default("CUSTOMER"),

    title: model.text(),
    type: model.text().default("DIY"),
    /** Proposed article payload (summary, body, materials, steps, …). */
    payload: model.json(),

    status: model
      .enum(Object.values(KbContributionStatus))
      .default(KbContributionStatus.PENDING),
    review_note: model.text().nullable(),
    decided_by: model.text().nullable(),
    decided_at: model.dateTime().nullable(),
    resulting_article_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["status"], name: "IDX_kb_contribution_status" },
    { on: ["submitter_id"], name: "IDX_kb_contribution_submitter" },
  ])

export default KbContribution
