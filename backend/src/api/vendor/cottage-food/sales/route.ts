import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE } from "../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../modules/cottage-food/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/cottage-food/sales
 * The seller's compliance ledger, newest first.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const offset = Math.max(Number(req.query.offset) || 0, 0)

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const entries = await service.listSalesForSeller(sellerId, limit, offset)

  res.json({ entries, limit, offset })
}

interface ManualSaleBody {
  amount_cents?: number
  meal_count?: number
  occurred_at?: string
  counts_toward_annual?: boolean
  counts_toward_meals?: boolean
  note?: string
}

/**
 * POST /vendor/cottage-food/sales
 * Record an off-platform sale by hand.
 *
 * This exists because a home producer's farmers-market and cash sales count
 * toward the same cap their online orders do. A meter fed only by platform
 * orders would understate the number the seller is actually judged against,
 * and an understated compliance meter is worse than no meter — it invites
 * someone to sail past a limit believing they have room.
 *
 * `occurred_at` is accepted so weekend markets can be backfilled into the
 * period they belong to.
 */
export const POST = async (
  req: MedusaRequest<ManualSaleBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = req.body ?? {}
  const amount = Number(body.amount_cents ?? 0)
  const meals = Number(body.meal_count ?? 0)

  if (!Number.isFinite(amount) || !Number.isFinite(meals)) {
    return res
      .status(400)
      .json({ message: "amount_cents and meal_count must be numbers" })
  }
  if (amount === 0 && meals === 0) {
    return res
      .status(400)
      .json({ message: "Record an amount, a meal count, or both" })
  }

  let occurredAt = new Date()
  if (body.occurred_at) {
    const parsed = new Date(body.occurred_at)
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ message: "occurred_at is not a valid date" })
    }
    occurredAt = parsed
  }

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const entry = await service.recordSale({
    seller_id: sellerId,
    source: "manual",
    occurred_at: occurredAt,
    amount_cents: Math.trunc(amount),
    meal_count: Math.trunc(meals),
    counts_toward_annual: body.counts_toward_annual ?? true,
    counts_toward_meals: body.counts_toward_meals ?? true,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null,
  })

  res.status(201).json({ entry })
}
