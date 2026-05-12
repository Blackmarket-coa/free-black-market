import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../../modules/asset-graph/service"
import { InvalidTransitionError } from "../../../../../../modules/asset-graph/instance-lifecycle"

/**
 * POST /admin/asset-graph/instances/:id/publish
 *
 * Transition a draft instance → active. 409 on any other source state.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = req.params.id
  if (!id) return res.status(400).json({ message: "id is required" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)
  try {
    const instance = await (service as AssetGraphService).publishInstance({
      instance_id: id,
    })
    return res.json({ instance })
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return res.status(409).json({
        message: err.message,
        from: err.from,
        action: err.action,
      })
    }
    const message = err instanceof Error ? err.message : "publish failed"
    return res.status(500).json({ message })
  }
}
