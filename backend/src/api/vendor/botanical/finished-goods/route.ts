import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/botanical/finished-goods
 * This maker's finished sellable stock, freshest first. Returns
 * `{ finished_goods }` to match the botanical-portal `useFinishedGoods` hook
 * contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const finished_goods = await service.listFinishedGoodsForMaker(makerId)
  res.json({ finished_goods })
}
