import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/progression-mutual-aid-fulfilled")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

type MutualAidFulfilledPayload = {
  request_id: string
  helper_id: string
  requester_id: string
  category?: string | null
  urgency?: string | null
}

/** Flat award. See below for why it is not scaled by urgency or size. */
const HELPER_XP = 15

/**
 * Award XP when someone confirms that mutual aid arrived.
 *
 * This is the third and final mode of Phase 2's cross-mode reputation. Filling
 * a bounty, organizing a group buy, and helping through mutual aid are
 * different kinds of contribution that now all land on one character sheet —
 * which was the original claim, and until this subscriber existed it described
 * two modes out of three.
 *
 * COALITION, the same track as bounty fills and group-buy organizing, so trust
 * genuinely carries across modes rather than accumulating in parallel columns
 * that happen to share a table.
 *
 * The award is flat, and deliberately not scaled by urgency or quantity.
 * Paying more for URGENT would create a reason to overstate urgency on a board
 * where the people reading it are in need, and paying by size would rank a
 * large donation above showing up. Neither is the signal worth rewarding here.
 *
 * Only the requester can trigger the event that reaches this (enforced in
 * `confirmFulfilled`), so the XP rests on the word of the person who actually
 * received something rather than the person claiming credit.
 *
 * Additive and isolated by try/catch — XP must never break a confirmation.
 */
export default async function progressionMutualAidFulfilled({
  event: { data },
  container,
}: SubscriberArgs<MutualAidFulfilledPayload>) {
  try {
    const helperId = data.helper_id
    if (!helperId) return
    // Self-help would be a way to mint reputation from nothing. The service
    // already refuses it; this is the second lock on the same door.
    if (helperId === data.requester_id) return

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    await progression.recordXpEvent({
      customer_id: helperId,
      role: Stance.COALITION,
      amount: HELPER_XP,
      reason: "mutual-aid-fulfilled",
      source_module: "mutual_aid",
      // Scoped per request so a redelivered event cannot double-count,
      // matching the partial unique index on (source_module, source_id).
      source_id: data.request_id,
      metadata: {
        request_id: data.request_id,
        category: data.category ?? null,
        urgency: data.urgency ?? null,
      },
    })

    await progression.recomputeAggregates(helperId, query as never)
  } catch (error) {
    log.error(
      `[progression-mutual-aid-fulfilled] Failed to award XP for request ${data.request_id}:`,
      error
    )
    // Swallow — XP failure must not break the confirmation flow.
  }
}

export const config: SubscriberConfig = {
  event: "mutual_aid.fulfilled",
}
