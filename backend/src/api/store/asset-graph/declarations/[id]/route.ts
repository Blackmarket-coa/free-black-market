import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../modules/asset-graph/service"

/**
 * DELETE /store/asset-graph/declarations/:id
 *
 * Revokes one of the authenticated member's declarations (sets
 * `revoked_at`). 404 when the declaration doesn't exist OR
 * belongs to a different member — the route doesn't leak existence
 * to non-owners.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const memberId = (req as any).auth_context?.actor_id
  if (!memberId) return res.status(401).json({ error: "Unauthorized" })

  const id = req.params.id
  if (!id) return res.status(400).json({ error: "id is required" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)
  const updated = await (service as AssetGraphService).revokeDeclaration({
    declaration_id: id,
    member_id: memberId,
  })

  if (!updated) {
    return res.status(404).json({ error: "Not found" })
  }
  return res.json({ declaration: updated, revoked: true })
}
