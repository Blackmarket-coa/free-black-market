import { model } from "@medusajs/framework/utils"

/**
 * Fee Types
 * 
 * Different types of fees in the breakdown
 */
export enum FeeType {
  PRODUCER_PRICE = "PRODUCER_PRICE",       // What producer gets
  PLATFORM_FEE = "PLATFORM_FEE",           // Platform commission
  PAYMENT_PROCESSING = "PAYMENT_PROCESSING", // Stripe/payment fees
  DELIVERY_FEE = "DELIVERY_FEE",           // Delivery/shipping
  COMMUNITY_FUND = "COMMUNITY_FUND",       // Community reinvestment
  TAX = "TAX",                             // Sales tax
  TIP = "TIP",                             // Optional tip
  COOPERATIVE_FEE = "COOPERATIVE_FEE",     // Co-op membership fee
  PICKUP_DISCOUNT = "PICKUP_DISCOUNT",     // Discount for pickup
  CREATOR_COMMISSION = "CREATOR_COMMISSION", // Affiliate share to a creator
  PLUGIN_DEVELOPER_FEE = "PLUGIN_DEVELOPER_FEE", // Share to plugin/theme/emoji-pack developer
  REFERRAL_FEE = "REFERRAL_FEE",           // Generic referral share (distinct from creator commission)
  // An external marketplace's own cut (Faire/Etsy/Amazon), taken before money
  // ever reaches FBM. Distinct from PLATFORM_FEE, which is ours: confusing the
  // two would either double-count our commission or hide theirs.
  CHANNEL_FEE = "CHANNEL_FEE",
}

/**
 * Payout Config
 * 
 * Platform-level configuration for payout calculations.
 * Defines default percentages and fee structures.
 */
const PayoutConfig = model.define("payout_config", {
  id: model.id().primaryKey(),
  
  // Config name/identifier
  name: model.text().unique(),
  
  // Is this the active/default config
  is_default: model.boolean().default(false),
  
  // === Platform Fees ===
  
  // Base platform fee percentage (e.g., 3 = 3%)
  platform_fee_percent: model.number().default(3),
  
  // Minimum platform fee (cents)
  platform_fee_min: model.number().default(0),
  
  // Maximum platform fee (cents, 0 = no max)
  platform_fee_max: model.number().default(0),
  
  // === Payment Processing ===
  
  // Stripe/payment processor percentage
  payment_processing_percent: model.number().default(2.9),
  
  // Fixed payment processing fee (cents)
  payment_processing_fixed: model.number().default(30),
  
  // === Community Fund ===
  
  // Community reinvestment percentage
  community_fund_percent: model.number().default(0),

  // Community fund description
  community_fund_description: model.text().nullable(),

  // === Plugin developer / Referral splits (BMC marketplace layer) ===

  // Plugin/theme/emoji-pack developer share percentage of seller gross
  plugin_developer_percent: model.number().default(0),

  // Referral share percentage of seller gross (separate from creator commission;
  // applies to generic referral programs, e.g. when no AffiliateLink exists)
  referral_percent: model.number().default(0),
  
  // === Producer Payout ===
  
  // Minimum payout threshold (cents)
  min_payout_threshold: model.number().default(0),
  
  // Payout frequency (days)
  payout_frequency_days: model.number().default(7),
  
  // Payout delay (days after order complete)
  payout_delay_days: model.number().default(2),
  
  // === Display Settings ===
  
  // Show fee breakdown to customers
  show_breakdown_to_customers: model.boolean().default(true),
  
  // Show exact percentages
  show_percentages: model.boolean().default(true),
  
  // Customer-facing copy for each fee type
  fee_labels: model.json().nullable(), // Record<FeeType, string>
  
  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["is_default"],
      name: "IDX_payout_config_default",
    },
  ])

export default PayoutConfig
