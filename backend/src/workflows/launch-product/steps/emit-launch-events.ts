import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import MarketplaceWebhooksService from "../../../modules/marketplace-webhooks/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../modules/marketplace-webhooks"

export type EmitLaunchEventsInput = {
  launch_id: string
  vendor_mxid?: string | null
  product_id: string
  cooperative_id?: string | null
  demand_post_id: string
  bounty_id: string | null
  deal_id?: string | null
  affiliate_short_code?: string | null
  objective: string
  amount: number
  currency_code: string
}

/**
 * Emits the FBM-side growth-loop webhooks so Blackout can surface the launch
 * and its open bounty. `emitBlackout` no-ops cleanly when the emitter is
 * unconfigured (dev/preview) and dedupes on the stable eventId, so this step
 * is safe to re-run and never blocks a launch.
 */
const emitLaunchEventsStep = createStep(
  "emit-launch-events-step",
  async (data: EmitLaunchEventsInput, { container }) => {
    const webhooks = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )

    try {
      await webhooks.emitBlackout(
        "launch.created",
        {
          launchId: data.launch_id,
          vendorMxid: data.vendor_mxid ?? null,
          productId: data.product_id,
          cooperativeId: data.cooperative_id ?? null,
          demandPostId: data.demand_post_id,
          bountyId: data.bounty_id,
          dealId: data.deal_id ?? null,
          affiliateShortCode: data.affiliate_short_code ?? null,
        },
        { eventId: `launch.created:${data.launch_id}` }
      )

      if (data.bounty_id) {
        await webhooks.emitBlackout(
          "bounty.opened",
          {
            demandPostId: data.demand_post_id,
            bountyId: data.bounty_id,
            objective: data.objective,
            amount: data.amount,
            currencyCode: data.currency_code,
            cooperativeId: data.cooperative_id ?? null,
          },
          { eventId: `bounty.opened:${data.launch_id}` }
        )
      }
    } catch (err) {
      // Never fail a launch because the outbound channel hiccuped.
      console.error("[launch] emit-launch-events failed:", (err as Error).message)
    }

    return new StepResponse({ emitted: true })
  }
)

export default emitLaunchEventsStep
