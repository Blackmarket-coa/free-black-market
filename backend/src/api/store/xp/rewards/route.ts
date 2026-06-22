import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/xp/rewards")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PROGRESSION_MODULE } from "../../../../modules/progression"
import type ProgressionModuleService from "../../../../modules/progression/service"

/**
 * GET /store/xp/rewards
 *
 * Returns the authenticated customer's spendable-XP balance, the redeemable
 * reward catalog (annotated with affordability), and their redemption history.
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
    const balance = await progression.getSpendableXp(customerId)
    const rewards = progression.listRewards(balance)
    const history = await progression.listRedemptionsForCustomer(customerId)
    res.json({ balance, rewards, history })
  } catch (error) {
    log.error("Error listing XP rewards:", error)
    res.status(500).json({ error: "Failed to list XP rewards" })
  }
}
