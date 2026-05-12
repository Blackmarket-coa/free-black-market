import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../../modules/asset-graph/service"
import { InvalidTransitionError } from "../../../../../../modules/asset-graph/instance-lifecycle"

const body = z.object({
  state: z.enum(["draft", "active"]).optional(),
})

/**
 * POST /store/asset-graph/proposals/:id/accept
 *
 * Accept a proposal — creates a ProjectInstance with the authenticated
 * member as the operator. Enforces ownership: the proposal's
 * `member_id` must match the auth context's actor_id, otherwise 404
 * (the proposal exists but not for this caller).
 *
 * Body: { state?: "draft" | "active" } — defaults to "active".
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const memberId = (req as any).auth_context?.actor_id
  if (!memberId) return res.status(401).json({ error: "Unauthorized" })

  const id = req.params.id
  if (!id) return res.status(400).json({ error: "id is required" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  // Ownership check: 404 if the proposal doesn't exist OR isn't this
  // member's. The admin route returns 500 on missing proposals; here
  // we deliberately don't leak existence to non-owners.
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
    const parsedBody = body.parse(req.body ?? {})
    const result = await (service as AssetGraphService).acceptProposal({
      proposal_id: id,
      state: parsedBody.state,
    })
    return res.status(201).json(result)
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({
        error: err.message,
        from: err.from,
        action: err.action,
      })
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", issues: err.issues })
    }
    const message = err instanceof Error ? err.message : "accept failed"
    return res.status(500).json({ error: message })
  }
}
