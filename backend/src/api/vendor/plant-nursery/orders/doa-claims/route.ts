import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../../quests/_helpers"

/**
 * GET /vendor/plant-nursery/orders/doa-claims
 * This vendor's dead-on-arrival claims, newest first. Returns a bare array to
 * match the nursery-portal `useOrders` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const claims = await service.listDoaClaimsForSeller(sellerId)
  res.json(claims)
}
