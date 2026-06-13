import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/proposals")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"

// GET /store/collective/demand-pools/:id/proposals
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const proposals = await demandPoolService.listSupplierProposals({
      demand_post_id: id,
    })

    res.json({ proposals })
  } catch (error: any) {
    log.error(`[GET /store/collective/demand-pools/${id}/proposals] Error:`, error.message)
    res.status(500).json({ error: "Failed to retrieve proposals" })
  }
}
