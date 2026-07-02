import { MedusaService } from "@medusajs/framework/utils"
import { NurseryProductAttribute } from "./models"
import {
  profitPerSqFt,
  rankByAnnualProfitPerSqFt,
  type ProfitPerSqFtInput,
} from "./analytics/profit-per-sqft"

/**
 * Nursery Vertical service.
 *
 * Owns per-product nursery attributes and exposes the profit-per-sqft
 * decision-support calculator. Both are usable with NO quest enrolled — this
 * module is independently adoptable and carries no quest dependency.
 */
class NurseryVerticalModuleService extends MedusaService({
  NurseryProductAttribute,
}) {
  async getAttributeForProduct(productId: string) {
    const [attr] = await this.listNurseryProductAttributes({ product_id: productId })
    return attr ?? null
  }

  /** A vendor's nursery listing attributes (seller-scoped). */
  async listForSeller(sellerId: string) {
    return this.listNurseryProductAttributes({ seller_id: sellerId })
  }

  /**
   * Create or update the nursery attribute for a product (1:1). Upsert keyed by
   * product_id; always stamped with the owning seller_id so listing management
   * stays vendor-scoped.
   */
  async upsertForProduct(
    sellerId: string,
    productId: string,
    data: Record<string, unknown>
  ) {
    const existing = await this.getAttributeForProduct(productId)
    if (existing) {
      await this.updateNurseryProductAttributes({ id: existing.id, ...data })
      return this.retrieveNurseryProductAttribute(existing.id)
    }
    return this.createNurseryProductAttributes({
      seller_id: sellerId,
      product_id: productId,
      ...data,
    })
  }

  /** Profit-per-sqft for a single input (decision-support only). */
  computeProfitPerSqFt(input: ProfitPerSqFtInput) {
    return profitPerSqFt(input)
  }

  /** Ranked profit-per-sqft table, highest AnnualProfit/SqFt first. */
  rankProfitPerSqFt(inputs: ProfitPerSqFtInput[]) {
    return rankByAnnualProfitPerSqFt(inputs)
  }
}

export default NurseryVerticalModuleService
