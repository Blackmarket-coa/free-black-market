import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../modules/marketplace-listing/service"
import {
  CreatorPayoutProvider,
  CreatorPayoutStatus,
} from "../../../../../modules/marketplace-listing/models/creator-payout-account"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const [account] = await service.listCreatorPayoutAccounts({ seller_id: sellerId })

  if (!account) {
    return res.json({
      account: {
        seller_id: sellerId,
        provider: CreatorPayoutProvider.MANUAL,
        status: CreatorPayoutStatus.PENDING,
        onboarding_url: null,
        last_payout_at: null,
      },
    })
  }

  return res.json({ account })
}
