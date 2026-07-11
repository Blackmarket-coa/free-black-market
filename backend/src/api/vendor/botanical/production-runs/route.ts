import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/botanical/production-runs
 * This maker's production runs, soonest planned date first. Returns `{ runs }`
 * to match the botanical-portal `useProductionRuns` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const runs = await service.listRunsForMaker(makerId)
  res.json({ runs })
}
