import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../modules/marketplace-listing/service"
import {
  CreatorListingStatus,
} from "../../../../../../../modules/marketplace-listing/models/creator-listing"
import {
  CreatorPayoutProvider,
  CreatorPayoutStatus,
} from "../../../../../../../modules/marketplace-listing/models/creator-payout-account"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

const BodySchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict()
  .partial()

/**
 * Admin suspends a creator's marketplace account: marks payout account
 * suspended, suspends all of their listings, and emits the
 * `creator.account.suspended` webhook.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid suspension payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const sellerId = String(req.params.seller_id || "")
  if (!sellerId) {
    return res
      .status(400)
      .json({ message: "seller_id required", type: "invalid_request" })
  }

  const listingService = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const webhooksService = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  await listingService.upsertPayoutAccount(sellerId, {
    provider: CreatorPayoutProvider.MANUAL,
    status: CreatorPayoutStatus.SUSPENDED,
  })

  const listings = await listingService.listCreatorListings({
    seller_id: sellerId,
  })
  let suspendedCount = 0
  for (const l of listings) {
    if (l.status !== CreatorListingStatus.ARCHIVED) {
      await listingService.suspendListing(l.id)
      suspendedCount++
    }
  }

  const dispatched = await webhooksService.dispatch(
    "creator.account.suspended",
    sellerId,
    {
      seller_id: sellerId,
      reason: parsed.data.reason ?? null,
      suspended_listing_count: suspendedCount,
      suspended_at: new Date().toISOString(),
    }
  )

  return res.json({
    seller_id: sellerId,
    suspended_listing_count: suspendedCount,
    dispatched_count: dispatched.length,
  })
}
