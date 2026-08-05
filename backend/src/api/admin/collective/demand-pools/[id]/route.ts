import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/collective/demand-pools/[id]")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../modules/demand-pool/service"
import { getCollectiveHawalaService } from "../../../../../services/collective-hawala"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { ParticipantStatus } from "../../../../../modules/demand-pool/models/demand-participant"

// GET /admin/collective/demand-pools/:id
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const details = await demandPoolService.getDemandPoolDetails(id)

    // Include savings calculation if fulfilled
    let savings: unknown = null
    if (details.status === "FULFILLED" || details.final_unit_price) {
      const hawalaService = getCollectiveHawalaService(req.scope)
      savings = await hawalaService.calculateSavings(id)
    }

    res.json({ demand_pool: details, savings })
  } catch (error) {
    log.error(`[GET /admin/collective/demand-pools/${id}] Error:`, error.message)
    res.status(error.message.includes("not found") ? 404 : 500).json({
      error: error.message,
    })
  }
}

// POST /admin/collective/demand-pools/:id (admin actions)
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { action, proposal_id, platform_fee_percentage } = req.body as { action?: string; proposal_id?: string; platform_fee_percentage?: number }
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    if (action === "select_supplier" && proposal_id) {
      const updated = await demandPoolService.selectSupplier(id, proposal_id)
      return res.json({ demand_pool: updated, message: "Supplier selected" })
    }

    if (action === "process_payment") {
      const posts = await demandPoolService.listDemandPosts({ id })
      if (posts.length === 0) {
        return res.status(404).json({ error: "Demand post not found" })
      }
      const post = posts[0]
      if (!post.selected_supplier_id || !post.final_total_price) {
        return res.status(400).json({ error: "No supplier selected or final price set" })
      }

      const hawalaService = getCollectiveHawalaService(req.scope)
      const result = await hawalaService.processGroupPurchase({
        demand_post_id: id,
        supplier_id: post.selected_supplier_id as string,
        total_amount: Number(post.final_total_price),
        platform_fee_percentage: platform_fee_percentage || 5,
      })

      return res.json({
        message: "Group purchase processed",
        ...result,
      })
    }

    if (action === "cancel") {
      const updated = await demandPoolService.transitionDemandStatus(id, "CANCELLED")
      return res.json({ demand_pool: updated, message: "Demand pool cancelled" })
    }

    if (action === "mark_fulfilled") {
      const updated = await demandPoolService.transitionDemandStatus(id, "FULFILLED")

      // Cross-mode reputation: a completed group buy credits the organizer and
      // everyone who stayed committed. Emitted here rather than on join because
      // joining is free and reversible (there is a withdraw endpoint), so
      // join-time XP would be farmable by joining and leaving repeatedly.
      // Fulfillment is operator-confirmed, so it reflects cooperation that
      // actually happened. Best-effort: an event-bus hiccup must not fail the
      // transition.
      try {
        const participants = await demandPoolService.listDemandParticipants({
          demand_post_id: id,
          status: ParticipantStatus.COMMITTED,
        })
        const eventBus = req.scope.resolve<IEventBusModuleService>(
          Modules.EVENT_BUS
        )
        await eventBus.emit({
          name: "demand_pool.fulfilled",
          data: {
            demand_post_id: id,
            organizer_id: (updated as { creator_id?: string })?.creator_id ?? null,
            organizer_type:
              (updated as { creator_type?: string })?.creator_type ?? null,
            participant_ids: participants.map((p) => p.customer_id as string),
          },
        })
      } catch (emitErr) {
        log.error(
          `[POST /admin/collective/demand-pools/${id}] demand_pool.fulfilled emit failed`,
          emitErr
        )
      }

      return res.json({ demand_pool: updated, message: "Demand pool marked as fulfilled" })
    }

    res.status(400).json({ error: "Invalid action" })
  } catch (error) {
    log.error(`[POST /admin/collective/demand-pools/${id}] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}

// DELETE /admin/collective/demand-pools/:id
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const posts = await demandPoolService.listDemandPosts({ id })
    if (posts.length === 0) {
      return res.status(404).json({ error: "Demand post not found" })
    }

    if (posts[0].status !== "DRAFT" && posts[0].status !== "CANCELLED") {
      return res.status(400).json({
        error: "Can only delete demand pools in DRAFT or CANCELLED status",
      })
    }

    await demandPoolService.deleteDemandPosts(id)
    res.json({ message: "Demand pool deleted", deleted: { id } })
  } catch (error) {
    log.error(`[DELETE /admin/collective/demand-pools/${id}] Error:`, error.message)
    res.status(500).json({ error: "Failed to delete demand pool" })
  }
}
