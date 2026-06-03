import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"
import type CooperativeService from "../../../../../modules/cooperative/service"
import { DEMAND_POOL_MODULE } from "../../../../../modules/demand-pool"
import type DemandPoolModuleService from "../../../../../modules/demand-pool/service"
import {
  DemandPostStatus,
} from "../../../../../modules/demand-pool/models/demand-post"

/**
 * GET /store/cooperatives/:handle/needs
 * Coalition needs board — the open demand-posts (needs) raised under a
 * coalition. The product/transaction stays in FBM; this just lists the needs.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { handle } = req.params
  const cooperativeService =
    req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)
  const demand = req.scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

  const coops = await cooperativeService.listCooperatives({ handle })
  const coop = coops[0]
  if (!coop) {
    return res.status(404).json({ message: "Cooperative not found" })
  }

  const needs = await demand.listDemandPosts({
    cooperative_id: coop.id,
    status: [
      DemandPostStatus.OPEN,
      DemandPostStatus.THRESHOLD_MET,
      DemandPostStatus.NEGOTIATING,
    ],
  })

  return res.status(200).json({
    cooperative: { id: coop.id, handle: coop.handle, name: coop.name },
    needs: needs.map((n: any) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      category: n.category,
      status: n.status,
      product_id: n.product_id,
      target_quantity: n.target_quantity,
      committed_quantity: n.committed_quantity,
      total_bounty_amount: Number(n.total_bounty_amount),
    })),
    count: needs.length,
  })
}
