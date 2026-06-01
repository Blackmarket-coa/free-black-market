import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PROGRESSION_MODULE } from "../../../modules/progression"
import type ProgressionModuleService from "../../../modules/progression/service"

/**
 * GET /store/character
 *
 * Returns the authenticated customer's character sheet summary (role tracks,
 * levels, aggregate stats, earned titles). Creates an empty sheet on first read.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const progression = req.scope.resolve<ProgressionModuleService>(
    PROGRESSION_MODULE
  )

  try {
    const character = await progression.getCharacterSheetSummary(customerId)
    res.json({ character })
  } catch (error) {
    console.error("Error retrieving character sheet:", error)
    res.status(500).json({ error: "Failed to retrieve character sheet" })
  }
}
