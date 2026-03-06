import { model } from "@medusajs/framework/utils"

export enum OracleSigningKeyStatus {
  ACTIVE = "active",
  RETIRING = "retiring",
  RETIRED = "retired",
}

const OracleSigningKey = model
  .define("oracle_signing_key", {
    id: model.id().primaryKey(),
    key_id: model.text(),
    algorithm: model.text().default("ed25519"),
    public_key_pem: model.text(),
    status: model
      .enum(Object.values(OracleSigningKeyStatus))
      .default(OracleSigningKeyStatus.ACTIVE),
    valid_from: model.dateTime(),
    valid_to: model.dateTime().nullable(),
    rotation_note: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["key_id"], name: "IDX_oracle_signing_key_key_id" },
    { on: ["status"], name: "IDX_oracle_signing_key_status" },
    { on: ["algorithm", "status"], name: "IDX_oracle_signing_key_algo_status" },
  ])

export default OracleSigningKey
