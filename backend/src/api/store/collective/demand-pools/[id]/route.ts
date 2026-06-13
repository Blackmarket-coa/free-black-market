import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../modules/demand-pool/service"

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

// GET /store/collective/demand-pools/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const details = await demandPoolService.getDemandPoolDetails(id)
    res.json({ demand_pool: details })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    log.error(`[GET /store/collective/demand-pools/${id}] Error:`, message)
    res.status(message.toLowerCase().includes("not found") ? 404 : 500).json({
      error: message,
    })
  }
}

// PATCH /store/collective/demand-pools/:id (publish, update)
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    // Verify ownership
    const posts = await demandPoolService.listDemandPosts({ id })
    if (posts.length === 0) {
      return res.status(404).json({ error: "Demand post not found" })
    }
    if (posts[0].creator_id !== customerId) {
      return res.status(403).json({ error: "Not the creator of this demand post" })
    }

    const { action, ...updateData } = req.body as any

    if (action === "publish") {
      const updated = await demandPoolService.publishDemandPost(id)
      return res.json({ demand_post: updated })
    }

    if (action === "cancel") {
      const updated = await demandPoolService.transitionDemandStatus(id, "CANCELLED")
      return res.json({ demand_post: updated })
    }

    // General update (only for DRAFT posts)
    if (posts[0].status !== "DRAFT") {
      return res.status(400).json({
        error: "Can only update demand posts in DRAFT status",
      })
    }

    await demandPoolService.updateDemandPosts({ id, ...updateData })
    const [updated] = await demandPoolService.listDemandPosts({ id })
    res.json({ demand_post: updated })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    log.error(`[PATCH /store/collective/demand-pools/${id}] Error:`, message)
    res.status(400).json({ error: message })
  }
}
