import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCTION_LEDGER_MODULE } from "../../../modules/production-ledger"
import type ProductionLedgerModuleService from "../../../modules/production-ledger/service"
import { getSellerId } from "../quests/_helpers"

/** GET /vendor/production-batches — a vendor's production ledger (opt-in). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<ProductionLedgerModuleService>(PRODUCTION_LEDGER_MODULE)
  const production_batches = await service.listForSeller(sellerId)
  res.json({ production_batches, count: production_batches.length })
}

interface CreateBatchBody {
  item_label: string
  method?: string
  start_date?: string
  qty_started?: number
  source?: "own" | "foraged" | "swap" | "purchased"
  controlled_environment?: boolean
  yield_qty?: number
  product_variant_id?: string
  harvest_batch_id?: string
  attributes?: Record<string, unknown>
}

/** POST /vendor/production-batches — record a production batch. */
export const POST = async (
  req: MedusaRequest<CreateBatchBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateBatchBody)
  if (!b.item_label) return res.status(400).json({ message: "item_label is required" })

  const service = req.scope.resolve<ProductionLedgerModuleService>(PRODUCTION_LEDGER_MODULE)
  const production_batch = await service.createProductionBatches({
    seller_id: sellerId,
    item_label: b.item_label,
    method: b.method ?? null,
    start_date: b.start_date ? new Date(b.start_date) : null,
    qty_started: b.qty_started ?? 0,
    source: (b.source ?? "own") as any,
    controlled_environment: b.controlled_environment ?? false,
    yield_qty: b.yield_qty ?? null,
    product_variant_id: b.product_variant_id ?? null,
    harvest_batch_id: b.harvest_batch_id ?? null,
    attributes: b.attributes ?? null,
  })
  res.status(201).json({ production_batch })
}
