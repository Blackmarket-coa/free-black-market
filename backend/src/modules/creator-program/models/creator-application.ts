import { model } from "@medusajs/framework/utils"

export enum CreatorApplicationStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  WITHDRAWN = "withdrawn",
}

const CreatorApplication = model
  .define("creator_application", {
    id: model.id().primaryKey(),

    program_id: model.text(),
    creator_seller_id: model.text(),

    pitch: model.text().nullable(),
    proposed_platforms: model.json().nullable(),
    follower_snapshot: model.json().nullable(),

    status: model
      .enum(Object.values(CreatorApplicationStatus))
      .default(CreatorApplicationStatus.PENDING),
    decided_at: model.dateTime().nullable(),
    decided_by: model.text().nullable(),
    decision_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["program_id"],
      name: "IDX_creator_application_program",
    },
    {
      on: ["creator_seller_id"],
      name: "IDX_creator_application_creator",
    },
    {
      on: ["program_id", "creator_seller_id"],
      name: "UQ_creator_application",
      unique: true,
    },
  ])

export default CreatorApplication
