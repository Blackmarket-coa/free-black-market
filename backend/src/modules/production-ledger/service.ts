import { MedusaService } from "@medusajs/framework/utils"
import { ProductionBatch } from "./models"

/**
 * Production Ledger service.
 *
 * Owns generic production-event records. Beyond the generated CRUD, it exposes a
 * seller-scoped summary quests use for the "production/yield" (🟡 assisted)
 * requirement. All figures are counts of real batches — nothing here touches
 * money (that stays in the hawala ledger).
 */
class ProductionLedgerModuleService extends MedusaService({
  ProductionBatch,
}) {
  async listForSeller(sellerId: string) {
    return this.listProductionBatches({ seller_id: sellerId })
  }

  /**
   * Aggregate production summary for a vendor: total started, total realized
   * yield, and distinct methods used. Returns null-ish zeros for a vendor with
   * no batches (so callers can treat "no production ledger" as an absent
   * domain field rather than an error).
   */
  async getProductionSummary(sellerId: string) {
    const batches = await this.listProductionBatches({ seller_id: sellerId })

    const total_started = batches.reduce((s, b) => s + Number(b.qty_started ?? 0), 0)
    const total_yield = batches.reduce((s, b) => s + Number(b.yield_qty ?? 0), 0)
    const methods = [...new Set(batches.map((b) => b.method).filter(Boolean) as string[])]

    return {
      batch_count: batches.length,
      total_started,
      total_yield,
      methods,
      batches,
    }
  }
}

export default ProductionLedgerModuleService
