import { MedusaService } from "@medusajs/framework/utils"
import { VaultDocument } from "./models"

/**
 * Document Vault service.
 *
 * Owns only vendor-uploaded document records (opt-in substrate). Generated CRUD
 * from MedusaService is sufficient for most operations; the helpers below keep
 * seller-scoping and the "never fabricate verification" rule in one place.
 */
class DocumentVaultModuleService extends MedusaService({
  VaultDocument,
}) {
  /** All of a vendor's documents (seller-scoped; never cross-vendor). */
  async listForSeller(sellerId: string) {
    return this.listVaultDocuments({ seller_id: sellerId })
  }

  /**
   * Mark a document verified. Verification reflects a real human/admin check —
   * callers must have performed one. We stamp `verified_at` for the audit trail.
   */
  async markVerified(id: string, verifiedAt: Date) {
    await this.updateVaultDocuments({ id, verified: true, verified_at: verifiedAt })
    return this.retrieveVaultDocument(id)
  }
}

export default DocumentVaultModuleService
