import { MedusaService } from "@medusajs/framework/utils"
import { ProductionCostEntry } from "./models"
import { CostCategory, CostSource } from "./models/production-cost-entry"
import {
  lineAmountCents,
  marginPercentAtPrice,
  priceAtMarginCents,
  resolveIsCashOutlay,
  rollupCosts,
  unitCostCents,
  type CostRollup,
} from "./costing"

/** Margins a vendor is offered as a starting point on the costing view. */
export const DEFAULT_TARGET_MARGINS = [20, 30, 40, 50] as const

export interface RecordCostInput {
  seller_id: string
  production_batch_id: string
  category: CostCategory
  label: string
  source?: CostSource
  quantity?: number
  unit_amount_cents?: number
  /** Wins over quantity x unit_amount_cents when supplied. */
  amount_cents?: number
  currency_code?: string
  is_cash_outlay?: boolean
  incurred_at?: Date | string | null
  reference_type?: string | null
  reference_id?: string | null
  notes?: string | null
  metadata?: Record<string, unknown> | null
}

export interface BatchCosting extends CostRollup {
  production_batch_id: string
  currency_code: string
  yield_qty: number | null
  /** Full economic cost per sellable unit; null until yield is reported. */
  unit_cost_cents: number | null
  /** Cash-only cost per unit — what the seller must recover to break even. */
  unit_cash_cost_cents: number | null
  /** Suggested prices at DEFAULT_TARGET_MARGINS, from the full unit cost. */
  suggested_prices: Array<{ margin_percent: number; price_cents: number }>
}

/**
 * Production Costing service.
 *
 * Owns COGS for production batches — the figure a producer needs to price
 * sustainably, which the production ledger deliberately leaves out. It never
 * resolves the production-ledger service itself: `yield_qty` is passed in by the
 * caller, so the two modules stay independently adoptable and a vendor can run
 * the ledger with no costing (or costing against yields sourced elsewhere).
 */
class ProductionCostingModuleService extends MedusaService({
  ProductionCostEntry,
}) {
  /** Records one costed line, deriving the amount and cash flag when omitted. */
  async recordCost(input: RecordCostInput) {
    const source = input.source ?? CostSource.PURCHASED
    const amount_cents =
      input.amount_cents !== undefined
        ? Math.round(input.amount_cents)
        : lineAmountCents(input.quantity ?? 1, input.unit_amount_cents ?? 0)

    return this.createProductionCostEntries({
      seller_id: input.seller_id,
      production_batch_id: input.production_batch_id,
      category: input.category,
      source,
      label: input.label,
      quantity: input.quantity ?? 1,
      unit_amount_cents: Math.round(input.unit_amount_cents ?? 0),
      amount_cents,
      currency_code: input.currency_code ?? "usd",
      is_cash_outlay: resolveIsCashOutlay(source, input.is_cash_outlay),
      incurred_at: input.incurred_at ? new Date(input.incurred_at) : null,
      reference_type: input.reference_type ?? null,
      reference_id: input.reference_id ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? null,
    })
  }

  async listForBatch(sellerId: string, productionBatchId: string) {
    return this.listProductionCostEntries({
      seller_id: sellerId,
      production_batch_id: productionBatchId,
    })
  }

  async listForSeller(sellerId: string) {
    return this.listProductionCostEntries({ seller_id: sellerId })
  }

  /**
   * Full costing for one batch. `yieldQty` comes from the caller (normally the
   * production ledger's `yield_qty`); pass null when it is not yet known and the
   * per-unit figures come back null rather than guessed.
   */
  async getBatchCosting(
    sellerId: string,
    productionBatchId: string,
    yieldQty: number | null
  ): Promise<BatchCosting> {
    const entries = await this.listForBatch(sellerId, productionBatchId)
    const rollup = rollupCosts(entries)

    const unit_cost_cents = unitCostCents(rollup.total_cents, yieldQty)
    const unit_cash_cost_cents = unitCostCents(rollup.cash_outlay_cents, yieldQty)

    const suggested_prices =
      unit_cost_cents === null
        ? []
        : DEFAULT_TARGET_MARGINS.flatMap((margin_percent) => {
            const price_cents = priceAtMarginCents(unit_cost_cents, margin_percent)
            return price_cents === null ? [] : [{ margin_percent, price_cents }]
          })

    return {
      ...rollup,
      production_batch_id: productionBatchId,
      currency_code: entries[0]?.currency_code ?? "usd",
      yield_qty: yieldQty,
      unit_cost_cents,
      unit_cash_cost_cents,
      suggested_prices,
    }
  }

  /**
   * Margin a given sale price would realize against a batch's unit cost. Null
   * when the batch has no yield reported or the price is not positive.
   */
  async getMarginAtPrice(
    sellerId: string,
    productionBatchId: string,
    yieldQty: number | null,
    priceCents: number
  ): Promise<number | null> {
    const costing = await this.getBatchCosting(sellerId, productionBatchId, yieldQty)
    if (costing.unit_cost_cents === null) return null
    return marginPercentAtPrice(costing.unit_cost_cents, priceCents)
  }
}

export default ProductionCostingModuleService
