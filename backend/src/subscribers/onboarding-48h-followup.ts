import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/onboarding-48h-followup")
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Sprint A → C bridging stub: dispatches a `vendor.onboarding.followup_due`
 * webhook 48h after a vendor publishes their first listing (branch B in
 * `FEATURE_BUILD_PLAN.md`). Branch A (signed up but no listing) is handled
 * by a separate scheduled job (out of scope this pass).
 *
 * Best-effort. Listeners (email automations, Matrix chat nudges) plug in
 * via `marketplace-webhooks`.
 */
export default async function onboardingFollowup({
  event: { data },
  container,
}: SubscriberArgs<{ seller_id: string; listing_id: string }>) {
  const { seller_id, listing_id } = data
  if (!seller_id) return

  let webhooks: MarketplaceWebhooksService | null = null
  try {
    webhooks = container.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  } catch {
    return
  }
  if (!webhooks) return

  const delayMs = Number(process.env.FBM_ONBOARDING_FOLLOWUP_DELAY_MS || 48 * 60 * 60 * 1000)

  // Use the existing event bus to schedule a delayed follow-up. If the
  // bus does not support delays we fall back to immediate dispatch so the
  // listener gets exercised in dev.
  let eventBus: IEventBusModuleService | null = null
  try {
    eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
  } catch {
    eventBus = null
  }

  const payload = { seller_id, listing_id, branch: "first_listing_published" }
  try {
    if (eventBus?.emit) {
      await eventBus.emit({
        name: "vendor.onboarding.followup_due",
        data: payload,
        options: delayMs ? { delay: delayMs } : undefined,
      })
    }
  } catch {
    // ignore
  }

  // Outbound webhook (subscribed by ops automation tools, etc.).
  try {
    await webhooks.dispatch("vendor.onboarding.followup_scheduled", seller_id, payload)
  } catch (err) {
    log.error("[onboarding-48h-followup] webhook dispatch failed", err)
  }
}

export const config: SubscriberConfig = {
  event: "vendor.onboarding.first_listing_published",
}
