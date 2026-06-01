import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PROGRESSION_MODULE } from "../../../../modules/progression"
import { isStance } from "../../../../modules/progression/stance"
import type ProgressionModuleService from "../../../../modules/progression/service"

/**
 * POST /store/character/stance
 *
 * Sets the authenticated customer's active stance (the role they're currently
 * "playing"). Body: { stance: "producer" | "consumer" | "investor" |
 * "coalition" | "creator" }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { stance } = (req.body as { stance?: string }) ?? {}
  if (!isStance(stance)) {
    return res.status(400).json({ error: "Invalid stance" })
  }

  const progression = req.scope.resolve<ProgressionModuleService>(
    PROGRESSION_MODULE
  )

  try {
    await progression.setStance(customerId, stance)
    const character = await progression.getCharacterSheetSummary(customerId)
    res.json({ character })
  } catch (error) {
    console.error("Error setting stance:", error)
    res.status(500).json({ error: "Failed to set stance" })
  }
}
