import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * Shape returned for each active pathway. Adds the denormalized display counts
 * (`formula_count` / `active_run_count`) the portal's Pathways page cards read;
 * those live in separate modules not built here, so they default to 0.
 */
function toPathwayView(p: Record<string, unknown>) {
  return { ...p, formula_count: 0, active_run_count: 0 }
}

/**
 * GET /vendor/botanical/pathways
 * This maker's active production pathways. Returns `{ pathways }` to match the
 * botanical-portal `useActivePathways` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const pathways = await service.listActivePathwaysForMaker(makerId)
  res.json({ pathways: pathways.map(toPathwayView) })
}

interface ActivateBody {
  template_id?: string
  name?: string
  batch_number_prefix?: string
  default_cure_time_days?: number
  counts_toward_cottage_food_limit?: boolean
}

/**
 * POST /vendor/botanical/pathways
 * Activate a pathway for this maker from a built-in template.
 */
export const POST = async (
  req: MedusaRequest<ActivateBody>,
  res: MedusaResponse
) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? {}
  if (!b.template_id || typeof b.template_id !== "string") {
    return res.status(400).json({ message: "template_id is required" })
  }

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)

  if (!service.getTemplate(b.template_id)) {
    return res
      .status(400)
      .json({ message: `Unknown pathway template: ${b.template_id}` })
  }

  const pathway = await service.activatePathwayFromTemplate(makerId, {
    template_id: b.template_id,
    name: b.name,
    batch_number_prefix: b.batch_number_prefix,
    default_cure_time_days: b.default_cure_time_days,
    counts_toward_cottage_food_limit: b.counts_toward_cottage_food_limit,
  })

  res.status(201).json({ pathway: toPathwayView(pathway as Record<string, unknown>) })
}
