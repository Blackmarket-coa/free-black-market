import { createLogger } from "../shared/logger"
const log = createLogger("jobs/demand-pool-expiry")
import { MedusaContainer } from "@medusajs/framework/types"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { DEMAND_POOL_MODULE } from "../modules/demand-pool"
import { DemandPostStatus } from "../modules/demand-pool/models/demand-post"
import {
  CollectiveHawalaService,
  getCollectiveHawalaService,
} from "../services/collective-hawala"
import type DemandPoolModuleService from "../modules/demand-pool/service"

/**
 * Scheduled sweep that expires demand pools whose deadline has passed
 * while they are still in a non-terminal, pre-deal status
 * (OPEN / THRESHOLD_MET / NEGOTIATING).
 *
 * For each overdue pool it refunds any un-paid bounty escrow back to the
 * contributors (via CollectiveHawalaService.refundAllBounties) and then
 * transitions the pool to EXPIRED. Each pool is processed inside its own
 * try/catch so one failure can't abort the batch.
 *
 * The core loop is extracted into the pure, container-free helper
 * `expireOverduePools` so it can be unit-tested with fake services.
 */
export type UnfulfilledDemandSignal = {
  demand_post_id: string
  category: string | null
  delivery_region: string | null
  committed_quantity: number
  target_quantity: number
  bounty_amount: number
}

export async function expireOverduePools(
  demandPoolService: DemandPoolModuleService,
  collectiveHawala: CollectiveHawalaService,
  now: Date,
  /**
   * Announce each expired pool as unmet demand. Optional and injected rather
   * than resolved from a container so this helper stays container-free and
   * unit-testable. A failing emit must never abort the sweep — the refund and
   * the status transition are the job's real work.
   */
  onUnfulfilled?: (signal: UnfulfilledDemandSignal) => Promise<void>
): Promise<
  Array<{
    demand_post_id: string
    status: "expired" | "failed"
    error?: string
  }>
> {
  const nonTerminal = [
    DemandPostStatus.OPEN,
    DemandPostStatus.THRESHOLD_MET,
    DemandPostStatus.NEGOTIATING,
  ]

  const posts = await demandPoolService.listDemandPosts({
    status: nonTerminal,
    deadline: { $lt: now },
  })

  const results: Array<{
    demand_post_id: string
    status: "expired" | "failed"
    error?: string
  }> = []

  for (const post of posts) {
    try {
      await collectiveHawala.refundAllBounties(post.id)
      await demandPoolService.transitionDemandStatus(
        post.id,
        DemandPostStatus.EXPIRED
      )
      results.push({ demand_post_id: post.id, status: "expired" })

      // A pool nobody could supply is the clearest evidence of an unserved
      // market, so it is announced rather than left to go quiet. Isolated:
      // the pool is already expired and refunded by this point, and an emit
      // failure must not turn a successful expiry into a reported failure.
      if (onUnfulfilled) {
        try {
          await onUnfulfilled({
            demand_post_id: post.id,
            category: (post.category as string | null) ?? null,
            delivery_region: (post.delivery_region as string | null) ?? null,
            committed_quantity: Number(post.committed_quantity ?? 0),
            target_quantity: Number(post.target_quantity ?? 0),
            bounty_amount: Number(post.total_bounty_amount ?? 0),
          })
        } catch (emitErr: any) {
          log.error(
            `[demand-pool-expiry] unfulfilled-demand emit failed for ${post.id}: ${emitErr?.message}`
          )
        }
      }
    } catch (error: any) {
      results.push({
        demand_post_id: post.id,
        status: "failed",
        error: error.message,
      })
    }
  }

  return results
}

export default async function demandPoolExpiryJob(
  container: MedusaContainer
): Promise<void> {
  const demandPoolService =
    container.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
  const collectiveHawala = getCollectiveHawalaService(container)

  log.info("[demand-pool-expiry] Starting overdue-pool sweep")

  const eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)

  const results = await expireOverduePools(
    demandPoolService,
    collectiveHawala,
    new Date(),
    async (signal) => {
      await eventBus.emit({ name: "demand_pool.expired_unfulfilled", data: signal })
    }
  )

  const expired = results.filter((r) => r.status === "expired").length
  const failed = results.filter((r) => r.status === "failed")

  log.info(
    `[demand-pool-expiry] Processed ${results.length} overdue pools: ` +
      `expired=${expired}, failed=${failed.length}`
  )

  for (const f of failed) {
    log.error(
      `[demand-pool-expiry] FAILED ${f.demand_post_id}: ${f.error}`
    )
  }
}

export const config = {
  name: "demand-pool-expiry",
  // Run hourly; deadlines have hour-or-coarser granularity in practice.
  schedule: "0 * * * *",
}
