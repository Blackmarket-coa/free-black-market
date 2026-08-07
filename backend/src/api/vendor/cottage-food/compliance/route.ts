import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE } from "../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../modules/cottage-food/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/cottage-food/compliance
 *
 * The compliance snapshot behind the vendor dashboard: annual revenue against
 * the cap the seller declared, meals recorded today and this week against
 * their declared meal limits, permit and food-handler expiry, and
 * plain-language advisories.
 *
 * Meters whose limit the seller hasn't declared come back with `cap: null` and
 * are meant to render as nothing at all — an undeclared cap is not a cap of
 * zero.
 *
 * This endpoint reports; it does not adjudicate. There is no field in the
 * response that any caller should treat as permission to sell or not sell.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const snapshot = await service.getComplianceSnapshot(sellerId)

  res.json(snapshot)
}
