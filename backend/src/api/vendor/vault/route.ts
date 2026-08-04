import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DOCUMENT_VAULT_MODULE } from "../../../modules/document-vault"
import type DocumentVaultModuleService from "../../../modules/document-vault/service"
import { VaultDocumentType } from "../../../modules/document-vault/models/vault-document"
import { getSellerId } from "../quests/_helpers"
import {
  getSellerPlanLimits,
  respondPlanLimitReached,
} from "../../../shared/seller-plan"
import { hasRoomFor } from "../../../modules/vendor-plan/limits"
import { formatBytes, measureFileBytes } from "../../../shared/file-size"

/** GET /vendor/vault — a vendor's uploaded evidence documents (opt-in). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<DocumentVaultModuleService>(DOCUMENT_VAULT_MODULE)
  const documents = await service.listForSeller(sellerId)
  res.json({ documents, count: documents.length })
}

interface CreateDocBody {
  doc_type?: "lease" | "contract" | "license" | "insurance" | "credential" | "business_plan" | "other"
  label: string
  file_id?: string
  issued_at?: string
  expires_at?: string
}

/**
 * POST /vendor/vault — register an uploaded document.
 *
 * The file itself is uploaded via the File module (uploadFilesWorkflow); this
 * records the resulting `file_id` + metadata. `verified` is never set here — it
 * only reflects a real admin check (FBM never fabricates verification).
 */
export const POST = async (req: MedusaRequest<CreateDocBody>, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateDocBody)
  if (!b.label) return res.status(400).json({ message: "label is required" })

  const service = req.scope.resolve<DocumentVaultModuleService>(DOCUMENT_VAULT_MODULE)

  // Two independent caps, because they bound different costs: the document
  // count bounds how much work the vault represents, bytes bound what it costs
  // to keep. Five 2 GB videos and five 40 KB PDFs are the same number of
  // documents and are not the same product.
  const existing = await service.listForSeller(sellerId)
  const { plan_code, limits } = await getSellerPlanLimits(req.scope, sellerId)
  if (!hasRoomFor(existing.length, limits.vault_documents)) {
    return respondPlanLimitReached(res, {
      limit_key: "vault_documents",
      limit: limits.vault_documents,
      current: existing.length,
      plan_code,
      noun: "vault documents",
    })
  }

  // Measured server-side against the object store, never taken from the
  // request — a cap enforced against a number the client sends is not a cap.
  // `null` means we could not measure it, which is treated as "unknown", not
  // "empty": the document is still stored and simply contributes nothing to
  // the quota. Failing an upload because the object store was briefly slow
  // would turn metering into an availability problem on somebody's document.
  const bytes = await measureFileBytes(req.scope, b.file_id)
  if (bytes !== null) {
    const usedBytes = await service.storageBytesForSeller(sellerId)
    if (!hasRoomFor(usedBytes, limits.vault_storage_bytes, bytes)) {
      return respondPlanLimitReached(res, {
        limit_key: "vault_storage_bytes",
        limit: limits.vault_storage_bytes,
        current: usedBytes,
        plan_code,
        noun: "of vault storage",
        display_limit: formatBytes((limits.vault_storage_bytes ?? 0) as number),
      })
    }
  }

  const document = await service.createVaultDocuments({
    seller_id: sellerId,
    doc_type: (b.doc_type ?? "other") as VaultDocumentType,
    label: b.label,
    file_id: b.file_id ?? null,
    bytes_stored: bytes,
    issued_at: b.issued_at ? new Date(b.issued_at) : null,
    expires_at: b.expires_at ? new Date(b.expires_at) : null,
    verified: false,
  })
  res.status(201).json({ document })
}
