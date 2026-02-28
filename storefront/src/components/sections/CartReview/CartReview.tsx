"use client"

import PaymentButton from "./PaymentButton"
import { CartItems } from "./CartItems"
import { CartSummary } from "@/components/organisms"
import { TrustWidget } from "@/components/sections/TrustWidget"
import DonationPreferences from "./DonationPreferences"
import StorefrontSwitcher from "./StorefrontSwitcher"
import { DonationBeneficiary, PublicStorefront } from "@/lib/data/donations"

const Review = ({
  cart,
  beneficiaries,
  donationSettings,
  storefronts,
  donationFeatureGates,
}: {
  cart: any
  beneficiaries: DonationBeneficiary[]
  donationSettings: { default_percentage: number; round_up_enabled: boolean }
  storefronts: PublicStorefront[]
  donationFeatureGates?: { donation_routing: boolean; advanced_automation: boolean }
}) => {
  const paidByGiftcard =
    cart?.gift_cards && cart?.gift_cards?.length > 0 && cart?.total === 0

  const previousStepsCompleted =
    cart.shipping_address &&
    cart.shipping_methods.length > 0 &&
    (cart.payment_collection || paidByGiftcard)

  const firstSeller = cart?.items?.[0]?.product?.seller?.name

  return (
    <div>
      <div className="w-full mb-6">
        <CartItems cart={cart} />
      </div>
      <div className="w-full mb-6 border rounded-sm p-4">
        <CartSummary
          item_total={cart?.item_subtotal || 0}
          shipping_total={cart?.shipping_subtotal || 0}
          total={cart?.total || 0}
          currency_code={cart?.currency_code || ""}
          tax={cart?.tax_total || 0}
          discount_total={cart?.discount_total || 0}
        />
      </div>

      <StorefrontSwitcher storefronts={storefronts} />

      {donationFeatureGates?.donation_routing ? (
        <DonationPreferences
          cartTotal={cart?.total || 0}
          beneficiaries={beneficiaries}
          defaultPercent={donationSettings?.default_percentage || 0}
          roundUpEnabled={Boolean(donationSettings?.round_up_enabled)}
          initialMetadata={(cart?.metadata as Record<string, any>) || {}}
        />
      ) : (
        <div className="w-full mb-6 border rounded-sm p-4 bg-gray-50 text-sm text-gray-600">
          Donation routing is unavailable for the selected storefront tier.
        </div>
      )}

      <div className="w-full mb-6">
        <TrustWidget
          cartTotal={cart?.total || 0}
          currencyCode={cart?.currency_code || "USD"}
          producerName={firstSeller}
          producerPercentage={97}
          platformPercentage={3}
        />
      </div>

      {previousStepsCompleted && (
        <PaymentButton cart={cart} data-testid="submit-order-button" />
      )}
    </div>
  )
}

export default Review
