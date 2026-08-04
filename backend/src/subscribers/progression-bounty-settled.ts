import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/progression-bounty-settled")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

type BountyMilestoneSettledPayload = {
  bounty_id: string
  demand_post_id: string
  milestone_index: number
  assignee_id: string
  assignee_type?: string | null
  objective?: string | null
  payout_amount: number
}

/**
 * Creator-facing bounty objectives earn CREATOR XP; everything else on the
 * buyer hub is collective contribution.
 */
const CREATOR_OBJECTIVES = new Set([
  "CREATOR_NEEDED",
  "MARKETING_NEEDED",
  "PHOTOGRAPHY_NEEDED",
])

/**
 * Award XP when a demand-pool bounty milestone settles to its assignee.
 *
 * This is the buyer hub's half of cross-mode reputation. Trust earned filling a
 * bounty, organizing a group buy, or helping through mutual aid has to land on
 * ONE profile rather than three siloed scores — and it already can, because
 * `xp_event` carries `source_module`/`source_id` and `character_sheet`
 * aggregates across every source. So this emits into the existing progression
 * system rather than standing up a parallel one.
 *
 * Sellers are skipped: `recordXpEvent` keys on `customer_id`, and the vendor
 * side has its own progression path through the Quest Engine.
 *
 * Additive and isolated by try/catch — XP must never break a payout.
 */
export default async function progressionBountySettled({
  event: { data },
  container,
}: SubscriberArgs<BountyMilestoneSettledPayload>) {
  try {
    const assigneeId = data.assignee_id
    if (!assigneeId) return
    if (data.assignee_type === "SELLER") return

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    const role = CREATOR_OBJECTIVES.has(data.objective ?? "")
      ? Stance.CREATOR
      : Stance.COALITION

    // Payout amounts are Hawala working units (major units), so 1 XP per whole
    // unit settled, with a floor of 1 so a sub-unit milestone still counts.
    const xp = Math.max(1, Math.round(Number(data.payout_amount ?? 0)))

    await progression.recordXpEvent({
      customer_id: assigneeId,
      role,
      amount: xp,
      reason: "bounty-milestone-settled",
      source_module: "demand_bounty",
      source_id: `${data.bounty_id}-m${data.milestone_index}`,
      metadata: {
        bounty_id: data.bounty_id,
        demand_post_id: data.demand_post_id,
        milestone_index: data.milestone_index,
        objective: data.objective ?? null,
      },
    })

    await progression.recomputeAggregates(assigneeId, query as never)
  } catch (error) {
    log.error(
      `[progression-bounty-settled] Failed to award XP for bounty ${data.bounty_id} milestone ${data.milestone_index}:`,
      error
    )
    // Swallow — XP failure must not break the payout flow.
  }
}

export const config: SubscriberConfig = {
  event: "bounty.milestone_settled",
}
