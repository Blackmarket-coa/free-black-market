import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/progression-campaign-backed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

type CampaignBackedPayload = {
  backing_id: string
  campaign_id: string
  backer_id: string
  mode: string
  amount: number
}

/**
 * Award XP when a member backs a collective campaign.
 *
 * **Only a `PRE_ORDER` backing earns XP.** A pre-order is a forward purchase —
 * ordinary commerce, and XP for it is ordinary loyalty → CONSUMER XP. A
 * `MICRO_INVESTOR` backing deploys capital, and awarding XP for it made
 * reputation a linear function of dollars, which is precisely the coupling
 * between reputation and capital that must not exist: it fed the (now deleted)
 * `producer.reduced-commission` and `investor.priority-campaigns` privileges,
 * closing a pay-in / level-up / pay-less / get-in-earlier loop. See
 * docs/TRANSMUTATION_STRATEGY.md §3.4 and the matching half of the fix in
 * `modules/progression/thresholds.ts`.
 *
 * The aggregate recompute still runs for every backing mode: it refreshes the
 * backer's `capital_deployed_cents` snapshot, which is a record of capital as
 * capital and carries no XP.
 *
 * Additive and isolated by try/catch — XP must never break the backing flow.
 */
export default async function progressionCampaignBacked({
  event: { data },
  container,
}: SubscriberArgs<CampaignBackedPayload>) {
  try {
    const backerId = data.backer_id
    if (!backerId) return

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    if (data.mode !== "MICRO_INVESTOR") {
      // 1 XP per whole currency unit spent (amount is in the smallest unit).
      const xp = Math.max(1, Math.round(Number(data.amount ?? 0) / 100))

      await progression.recordXpEvent({
        customer_id: backerId,
        role: Stance.CONSUMER,
        amount: xp,
        reason: "campaign-backed",
        source_module: "collective_campaign",
        source_id: data.backing_id,
        metadata: { mode: data.mode, campaign_id: data.campaign_id },
      })
    }

    await progression.recomputeAggregates(backerId, query as never)
  } catch (error) {
    log.error(
      `[progression-campaign-backed] Failed to award XP for backing ${data.backing_id}:`,
      error
    )
    // Swallow — XP failure must not break the backing flow.
  }
}

export const config: SubscriberConfig = {
  event: "campaign.backed",
}
