import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../modules/marketplace-listing/service"
import {
  CreatorPayoutProvider,
  CreatorPayoutStatus,
} from "../../../../../modules/marketplace-listing/models/creator-payout-account"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"
import { emitBlackoutEvent } from "../../../../../lib/blackout-emit"
import { resolveSellerBlackoutUserId } from "../../../../../lib/blackout-identity"

const BodySchema = z
  .object({
    seller_id: z.string().min(1),
    amount: z.number().nonnegative(),
    currency: z.string().min(3).max(8),
    external_payout_id: z.string().min(1).max(120).optional(),
    period_id: z.string().min(1).max(120).optional(),
    provider: z
      .enum([
        CreatorPayoutProvider.STRIPE_CONNECT,
        CreatorPayoutProvider.HAWALA,
        CreatorPayoutProvider.MANUAL,
      ])
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

/**
 * Admin records that a creator payout has been completed and emits the
 * `creator.payout.completed` outbound webhook.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid payout payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const listingService = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const webhooksService = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  const now = new Date()
  await listingService.upsertPayoutAccount(parsed.data.seller_id, {
    provider: parsed.data.provider ?? CreatorPayoutProvider.MANUAL,
    status: CreatorPayoutStatus.ACTIVE,
    provider_metadata: parsed.data.metadata ?? null,
  })

  const [account] = await listingService.listCreatorPayoutAccounts({
    seller_id: parsed.data.seller_id,
  })
  if (account) {
    await listingService.updateCreatorPayoutAccounts({
      id: account.id,
      last_payout_at: now,
    })
  }

  const dispatched = await webhooksService.dispatch(
    "creator.payout.completed",
    parsed.data.seller_id,
    {
      seller_id: parsed.data.seller_id,
      amount: parsed.data.amount,
      currency: parsed.data.currency.toUpperCase(),
      external_payout_id: parsed.data.external_payout_id ?? null,
      period_id: parsed.data.period_id ?? null,
      provider: parsed.data.provider ?? CreatorPayoutProvider.MANUAL,
      paid_at: now.toISOString(),
    }
  )

  // §2 lifecycle: mirror onto the global Blackout channel (amount in minor units).
  const blackoutUserId = await resolveSellerBlackoutUserId(req.scope, parsed.data.seller_id)
  if (blackoutUserId) {
    await emitBlackoutEvent(
      req.scope,
      "creator.payout.completed",
      { userId: blackoutUserId },
      {
        eventId: `creator.payout.completed:${parsed.data.external_payout_id ?? `${parsed.data.seller_id}:${now.getTime()}`}`,
        metadata: {
          grossCents: Math.round(parsed.data.amount * 100),
          currency: parsed.data.currency.toUpperCase(),
          periodId: parsed.data.period_id ?? null,
        },
      }
    )
  }

  return res.json({
    seller_id: parsed.data.seller_id,
    paid_at: now.toISOString(),
    dispatched_count: dispatched.length,
  })
}
