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
   * Total known bytes a seller has stored.
   *
   * Sums only documents whose size was actually measured. A document with an
   * unknown size contributes **zero**, which understates the true figure — and
   * that is the correct direction to be wrong in. Guessing a size upward would
   * push a seller over a quota on the strength of a number nobody measured;
   * understating means the cap is occasionally more generous than intended,
   * which costs storage rather than costing a vendor an upload they paid for.
   */
  async storageBytesForSeller(sellerId: string): Promise<number> {
    const documents = (await this.listVaultDocuments({
      seller_id: sellerId,
    })) as unknown as { bytes_stored: number | string | null }[]

    return documents.reduce((total, doc) => {
      // BIGINT comes back as a string from some drivers — coerce rather than
      // concatenating it onto the running total.
      const bytes = Number(doc.bytes_stored ?? 0)
      return Number.isFinite(bytes) && bytes > 0 ? total + bytes : total
    }, 0)
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
