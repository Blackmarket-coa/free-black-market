import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getSellerId } from "../../../quests/_helpers"

/**
 * GET /vendor/plant-nursery/payouts/current-period
 * The vendor's payouts view model. Money figures live in the hawala ledger /
 * order system and KARMA lives in the `progression` module — neither is
 * aggregated into this vertical yet, so this returns the honest baseline
 * (seedling tier, 70% split — the canonical ladder floor from
 * `@bmc/portal-kit` TIERS, mirrored by the progression module's seed) with
 * zeroed money fields rather than fabricated numbers. Wiring the ledger and
 * progression aggregations in replaces the zeros without changing this shape.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  // First payment date of next month (payouts run monthly on the 5th).
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 5)

  res.json({
    current_period: {
      units_sold: 0,
      gross_cents: 0,
      split_pct: 70,
      net_cents: 0,
      next_payment_date: next.toISOString().slice(0, 10),
    },
    tier: "seedling",
    karma_total: 0,
    karma_events: [],
    history: [],
    split_breakdown: [],
    earnings_ytd_cents: 0,
    w9_required: false,
  })
}
