import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCTION_COSTING_MODULE } from "../../../../modules/production-costing"
import type ProductionCostingModuleService from "../../../../modules/production-costing/service"
import { marginPercentAtPrice } from "../../../../modules/production-costing/costing"
import { getSellerId } from "../../quests/_helpers"
import { resolveOwnedBatch } from "../_helpers"

/**
 * GET /vendor/production-costs/rollup?production_batch_id=...[&price_cents=]
 *
 * The costing view for one batch: totals by category, the cash/in-kind split,
 * unit cost, and suggested prices. Pass `price_cents` to also get the margin a
 * given sale price would realize.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const batchId = req.query.production_batch_id
  if (typeof batchId !== "string" || !batchId) {
    return res
      .status(400)
      .json({ message: "production_batch_id is required" })
  }

  const batch = await resolveOwnedBatch(req, sellerId, batchId)
  if (!batch) return res.status(404).json({ message: "Production batch not found" })

  const service = req.scope.resolve<ProductionCostingModuleService>(
    PRODUCTION_COSTING_MODULE
  )
  const costing = await service.getBatchCosting(sellerId, batch.id, batch.yield_qty)

  // Optional "what would this price earn me?" check, evaluated against the
  // full unit cost (donated inputs included) rather than the cash-only figure.
  let margin_percent_at_price: number | null = null
  const priceRaw = req.query.price_cents
  if (typeof priceRaw === "string" && priceRaw !== "") {
    const priceCents = Number(priceRaw)
    if (!Number.isFinite(priceCents)) {
      return res
        .status(400)
        .json({ message: "price_cents must be a number" })
    }
    margin_percent_at_price =
      costing.unit_cost_cents === null
        ? null
        : marginPercentAtPrice(costing.unit_cost_cents, priceCents)
  }

  res.json({ costing: { ...costing, margin_percent_at_price } })
}
