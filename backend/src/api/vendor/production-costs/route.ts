import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCTION_COSTING_MODULE } from "../../../modules/production-costing"
import type ProductionCostingModuleService from "../../../modules/production-costing/service"
import {
  CostCategory,
  CostSource,
} from "../../../modules/production-costing/models/production-cost-entry"
import { getSellerId } from "../quests/_helpers"
import { resolveOwnedBatch } from "./_helpers"

const CATEGORIES = new Set<string>(Object.values(CostCategory))
const SOURCES = new Set<string>(Object.values(CostSource))

/**
 * GET /vendor/production-costs — a vendor's cost entries.
 * Pass `?production_batch_id=` to scope to one batch.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<ProductionCostingModuleService>(
    PRODUCTION_COSTING_MODULE
  )

  const batchId = req.query.production_batch_id
  const production_cost_entries =
    typeof batchId === "string" && batchId
      ? await service.listForBatch(sellerId, batchId)
      : await service.listForSeller(sellerId)

  res.json({
    production_cost_entries,
    count: production_cost_entries.length,
  })
}

interface CreateCostBody {
  production_batch_id: string
  category: string
  label: string
  source?: string
  quantity?: number
  unit_amount_cents?: number
  amount_cents?: number
  currency_code?: string
  is_cash_outlay?: boolean
  incurred_at?: string
  reference_type?: string
  reference_id?: string
  notes?: string
  metadata?: Record<string, unknown>
}

/** POST /vendor/production-costs — record a cost line against a batch. */
export const POST = async (
  req: MedusaRequest<CreateCostBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateCostBody)

  if (!b.production_batch_id) {
    return res.status(400).json({ message: "production_batch_id is required" })
  }
  if (!b.label) {
    return res.status(400).json({ message: "label is required" })
  }
  if (!b.category || !CATEGORIES.has(b.category)) {
    return res.status(400).json({
      message: `category must be one of: ${[...CATEGORIES].join(", ")}`,
    })
  }
  if (b.source !== undefined && !SOURCES.has(b.source)) {
    return res.status(400).json({
      message: `source must be one of: ${[...SOURCES].join(", ")}`,
    })
  }
  if (b.amount_cents === undefined && b.unit_amount_cents === undefined) {
    return res
      .status(400)
      .json({ message: "amount_cents or unit_amount_cents is required" })
  }
  for (const field of ["amount_cents", "unit_amount_cents", "quantity"] as const) {
    const value = b[field]
    if (value === undefined) continue
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return res
        .status(400)
        .json({ message: `${field} must be a non-negative number` })
    }
  }

  // Ownership is enforced here: a seller may only cost their own batches.
  const batch = await resolveOwnedBatch(req, sellerId, b.production_batch_id)
  if (!batch) return res.status(404).json({ message: "Production batch not found" })

  const service = req.scope.resolve<ProductionCostingModuleService>(
    PRODUCTION_COSTING_MODULE
  )
  const production_cost_entry = await service.recordCost({
    seller_id: sellerId,
    production_batch_id: batch.id,
    category: b.category as CostCategory,
    label: b.label,
    source: b.source as CostSource | undefined,
    quantity: b.quantity,
    unit_amount_cents: b.unit_amount_cents,
    amount_cents: b.amount_cents,
    currency_code: b.currency_code,
    is_cash_outlay: b.is_cash_outlay,
    incurred_at: b.incurred_at ?? null,
    reference_type: b.reference_type ?? null,
    reference_id: b.reference_id ?? null,
    notes: b.notes ?? null,
    metadata: b.metadata ?? null,
  })

  res.status(201).json({ production_cost_entry })
}
