import { MedusaService } from "@medusajs/framework/utils"
import {
  NurseryProductAttribute,
  PropagationBatch,
  StratificationRecord,
  MotherPlant,
  DoaClaim,
  PROPAGATION_METHODS,
  type PropagationMethod,
} from "./models"
import {
  profitPerSqFt,
  rankByAnnualProfitPerSqFt,
  type ProfitPerSqFtInput,
} from "./analytics/profit-per-sqft"

/** Default weeks-to-saleable when a species has no reference estimate. */
const DEFAULT_WEEKS_TO_SALEABLE = 16

export interface CreatePropagationBatchInput {
  species_name: string
  method: PropagationMethod
  qty_started: number
  /** ISO date; when omitted an estimate of +16 weeks is used. */
  expected_ready_at?: string
  pot_size?: string
  is_rare_species?: boolean
  hub_requested?: boolean
  notes?: string
}

/**
 * Nursery Vertical service.
 *
 * Owns per-product nursery attributes, propagation batches + stratification
 * records, and exposes the profit-per-sqft decision-support calculator. All are
 * usable with NO quest enrolled — this module is independently adoptable and
 * carries no quest dependency.
 */
class NurseryVerticalModuleService extends MedusaService({
  NurseryProductAttribute,
  PropagationBatch,
  StratificationRecord,
  MotherPlant,
  DoaClaim,
}) {
  /** A vendor's mother plants, alphabetical by species. */
  async listMotherPlantsForSeller(sellerId: string) {
    return this.listMotherPlants(
      { seller_id: sellerId },
      { order: { species_name: "ASC" } }
    )
  }

  /** A vendor's DOA claims, newest first. */
  async listDoaClaimsForSeller(sellerId: string) {
    return this.listDoaClaims(
      { seller_id: sellerId },
      { order: { opened_at: "DESC" } }
    )
  }

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

  /** A vendor's propagation batches, newest first. */
  async listBatchesForSeller(sellerId: string) {
    return this.listPropagationBatches(
      { seller_id: sellerId },
      { order: { started_at: "DESC" } }
    )
  }

  /**
   * Start a new propagation batch for a vendor. `expected_ready_at` is taken
   * from the caller (the portal estimates it from species reference data) and
   * falls back to +16 weeks so the field is always populated.
   */
  async startBatch(sellerId: string, input: CreatePropagationBatchInput) {
    const method: PropagationMethod = PROPAGATION_METHODS.includes(input.method)
      ? input.method
      : "cutting"

    const startedAt = new Date()
    const expectedReadyAt = input.expected_ready_at
      ? new Date(input.expected_ready_at)
      : new Date(
          startedAt.getTime() +
            DEFAULT_WEEKS_TO_SALEABLE * 7 * 24 * 60 * 60 * 1000
        )

    return this.createPropagationBatches({
      seller_id: sellerId,
      species_name: input.species_name,
      method,
      status: "started",
      qty_started: input.qty_started,
      qty_successful: 0,
      started_at: startedAt,
      expected_ready_at: expectedReadyAt,
      pot_size: input.pot_size ?? null,
      is_rare_species: input.is_rare_species ?? false,
      hub_requested: input.hub_requested ?? false,
      notes: input.notes ?? null,
    })
  }

  /** A vendor's stratification records, ending soonest first. */
  async listStratificationForSeller(sellerId: string) {
    return this.listStratificationRecords(
      { seller_id: sellerId },
      { order: { end_at: "ASC" } }
    )
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
