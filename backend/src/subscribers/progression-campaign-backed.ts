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
 * A MICRO_INVESTOR backing deploys capital → INVESTOR XP; a PRE_ORDER backing
 * is a forward purchase → CONSUMER XP. Either way the backer's
 * `capital_deployed_cents` snapshot is refreshed from the source module.
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

    const role =
      data.mode === "MICRO_INVESTOR" ? Stance.INVESTOR : Stance.CONSUMER

    // 1 XP per whole currency unit deployed (amount is in the smallest unit).
    const xp = Math.max(1, Math.round(Number(data.amount ?? 0) / 100))

    await progression.recordXpEvent({
      customer_id: backerId,
      role,
      amount: xp,
      reason: "campaign-backed",
      source_module: "collective_campaign",
      source_id: data.backing_id,
      metadata: { mode: data.mode, campaign_id: data.campaign_id },
    })

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
