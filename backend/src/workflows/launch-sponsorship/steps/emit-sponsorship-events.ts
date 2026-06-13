import { createLogger } from "../../../shared/logger"
const log = createLogger("workflows/launch-sponsorship/steps/emit-sponsorship-events")
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import MarketplaceWebhooksService from "../../../modules/marketplace-webhooks/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../modules/marketplace-webhooks"

export type EmitSponsorshipEventsInput = {
  launch_id: string
  vendor_mxid?: string | null
  vendor_id: string
  program_id: string
  deal_id: string | null
  invited_creator_seller_id: string | null
  target_creator_seller_id?: string | null
  amount_cents: number
  currency_code: string
  escrowed: boolean
}

/**
 * Emits the `sponsorship.created` Blackout webhook so the Creator Hub can
 * surface the sponsorship offer. Mirrors `emit-launch-events`: dedupes on a
 * stable eventId, no-ops cleanly when unconfigured, and never fails the
 * sponsorship if the outbound channel hiccups.
 */
const emitSponsorshipEventsStep = createStep(
  "emit-sponsorship-events-step",
  async (data: EmitSponsorshipEventsInput, { container }) => {
    const webhooks = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )

    try {
      await webhooks.emitBlackout(
        "sponsorship.created",
        {
          launchId: data.launch_id,
          vendorMxid: data.vendor_mxid ?? null,
          vendorId: data.vendor_id,
          programId: data.program_id,
          dealId: data.deal_id,
          creatorSellerId:
            data.target_creator_seller_id ??
            data.invited_creator_seller_id ??
            null,
          invited: !!data.invited_creator_seller_id,
          amountCents: data.amount_cents,
          currencyCode: data.currency_code,
          escrowed: data.escrowed,
        },
        { eventId: `sponsorship.created:${data.launch_id}` }
      )
    } catch (err) {
      log.error(
        "[sponsorship] emit-sponsorship-events failed:",
        (err as Error).message
      )
    }

    return new StepResponse({ emitted: true })
  }
)

export default emitSponsorshipEventsStep
