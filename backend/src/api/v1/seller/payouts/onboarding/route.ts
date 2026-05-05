import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../modules/marketplace-listing/service"
import {
  CreatorPayoutProvider,
  CreatorPayoutStatus,
} from "../../../../../modules/marketplace-listing/models/creator-payout-account"

const BodySchema = z
  .object({
    provider: z
      .enum([
        CreatorPayoutProvider.STRIPE_CONNECT,
        CreatorPayoutProvider.HAWALA,
        CreatorPayoutProvider.MANUAL,
      ])
      .optional(),
    return_url: z.string().url().optional(),
  })
  .strict()

/**
 * Start (or resume) creator payout onboarding.
 *
 * Stripe Connect wiring is intentionally out of scope for this PR (see
 * THREAT_MODEL.md and the marketplace plan): we mark the account `pending`
 * and return a placeholder onboarding URL pointing at the vendor panel,
 * giving the BlackOut client a stable contract while the real provider
 * integration lands separately.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid onboarding payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const provider = parsed.data.provider ?? CreatorPayoutProvider.MANUAL

  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )

  const baseUrl =
    process.env.VENDOR_PANEL_URL ||
    process.env.BACKEND_URL ||
    "https://vendor.freeblackmarket.com"
  const onboardingUrl = `${baseUrl.replace(/\/$/, "")}/payouts/onboarding?seller=${encodeURIComponent(
    sellerId
  )}&provider=${provider}`

  await service.upsertPayoutAccount(sellerId, {
    provider,
    onboarding_url: onboardingUrl,
    status: CreatorPayoutStatus.PENDING,
  })

  return res.json({
    url: onboardingUrl,
    status: CreatorPayoutStatus.PENDING,
    provider,
  })
}
