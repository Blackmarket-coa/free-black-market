import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DOCUMENT_VAULT_MODULE } from "../../../modules/document-vault"
import type DocumentVaultModuleService from "../../../modules/document-vault/service"
import { VaultDocumentType } from "../../../modules/document-vault/models/vault-document"
import { getSellerId } from "../quests/_helpers"

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
  const document = await service.createVaultDocuments({
    seller_id: sellerId,
    doc_type: (b.doc_type ?? "other") as VaultDocumentType,
    label: b.label,
    file_id: b.file_id ?? null,
    issued_at: b.issued_at ? new Date(b.issued_at) : null,
    expires_at: b.expires_at ? new Date(b.expires_at) : null,
    verified: false,
  })
  res.status(201).json({ document })
}
