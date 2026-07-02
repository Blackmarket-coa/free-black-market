import { model } from "@medusajs/framework/utils"

/**
 * Coarse document category. Deliberately generic — a lease, a certificate of
 * insurance, and a practitioner credential are all just typed, vendor-uploaded
 * files. The quest engine maps `doc_type` to requirements; it does NOT assume
 * any particular vendor vertical.
 */
export enum VaultDocumentType {
  LEASE = "lease",
  CONTRACT = "contract",
  LICENSE = "license",
  INSURANCE = "insurance",
  CREDENTIAL = "credential",
  BUSINESS_PLAN = "business_plan",
  OTHER = "other",
}

/**
 * Document Vault entry.
 *
 * A vendor-uploaded document that quests may reference as evidence (leases,
 * contracts, licenses, insurance, credentials). This module is OPT-IN: it is
 * only prompted when a quest the vendor chose asks for a document, and its
 * existence never enrolls the vendor in anything.
 *
 * Files themselves live in the Medusa File module (minio-file provider); we
 * only store the resulting `file_id` plus vendor-facing metadata. `verified`
 * reflects a real human/admin check — it is NEVER auto-set and NEVER fabricated
 * (hard constraint: FBM assembles evidence, it does not invent it).
 */
const VaultDocument = model.define("vault_document", {
  id: model.id().primaryKey(),

  // Owning vendor (MercurJS seller id). All reads are scoped by this — a
  // vendor's documents are never exposed to another vendor.
  seller_id: model.text(),

  doc_type: model
    .enum(Object.values(VaultDocumentType))
    .default(VaultDocumentType.OTHER),

  // Human label the vendor gave the document.
  label: model.text(),

  // Reference into the Medusa File module. Nullable so a "placeholder" row can
  // record that a document is expected/pending before the file is uploaded.
  file_id: model.text().nullable(),

  // Optional lifecycle dates (e.g. an insurance certificate's coverage window).
  issued_at: model.dateTime().nullable(),
  expires_at: model.dateTime().nullable(),

  // Real verification only. Reflects a confirmed human/admin check.
  verified: model.boolean().default(false),
  verified_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_vault_document_seller_id" },
    { on: ["doc_type"], name: "IDX_vault_document_doc_type" },
  ])

export default VaultDocument
