import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../../modules/asset-graph/service"
import { InvalidTransitionError } from "../../../../../../modules/asset-graph/instance-lifecycle"

/**
 * POST /admin/asset-graph/proposals/:id/accept
 *
 * Body: { state?: "draft" | "active" }
 *
 * Marks the proposal accepted and creates a ProjectInstance from it.
 * Returns both rows. 409 if the proposal isn't in `pending` state
 * (idempotency of the state-machine kind: accepting an already-
 * accepted proposal is a caller bug, not a no-op).
 */
type AcceptBody = { state?: "draft" | "active" }

export async function POST(
  req: MedusaRequest<AcceptBody>,
  res: MedusaResponse
) {
  const id = req.params.id
  if (!id) return res.status(400).json({ message: "id is required" })

  const body = (req.validatedBody || req.body || {}) as AcceptBody
  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  try {
    const result = await (service as AssetGraphService).acceptProposal({
      proposal_id: id,
      state: body.state,
    })
    return res.json(result)
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({
        message: err.message,
        from: err.from,
        action: err.action,
      })
    }
    const message = err instanceof Error ? err.message : "accept failed"
    return res.status(500).json({ message })
  }
}
