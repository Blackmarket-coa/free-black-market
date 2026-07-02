import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DOCUMENT_VAULT_MODULE } from "../../../../modules/document-vault"
import type DocumentVaultModuleService from "../../../../modules/document-vault/service"
import { getSellerId } from "../../quests/_helpers"

/** DELETE /vendor/vault/:id — remove a vault document (seller-scoped). */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<DocumentVaultModuleService>(DOCUMENT_VAULT_MODULE)
  const doc = await service.retrieveVaultDocument(req.params.id)
  if (doc.seller_id !== sellerId) return res.status(404).json({ message: "Not found" })

  await service.deleteVaultDocuments(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
