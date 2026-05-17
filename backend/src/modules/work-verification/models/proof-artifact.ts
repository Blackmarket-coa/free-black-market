import { model } from "@medusajs/framework/utils"

export enum ProofArtifactKind {
  PHOTO = "photo",
  VIDEO = "video",
  DOCUMENT = "document",
  SHIPPING_LABEL = "shipping_label",
  TRACKING_EVENT = "tracking_event",
  IOT_SENSOR_LOG = "iot_sensor_log",
  SIGNED_MANIFEST = "signed_manifest",
  THIRD_PARTY_ATTESTATION = "third_party_attestation",
  ONCHAIN_RECEIPT = "onchain_receipt",
}

export enum ProofVerificationStatus {
  UNVERIFIED = "unverified",
  AUTO_VERIFIED = "auto_verified",
  MANUALLY_VERIFIED = "manually_verified",
  DISPUTED = "disputed",
  REJECTED = "rejected",
}

export enum ProofVerificationMethod {
  SIGNATURE = "signature",
  CARRIER_WEBHOOK = "carrier_webhook",
  ADMIN_REVIEW = "admin_review",
  PEER_ATTESTATION = "peer_attestation",
  ORACLE = "oracle",
  CUSTOMER_CONFIRMATION = "customer_confirmation",
}

export enum ProofContextType {
  SERVICE_CONTRACT = "service_contract",
  SERVICE_MILESTONE = "service_milestone",
  ORDER_SUBCONTRACT = "order_subcontract",
  CREATOR_POST = "creator_post",
  HARVEST_BATCH = "harvest_batch",
  PICK_PACK_BATCH = "pick_pack_batch",
}

const ProofArtifact = model
  .define("proof_artifact", {
    id: model.id().primaryKey(),

    owner_seller_id: model.text(),

    // Polymorphic context: what work this proves.
    context_type: model.enum(Object.values(ProofContextType)),
    context_id: model.text(),
    context_secondary_id: model.text().nullable(), // e.g. milestone id

    kind: model.enum(Object.values(ProofArtifactKind)),

    // Storage references
    storage_url: model.text().nullable(),
    storage_provider: model.text().nullable(), // "minio", "s3", etc.
    sha256: model.text().nullable(),
    captured_at: model.dateTime().nullable(),

    // Cryptographic envelope (mirrors marketplace-signing schema)
    signature_envelope: model.json().nullable(),

    // Verification state
    verification_status: model
      .enum(Object.values(ProofVerificationStatus))
      .default(ProofVerificationStatus.UNVERIFIED),
    verification_method: model.text().nullable(),
    verifier_id: model.text().nullable(),
    verified_at: model.dateTime().nullable(),
    rejection_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["owner_seller_id"],
      name: "IDX_proof_artifact_owner",
    },
    {
      on: ["context_type", "context_id"],
      name: "IDX_proof_artifact_context",
    },
    {
      on: ["verification_status"],
      name: "IDX_proof_artifact_status",
    },
  ])

export default ProofArtifact
