import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"

/** Statuses that count as "active" for the pathway-card run counter. */
const ACTIVE_RUN_STATUSES = ["planned", "in_progress", "curing", "testing"]

/**
 * GET /vendor/botanical/pathways
 * This maker's active production pathways, with the denormalized
 * `formula_count` / `active_run_count` the Pathways page cards display.
 * Returns `{ pathways }` to match the `useActivePathways` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const [pathways, formulas, runs] = await Promise.all([
    service.listActivePathwaysForMaker(makerId),
    service.listFormulasForMaker(makerId),
    service.listRunsForMaker(makerId),
  ])

  const formulaCounts = new Map<string, number>()
  for (const f of formulas) {
    formulaCounts.set(f.pathway_id, (formulaCounts.get(f.pathway_id) ?? 0) + 1)
  }
  const runCounts = new Map<string, number>()
  for (const r of runs) {
    if (!ACTIVE_RUN_STATUSES.includes(r.status)) continue
    runCounts.set(r.pathway_id, (runCounts.get(r.pathway_id) ?? 0) + 1)
  }

  res.json({
    pathways: pathways.map((p) => ({
      ...p,
      formula_count: formulaCounts.get(p.id) ?? 0,
      active_run_count: runCounts.get(p.id) ?? 0,
    })),
  })
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

  // A just-activated pathway has no formulas or runs yet.
  res.status(201).json({ pathway: { ...pathway, formula_count: 0, active_run_count: 0 } })
}
