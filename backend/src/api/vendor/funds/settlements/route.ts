import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FUND_ACCOUNTING_MODULE } from "../../../../modules/fund-accounting"
import type FundAccountingModuleService from "../../../../modules/fund-accounting/service"
import { settlementHeadroomCents } from "../../../../modules/fund-accounting/fund-math"
import { getSellerId } from "../../quests/_helpers"
import { listSellerSettlements } from "../_settlements"

/**
 * GET /vendor/funds/settlements — the settlements an expenditure may cite.
 *
 * Each row carries what the settlement moved, what this seller has already
 * attributed to it across every fund, and what is left — so a picker can show
 * "$200.00 · $10.00 attributed · $190.00 available" rather than a bare id.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const settlements = await listSellerSettlements(req)

  const funds = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )
  // Fund rows are keyed by the route's seller id, the hawala rows by the
  // resolved sel_* — each side is looked up under the key it was written with.
  const cited = await funds.getCitedCentsBySettlement(
    sellerId,
    settlements.map((s) => s.id)
  )

  res.json({
    settlements: settlements.map((s) => ({
      ...s,
      cited_cents: cited[s.id] ?? 0,
      available_cents: settlementHeadroomCents(s.amount_cents, cited[s.id] ?? 0),
    })),
    count: settlements.length,
  })
}
