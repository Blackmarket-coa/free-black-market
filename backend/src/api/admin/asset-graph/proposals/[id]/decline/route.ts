import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../../modules/asset-graph/service"
import { InvalidTransitionError } from "../../../../../../modules/asset-graph/instance-lifecycle"

/**
 * POST /admin/asset-graph/proposals/:id/decline
 *
 * Marks the proposal declined. Returns the updated row.
 * 409 when the proposal isn't pending.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = req.params.id
  if (!id) return res.status(400).json({ message: "id is required" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  try {
    const proposal = await (service as AssetGraphService).declineProposal({
      proposal_id: id,
    })
    return res.json({ proposal })
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({
        message: err.message,
        from: err.from,
        action: err.action,
      })
    }
    const message = err instanceof Error ? err.message : "decline failed"
    return res.status(500).json({ message })
  }
}
