import { MedusaService } from "@medusajs/framework/utils"
import CreatorListing, { CreatorListingStatus } from "./models/creator-listing"
import CreatorPayoutAccount, {
  CreatorPayoutProvider,
  CreatorPayoutStatus,
} from "./models/creator-payout-account"
import BlackoutCheckoutSession from "./models/blackout-checkout-session"

class MarketplaceListingService extends MedusaService({
  CreatorListing,
  CreatorPayoutAccount,
  BlackoutCheckoutSession,
}) {
  /**
   * Mark a listing as `signing` before invoking the signing service.
   * Idempotent: callers should treat repeated calls as a retry.
   */
  async beginPublish(listingId: string) {
    return (this as any).updateCreatorListings({
      id: listingId,
      status: CreatorListingStatus.SIGNING,
    })
  }

  async markPublished(
    listingId: string,
    fields: {
      signed_bundle_url: string
      signature_envelope: Record<string, unknown>
      signing_key_id: string
    }
  ) {
    return (this as any).updateCreatorListings({
      id: listingId,
      status: CreatorListingStatus.PUBLISHED,
      signed_at: new Date(),
      ...fields,
    })
  }

  async archiveListing(listingId: string) {
    return (this as any).updateCreatorListings({
      id: listingId,
      status: CreatorListingStatus.ARCHIVED,
    })
  }

  async suspendListing(listingId: string) {
    return (this as any).updateCreatorListings({
      id: listingId,
      status: CreatorListingStatus.SUSPENDED,
    })
  }

  async upsertPayoutAccount(
    sellerId: string,
    fields: {
      provider?: CreatorPayoutProvider
      external_account_id?: string | null
      onboarding_url?: string | null
      status?: CreatorPayoutStatus
      provider_metadata?: Record<string, unknown> | null
    }
  ) {
    const existing = await this.listCreatorPayoutAccounts({ seller_id: sellerId })
    if (existing.length > 0) {
      return (this as any).updateCreatorPayoutAccounts({
        id: existing[0].id,
        ...fields,
      })
    }

    return (this as any).createCreatorPayoutAccounts({
      seller_id: sellerId,
      provider: fields.provider ?? CreatorPayoutProvider.MANUAL,
      status: fields.status ?? CreatorPayoutStatus.PENDING,
      external_account_id: fields.external_account_id ?? null,
      onboarding_url: fields.onboarding_url ?? null,
      provider_metadata: fields.provider_metadata ?? null,
    })
  }
}

export default MarketplaceListingService
