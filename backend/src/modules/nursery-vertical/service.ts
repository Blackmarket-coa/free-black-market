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
