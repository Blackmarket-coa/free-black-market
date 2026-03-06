import { model } from "@medusajs/framework/utils"

const OracleVerificationReceipt = model
  .define("oracle_verification_receipt", {
    id: model.id().primaryKey(),
    market_id: model.text(),
    settlement_ref: model.text(),
    key_id: model.text(),
    algorithm: model.text().default("ed25519"),
    nonce: model.text(),
    payload_hash: model.text(),
    signature: model.text(),
    signature_verified: model.boolean().default(false),
    signed_at: model.dateTime(),
    expires_at: model.dateTime(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["market_id"], name: "IDX_oracle_receipt_market" },
    { on: ["settlement_ref"], name: "IDX_oracle_receipt_settlement_ref" },
    { on: ["key_id"], name: "IDX_oracle_receipt_key_id" },
    { on: ["nonce"], name: "IDX_oracle_receipt_nonce" },
  ])

export default OracleVerificationReceipt
