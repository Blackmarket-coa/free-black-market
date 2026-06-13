import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/character/recompute")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../../../../modules/progression"
import type ProgressionModuleService from "../../../../modules/progression/service"

/**
 * POST /store/character/recompute
 *
 * Recomputes the authenticated customer's aggregate-stat snapshot from the
 * source-of-truth modules (impact-metrics, volunteer, hawala-ledger, …).
 * Optional body: { seller_id } to also mirror producer-side stats.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { seller_id } = (req.body as { seller_id?: string }) ?? {}

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const progression = req.scope.resolve<ProgressionModuleService>(
    PROGRESSION_MODULE
  )

  try {
    await progression.recomputeAggregates(customerId, query as never, seller_id)
    const character = await progression.getCharacterSheetSummary(customerId)
    res.json({ character })
  } catch (error) {
    log.error("Error recomputing character sheet:", error)
    res.status(500).json({ error: "Failed to recompute character sheet" })
  }
}
