import { model } from "@medusajs/framework/utils"
import { FeeType } from "./payout-config"

/**
 * Order Payout Breakdown
 * 
 * Complete breakdown of where money goes for an order.
 * Stored for each order for transparency and reporting.
 */
const OrderPayoutBreakdown = model.define("order_payout_breakdown", {
  id: model.id().primaryKey(),
  
  // Link to order
  order_id: model.text().unique(),
  
  // Link to customer (for lookup)
  customer_id: model.text(),
  
  // === Order Totals ===
  
  // What customer paid
  customer_paid: model.bigNumber(),
  
  // Currency
  currency_code: model.text().default("usd"),
  
  // === Breakdown Items ===
  // Each item has: type, amount (cents), percent, label, description
  breakdown_items: model.json(), // Array<BreakdownItem>
  
  // === Summary Amounts ===
  
  // Total to producer(s)
  total_to_producers: model.bigNumber(),
  
  // Total platform fees
  total_platform_fees: model.bigNumber(),
  
  // Total payment processing
  total_payment_processing: model.bigNumber(),
  
  // Total delivery
  total_delivery: model.bigNumber().default(0),
  
  // Total community fund
  total_community_fund: model.bigNumber().default(0),
  
  // Total tax
  total_tax: model.bigNumber().default(0),
  
  // Total tip
  total_tip: model.bigNumber().default(0),

  // Total creator commission (affiliate share funded out of seller gross)
  total_creator_commission: model.bigNumber().default(0),

  // Total share to plugin/theme/emoji-pack developers
  total_to_plugin_developers: model.bigNumber().default(0),

  // Total share to generic referrers (non-affiliate-program referrals)
  total_to_referrers: model.bigNumber().default(0),

  /**
   * Per-level referrer split for multi-level referral chains. When
   * FBM_MULTILEVEL_REFERRALS=1 and an order has L2/L3 referrers, this
   * captures the per-seller per-level cents amounts that summed give
   * total_to_referrers. Shape:
   *   [{ level: 2, seller_id: "sel_...", amount_cents: 1500 }, ...]
   */
  referrer_levels: model.json().nullable(),

  // === Per-Seller Breakdown ===
  // For multi-vendor orders
  seller_breakdown: model.json(), // Array<{ seller_id, amount, fees }>
  
  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["order_id"],
      name: "IDX_opb_order_id",
    },
    {
      on: ["customer_id"],
      name: "IDX_opb_customer_id",
    },
    {
      on: ["created_at"],
      name: "IDX_opb_created_at",
    },
  ])

export default OrderPayoutBreakdown

/**
 * Breakdown Item Interface
 */
export interface BreakdownItem {
  type: FeeType
  amount: number      // cents
  percent: number     // percentage of total
  label: string       // Customer-facing label
  description: string // Explanation
  recipient?: string  // Who receives this (producer name, "Platform", etc.)
}
