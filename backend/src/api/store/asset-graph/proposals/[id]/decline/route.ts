import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../../modules/asset-graph/service"
import { InvalidTransitionError } from "../../../../../../modules/asset-graph/instance-lifecycle"

/**
 * POST /store/asset-graph/proposals/:id/decline
 *
 * Decline a proposal. Same ownership rules as accept — 404 if the
 * proposal doesn't exist or belongs to a different member.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const memberId = (req as any).auth_context?.actor_id
  if (!memberId) return res.status(401).json({ error: "Unauthorized" })

  const id = req.params.id
  if (!id) return res.status(400).json({ error: "id is required" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  try {
    const existing = await (service as AssetGraphService).retrieveMatchProposal(
      id
    )
    if (!existing || (existing as any).member_id !== memberId) {
      return res.status(404).json({ error: "Not found" })
    }
  } catch {
    return res.status(404).json({ error: "Not found" })
  }

  try {
    const proposal = await (service as AssetGraphService).declineProposal({
      proposal_id: id,
    })
    return res.json({ proposal })
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({
        error: err.message,
        from: err.from,
        action: err.action,
      })
    }
    const message = err instanceof Error ? err.message : "decline failed"
    return res.status(500).json({ error: message })
  }
}
