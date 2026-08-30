import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/savings-demand-pool-fulfilled")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DEMAND_POOL_MODULE } from "../modules/demand-pool"
import type DemandPoolModuleService from "../modules/demand-pool/service"
import { ParticipantStatus } from "../modules/demand-pool/models/demand-participant"
import { BUYER_NETWORK_MODULE } from "../modules/buyer-network"
import type BuyerNetworkModuleService from "../modules/buyer-network/service"

type DemandPoolFulfilledPayload = {
  demand_post_id: string
  organizer_id: string | null
  organizer_type?: string | null
  participant_ids: string[]
}

const roundCents = (dollars: number) => Math.round(dollars * 100) / 100

/**
 * Record realized group-buy savings when a pool is fulfilled — Tier 1 of
 * docs/SAVINGS_ROUTING_SPEC.md.
 *
 * Realized savings are a fact about a purchase, not a balance: this writes
 * member/network totals through `recordGroupBuyParticipation` and touches no
 * ledger account. Per participant, `savings = max(0, target_price −
 * final_unit_price) × quantity_committed` — the event payload carries no
 * prices, so the post is re-fetched (same query resolves the linked buyer
 * network; a pool with no network records nothing).
 *
 * `recordGroupBuyParticipation` is a plain accumulator, so replay protection
 * lives here: each participant is marked (`metadata.savings_recorded_at`)
 * after their record lands, and marked participants are skipped. A
 * redelivered event therefore no-ops; a crash mid-loop resumes with only the
 * unrecorded participants. The network's completed-group-buy counter bumps
 * once per pool, and only when this delivery recorded someone — so a
 * resumed delivery cannot double-count the pool either.
 *
 * Additive and isolated by try/catch, like the progression subscriber on
 * this event: stats must never break the fulfillment transition.
 */
export default async function savingsDemandPoolFulfilled({
  event: { data },
  container,
}: SubscriberArgs<DemandPoolFulfilledPayload>) {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const demandPoolService = container.resolve(
      DEMAND_POOL_MODULE
    ) as DemandPoolModuleService
    const buyerNetworkService = container.resolve(
      BUYER_NETWORK_MODULE
    ) as BuyerNetworkModuleService

    const { data: posts } = await query.graph({
      entity: "demand_post",
      fields: ["id", "target_price", "final_unit_price", "buyer_network.id"],
      filters: { id: data.demand_post_id },
    })

    // Via `unknown`: query.graph rows are typed against generated link types
    // (see shared/channel-inventory.ts for the same pattern).
    const post = posts?.[0] as unknown as
      | {
          id: string
          target_price?: unknown
          final_unit_price?: unknown
          buyer_network?: { id?: string } | { id?: string }[] | null
        }
      | undefined
    if (!post) return

    const linked = Array.isArray(post.buyer_network)
      ? post.buyer_network[0]
      : post.buyer_network
    const networkId = linked?.id
    if (!networkId) return

    // Clamped per-unit savings; missing prices record participation with 0
    // savings rather than skipping — completion still happened.
    const targetPrice = Number(post.target_price)
    const finalPrice = Number(post.final_unit_price)
    const savingsPerUnit =
      Number.isFinite(targetPrice) && Number.isFinite(finalPrice)
        ? Math.max(0, targetPrice - finalPrice)
        : 0

    // The same follow-through set the fulfillment event carries: pledged,
    // paid, or completion-processed. WITHDRAWN/REFUNDED left the pool.
    const participants = await demandPoolService.listDemandParticipants({
      demand_post_id: data.demand_post_id,
      status: [
        ParticipantStatus.COMMITTED,
        ParticipantStatus.ESCROWED,
        ParticipantStatus.CONFIRMED,
      ],
    })

    let newlyRecorded = 0
    for (const participant of participants) {
      const metadata = (participant.metadata || {}) as Record<string, unknown>
      if (metadata.savings_recorded_at) continue

      const savings = roundCents(
        savingsPerUnit * Number(participant.quantity_committed)
      )

      await buyerNetworkService.recordGroupBuyParticipation(
        networkId,
        participant.customer_id as string,
        savings
      )

      // Record-then-mark: a redelivery after success skips cleanly; the only
      // double-count window is a crash between these two writes, which is
      // acceptable for reputation/savings stats (this is bookkeeping, not
      // money — no ledger entry exists to duplicate).
      await demandPoolService.updateDemandParticipants({
        id: participant.id,
        metadata: {
          ...metadata,
          savings_recorded_at: new Date().toISOString(),
          savings_recorded_amount: savings,
          savings_network_id: networkId,
        },
      })
      newlyRecorded += 1
    }

    if (newlyRecorded > 0) {
      await buyerNetworkService.recordCompletedGroupBuy(networkId)
    }
  } catch (error) {
    log.error(
      `[savings-demand-pool-fulfilled] Failed to record savings for pool ${data.demand_post_id}:`,
      error
    )
    // Swallow — savings bookkeeping must not break the fulfillment flow.
  }
}

export const config: SubscriberConfig = {
  event: "demand_pool.fulfilled",
}
