import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AID_NETWORK_MODULE } from "../../../../modules/aid-network"
import type AidNetworkModuleService from "../../../../modules/aid-network/service"
import { getSellerId } from "../../quests/_helpers"
import { parseDemands } from "../_helpers"

/**
 * GET /vendor/aid-network/surplus?within_days=3[&demands=<json>]
 *
 * Stock that will spoil soon and is not already spoken for — the input to
 * rescue and redistribution routing. Pass `demands` to net off what is already
 * committed, so the list is genuinely surplus rather than everything on hand.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const rawDays = req.query.within_days
  let withinDays = 3
  if (typeof rawDays === "string" && rawDays !== "") {
    withinDays = Number(rawDays)
    if (!Number.isFinite(withinDays) || withinDays < 0) {
      return res
        .status(400)
        .json({ message: "within_days must be a non-negative number" })
    }
  }

  const parsed = parseDemands(req.query.demands)
  if ("error" in parsed) return res.status(400).json({ message: parsed.error })

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)
  const surplus = await service.findSurplusToRedistribute(
    sellerId,
    parsed.demands,
    withinDays
  )

  res.json({ surplus, count: surplus.length, within_days: withinDays })
}
