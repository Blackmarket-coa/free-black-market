import { model } from "@medusajs/framework/utils"

export enum OpsFundingBucketCode {
  OPS_CORE = "ops_core",
  PRODUCTION_INPUTS = "production_inputs",
  GROWTH = "growth",
  RESERVE = "reserve",
  CUSTOM = "custom",
}

const OpsFundingBucket = model
  .define("ops_funding_bucket", {
    id: model.id().primaryKey(),
    profile_id: model.text(),
    code: model.enum(Object.values(OpsFundingBucketCode)),
    name: model.text(),
    description: model.text().nullable(),
    is_active: model.boolean().default(true),
    display_order: model.number().default(0),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["profile_id"], name: "IDX_ops_bucket_profile" },
    { on: ["profile_id", "code"], name: "IDX_ops_bucket_profile_code" },
  ])

export default OpsFundingBucket
