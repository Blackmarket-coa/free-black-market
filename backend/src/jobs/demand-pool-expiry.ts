import { createLogger } from "../shared/logger"
const log = createLogger("jobs/demand-pool-expiry")
import { MedusaContainer } from "@medusajs/framework/types"
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
export async function expireOverduePools(
  demandPoolService: DemandPoolModuleService,
  collectiveHawala: CollectiveHawalaService,
  now: Date
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

  const results = await expireOverduePools(
    demandPoolService,
    collectiveHawala,
    new Date()
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
