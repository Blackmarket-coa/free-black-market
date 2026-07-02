import { CustomerTierType } from "../vendor-rules/models/vendor-customer-tier"

/**
 * Per-channel wholesale pricing for the nursery vertical.
 *
 * FBM has no Medusa price-list subsystem; wholesale/per-channel pricing is the
 * existing `vendor_customer_tier` mechanism (see the `vendor-rules` module and
 * the `wholesale-application` model's note: "no new pricing system"). The three
 * nursery channels are therefore expressed as WHOLESALE-family tiers,
 * distinguished by a `metadata.channel` key — reusing discount %, payment terms,
 * and order-minimum handling already wired into orders. We add NO parallel
 * pricing table.
 */
export const NURSERY_CHANNELS = {
  APOTHECARY: "apothecary",
  RETAIL_SHOP: "retail_shop",
  FOOD_FOREST_INSTALLER: "food_forest_installer",
} as const

export type NurseryChannel = (typeof NURSERY_CHANNELS)[keyof typeof NURSERY_CHANNELS]

export const NURSERY_CHANNEL_LABELS: Record<NurseryChannel, string> = {
  [NURSERY_CHANNELS.APOTHECARY]: "Apothecary",
  [NURSERY_CHANNELS.RETAIL_SHOP]: "Retail Shop",
  [NURSERY_CHANNELS.FOOD_FOREST_INSTALLER]: "Food-Forest Installer",
}

export interface NurseryChannelTierInput {
  channel: NurseryChannel
  discountPercent: number
  paymentTermsDays?: number
  minMonthlyOrder?: number
}

/**
 * Build a `vendor_customer_tier` create-input for a nursery channel. The caller
 * passes the result straight to `vendorRulesModuleService.createVendorCustomerTiers`.
 * Keeping this a pure builder means the wiring is testable and the nursery
 * module never re-implements pricing.
 */
export function buildChannelTierInput(
  sellerId: string,
  input: NurseryChannelTierInput
) {
  return {
    seller_id: sellerId,
    tier_type: CustomerTierType.WHOLESALE,
    name: NURSERY_CHANNEL_LABELS[input.channel],
    description: `Wholesale pricing for ${NURSERY_CHANNEL_LABELS[input.channel]} accounts`,
    discount_percent: input.discountPercent,
    payment_terms_days: input.paymentTermsDays ?? 0,
    min_monthly_order: input.minMonthlyOrder ?? 0,
    requires_application: true,
    metadata: { channel: input.channel, vertical: "nursery" },
  }
}
