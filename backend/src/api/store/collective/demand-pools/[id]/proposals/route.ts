import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/proposals")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"
import { publicSupplierProposalView } from "../../../../../../modules/demand-pool/public-view"
import { poolNotFound, resolvePoolReader } from "../_pool-readers"

// GET /store/collective/demand-pools/:id/proposals
//
// The creator reads each supplier's proposal whole; anyone else the terms it
// offers, without the supplier, its notes or its payment terms, and only on
// a pool they may list (`../_pool-readers.ts`). No one on the store side is
// on a proposal: its supplier is a seller, who reads it at /vendor.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const reader = await resolvePoolReader(req, res)
    if (!reader) return
    if (!reader.listed) return poolNotFound(res)

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const proposals = await demandPoolService.listSupplierProposals({
      demand_post_id: id,
    })

    res.json({
      proposals: reader.creator ? proposals : proposals.map((proposal) => publicSupplierProposalView(proposal)),
    })
  } catch (error: any) {
    log.error(`[GET /store/collective/demand-pools/${id}/proposals] Error:`, error.message)
    res.status(500).json({ error: "Failed to retrieve proposals" })
  }
}
