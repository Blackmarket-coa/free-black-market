import { createLogger } from "../../../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/bounties/[bountyId]/claim")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../../../modules/demand-pool/service"

// POST /store/collective/demand-pools/:id/bounties/:bountyId/claim
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id, bountyId } = req.params

  try {
    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const bounty = await demandPoolService.claimBounty(
      bountyId,
      actorId,
      "CUSTOMER"
    )

    res.status(200).json({ bounty })
  } catch (error: any) {
    log.error(
      `[POST /store/collective/demand-pools/${id}/bounties/${bountyId}/claim] Error:`,
      error.message
    )
    res.status(400).json({ error: error.message })
  }
}
