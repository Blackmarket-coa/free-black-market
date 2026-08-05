import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/progression-demand-pool-fulfilled")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

type DemandPoolFulfilledPayload = {
  demand_post_id: string
  organizer_id: string | null
  organizer_type?: string | null
  participant_ids: string[]
}

/** Flat award for seeing a group buy through, independent of order size. */
const ORGANIZER_XP = 25
const PARTICIPANT_XP = 5

/**
 * Award XP when a group buy actually completes.
 *
 * The second half of cross-mode reputation, alongside
 * `progression-bounty-settled`. Organizing a group buy and filling a bounty are
 * different kinds of contribution, but they land on the same character sheet —
 * which is the whole point: one trust profile, not three siloed scores.
 *
 * Organizing earns COALITION (coordinating others); participating earns
 * CONSUMER (committing demand). Both are flat rather than proportional to
 * order value, so a large pool does not simply out-earn a small one — the
 * signal is "did you follow through", not "how much did you spend".
 *
 * `source_id` is scoped per pool and per role so a redelivered event cannot
 * double-count, matching the partial unique index on `(source_module,
 * source_id)`.
 *
 * Additive and isolated by try/catch — XP must never break the transition.
 */
export default async function progressionDemandPoolFulfilled({
  event: { data },
  container,
}: SubscriberArgs<DemandPoolFulfilledPayload>) {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    const participantIds = Array.isArray(data.participant_ids)
      ? data.participant_ids.filter(Boolean)
      : []

    // Sellers progress through the Quest Engine, not the character sheet.
    const organizerId =
      data.organizer_id && data.organizer_type !== "SELLER"
        ? data.organizer_id
        : null

    // A creator who also pledged should not be paid twice for the same pool.
    const credited = new Set<string>()

    if (organizerId) {
      await progression.recordXpEvent({
        customer_id: organizerId,
        role: Stance.COALITION,
        amount: ORGANIZER_XP,
        reason: "demand-pool-organized",
        source_module: "demand_pool",
        source_id: `${data.demand_post_id}-organizer`,
        metadata: { demand_post_id: data.demand_post_id },
      })
      credited.add(organizerId)
    }

    for (const participantId of participantIds) {
      if (credited.has(participantId)) continue
      credited.add(participantId)

      await progression.recordXpEvent({
        customer_id: participantId,
        role: Stance.CONSUMER,
        amount: PARTICIPANT_XP,
        reason: "demand-pool-fulfilled",
        source_module: "demand_pool",
        source_id: `${data.demand_post_id}-${participantId}`,
        metadata: { demand_post_id: data.demand_post_id },
      })
    }

    for (const customerId of credited) {
      await progression.recomputeAggregates(customerId, query as never)
    }
  } catch (error) {
    log.error(
      `[progression-demand-pool-fulfilled] Failed to award XP for pool ${data.demand_post_id}:`,
      error
    )
    // Swallow — XP failure must not break the fulfillment flow.
  }
}

export const config: SubscriberConfig = {
  event: "demand_pool.fulfilled",
}
