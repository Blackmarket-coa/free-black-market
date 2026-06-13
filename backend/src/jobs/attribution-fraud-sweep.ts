import { createLogger } from "../shared/logger"
const log = createLogger("jobs/attribution-fraud-sweep")
import { MedusaContainer } from "@medusajs/framework/types"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"
import { CommissionStatus } from "../modules/creator-attribution/models"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

const VELOCITY_BURST_LIMIT = (() => {
  const v = parseInt(process.env.CREATOR_ATTRIBUTION_VELOCITY_BURST_LIMIT || "60", 10)
  return Number.isFinite(v) && v >= 0 ? v : 60
})()

const VELOCITY_WINDOW_MINUTES = 1

/**
 * Lightweight fraud sweep that runs every 10 minutes. Two signals:
 *
 *   1. Velocity bursts: any (ip_hash, affiliate_link_id) seeing >N clicks
 *      inside the most recent 1-minute window get all their NOT-yet-bot-
 *      flagged clicks in that window marked `is_bot_suspected=true`. Bot-
 *      flagged clicks never count toward attribution (lastClickForVisitor
 *      filters them out).
 *
 *   2. For any `held` `OrderAttribution` whose attached `click_event_id`
 *      is now bot-flagged, transition the attribution to `disqualified`
 *      and emit `creator.attribution.fraud_flagged`.
 *
 * Real-world deployments would also wire in a JS challenge for high-
 * velocity codes, IP-block intel, and per-customer velocity limits — out
 * of scope for Release C.
 */
export default async function attributionFraudSweepJob(
  container: MedusaContainer
) {
  const service = container.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  let webhooks: MarketplaceWebhooksService | null = null
  try {
    webhooks = container.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  } catch {
    webhooks = null
  }

  const since = new Date(Date.now() - VELOCITY_WINDOW_MINUTES * 60_000)

  // Velocity sweep on recent clicks. We use a simple in-memory aggregation
  // since the click table is small per-window in normal operation.
  const recentClicks = await service.listAttributionClickEvents({
    is_bot_suspected: false,
  })
  const filtered = recentClicks.filter(
    (c: any) => new Date(c.occurred_at as any) >= since
  )
  const counters = new Map<string, any[]>()
  for (const c of filtered as any[]) {
    if (!c.ip_hash) continue
    const k = `${c.ip_hash}:${c.affiliate_link_id}`
    const arr = counters.get(k) ?? []
    arr.push(c)
    counters.set(k, arr)
  }

  let flagged = 0
  for (const [, list] of counters.entries()) {
    if (list.length <= VELOCITY_BURST_LIMIT) continue
    for (const click of list) {
      try {
        await (service as any).updateAttributionClickEvents({
          id: click.id,
          is_bot_suspected: true,
        })
        flagged++
      } catch (err) {
        log.error("[attribution-fraud-sweep] click update failed", err)
      }
    }
  }

  // Disqualify held attributions whose click_event got flagged.
  const held = await service.listOrderAttributions({
    commission_status: CommissionStatus.HELD,
  })
  for (const attr of held as any[]) {
    if (!attr.click_event_id) continue
    const clicks = await service.listAttributionClickEvents({
      id: attr.click_event_id,
    })
    const click = clicks[0]
    if (!click || !click.is_bot_suspected) continue
    try {
      await service.disqualifyAttribution(
        attr.id,
        "fraud_sweep_velocity_burst"
      )
      if (webhooks) {
        try {
          await webhooks.dispatch(
            "creator.attribution.fraud_flagged",
            attr.creator_seller_id,
            {
              attribution_id: attr.id,
              order_id: attr.order_id,
              reason: "fraud_sweep_velocity_burst",
            }
          )
        } catch (err) {
          log.error("[attribution-fraud-sweep] webhook dispatch failed", err)
        }
      }
    } catch (err) {
      log.error("[attribution-fraud-sweep] disqualify failed", err)
    }
  }

  if (flagged > 0) {
    log.info(`[attribution-fraud-sweep] flagged ${flagged} clicks`)
  }
}

export const config = {
  name: "attribution-fraud-sweep",
  schedule: "*/10 * * * *", // every 10 minutes
}
