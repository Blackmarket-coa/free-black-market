import { MedusaService } from "@medusajs/framework/utils"
import {
  PayoutConfig,
  SellerPayoutSettings,
  OrderPayoutBreakdown,
  FeeType,
  BreakdownItem,
} from "./models"
import {
  resolvePlatformFee,
  type ResolvedPlatformFee,
  type SellerFeeOverride,
} from "./fee-resolution"
import {
  computePluginRevenueShare,
  type PluginPayee,
  type PluginShareAllocation,
} from "./plugin-revenue-share"
import {
  computeReferralRevenueShare,
  type ReferralShareAllocation,
} from "./referral-revenue-share"

/**
 * Default fee labels for customer display
 */
const DEFAULT_FEE_LABELS: Record<FeeType, { label: string; description: string }> = {
  [FeeType.PRODUCER_PRICE]: {
    label: "To Producer",
    description: "Goes directly to the person who made/grew this",
  },
  [FeeType.PLATFORM_FEE]: {
    label: "Platform Fee",
    description: "Supports the marketplace and connects you with producers",
  },
  [FeeType.PAYMENT_PROCESSING]: {
    label: "Payment Processing",
    description: "Secure payment handling (Stripe)",
  },
  [FeeType.DELIVERY_FEE]: {
    label: "Delivery",
    description: "Delivery to your location",
  },
  [FeeType.COMMUNITY_FUND]: {
    label: "Community Fund",
    description: "Reinvested in local food systems and producer support",
  },
  [FeeType.TAX]: {
    label: "Tax",
    description: "Sales tax (required by law)",
  },
  [FeeType.TIP]: {
    label: "Tip",
    description: "Your optional tip goes directly to the producer",
  },
  [FeeType.COOPERATIVE_FEE]: {
    label: "Co-op Fee",
    description: "Cooperative membership contribution",
  },
  [FeeType.PICKUP_DISCOUNT]: {
    label: "Pickup Discount",
    description: "Savings for picking up your order",
  },
  [FeeType.CREATOR_COMMISSION]: {
    label: "Creator Commission",
    description: "Affiliate share paid to the creator who referred this sale",
  },
  [FeeType.PLUGIN_DEVELOPER_FEE]: {
    label: "Plugin Developer",
    description: "Share paid to the developer of the plugin / theme / emoji pack",
  },
  [FeeType.REFERRAL_FEE]: {
    label: "Referral",
    description: "Generic referral share for non-affiliate-program referrals",
  },
  [FeeType.CHANNEL_FEE]: {
    label: "Sales channel fee",
    // Named for the vendor, not for us: they need to know a marketplace took
    // this, not that some abstract fee applied. Kept separate from the
    // platform fee so a breakdown never implies we took both.
    description:
      "Commission taken by an external sales channel before payout reaches FBM",
  },
}

/**
 * Calculator input for breakdown
 */
export interface BreakdownInput {
  subtotal: number           // Product subtotal (cents)
  deliveryFee?: number       // Delivery fee (cents)
  tax?: number               // Tax (cents)
  tip?: number               // Tip (cents)
  sellerId?: string          // For single-seller orders
  sellerBreakdown?: Array<{  // For multi-seller orders
    sellerId: string
    subtotal: number
    sellerName?: string
  }>
  customerId?: string
  orderId?: string
  currencyCode?: string
  pickupDiscount?: number    // Discount for pickup (cents, negative)
  // Creator-monetization extension. When set, this commission is funded out
  // of the seller's gross (i.e. it reduces the producer's net), keeping the
  // customer-facing total unchanged.
  creatorCommissionCents?: number
  creatorSellerId?: string
  creatorName?: string
  /**
   * Each seller's billing-plan fee rate, keyed by seller id. Supplied by the
   * caller because this module cannot resolve `vendor-plan` itself; build it
   * with `shared/platform-fee.ts`.
   *
   * Omitting it is not neutral — the breakdown then resolves fees without the
   * plan tier, and the customer-facing breakdown disagrees with the ledger for
   * the same order. Any caller that settles money must pass this.
   */
  planFeePercentBySeller?: Record<string, number | null>
  /**
   * Plugins installed by each seller, keyed by seller id, for the developer
   * revenue share. Supplied by the caller — resolving them needs both
   * `seller_metadata` and `plugin_listing`, neither of which this module owns.
   * Build it with `shared/plugin-payees.ts`.
   *
   * Omitting it means no share is computed and the platform keeps its whole
   * fee, which is the behaviour before this existed.
   */
  pluginsBySeller?: Record<string, PluginPayee[]>
  /**
   * The seller who referred each seller onto the platform, keyed by seller id,
   * for the generic referral share. Supplied by the caller — the attribution
   * lives in `modules/referral`, which this module cannot resolve. Build it
   * with `shared/referral-payees.ts`.
   *
   * Funded out of the platform fee AFTER the plugin share, so it never promises
   * money the platform did not keep. Omitting it (or a null entry) means no
   * referral share for that seller — the behaviour before this existed.
   */
  referralBySeller?: Record<string, { referrer_seller_id: string } | null>
}

class PayoutBreakdownService extends MedusaService({
  PayoutConfig,
  SellerPayoutSettings,
  OrderPayoutBreakdown,
}) {
  /**
   * Get the active/default payout config
   */
  async getDefaultConfig() {
    const configs = await this.listPayoutConfigs({ is_default: true })
    
    if (configs.length > 0) {
      return configs[0]
    }
    
    // Create default config if none exists
    return this.createPayoutConfigs({
      name: "default",
      is_default: true,
      platform_fee_percent: 3,
      payment_processing_percent: 2.9,
      payment_processing_fixed: 30,
      community_fund_percent: 0,
      show_breakdown_to_customers: true,
      show_percentages: true,
    })
  }
  
  /**
   * Get or create seller payout settings
   */
  async getSellerSettings(sellerId: string) {
    const settings = await this.listSellerPayoutSettings({ seller_id: sellerId })
    return settings.length > 0 ? settings[0] : null
  }
  
  /**
   * The platform fee percentage that applies to a seller, with its provenance.
   *
   * `planPercent` is supplied by the caller rather than read here: this is a
   * Medusa module service and cannot resolve `vendor-plan` across the module
   * boundary. `shared/platform-fee.ts` is the composition point that reads the
   * plan and calls through — callers holding a container should use that helper
   * instead of calling this directly.
   *
   * Passing no `planPercent` yields the historical behaviour exactly:
   * seller override, else platform default.
   */
  async getPlatformFeeDetail(
    sellerId: string,
    planPercent: number | null = null
  ): Promise<ResolvedPlatformFee> {
    const config = await this.getDefaultConfig()
    // No settings row exists for most sellers; `getSellerSettings` returns null
    // and `resolvePlatformFee` handles that as "no override".
    const sellerSettings = await this.getSellerSettings(sellerId)

    return resolvePlatformFee({
      override: sellerSettings as SellerFeeOverride,
      planPercent,
      platformDefault: config.platform_fee_percent,
    })
  }

  /**
   * Get effective platform fee for a seller.
   */
  async getEffectivePlatformFee(
    sellerId: string,
    planPercent: number | null = null
  ): Promise<number> {
    const { percent } = await this.getPlatformFeeDetail(sellerId, planPercent)
    return percent
  }

  /**
   * Create or update a seller's payout settings.
   *
   * The writer `createSellerPayoutSettings` never had a call site, so
   * `custom_platform_fee_percent` — which `getEffectivePlatformFee` has always
   * read — could never be set by anything. Upserts on `seller_id` (unique), and
   * only touches the fields provided, so setting an expiry does not silently
   * clear a reason.
   */
  async upsertSellerSettings(
    sellerId: string,
    updates: {
      custom_platform_fee_percent?: number | null
      fee_reduction_reason?: string | null
      fee_reduction_expires_at?: Date | null
      additional_community_contribution?: number
    }
  ) {
    const existing = await this.getSellerSettings(sellerId)

    if (existing) {
      await this.updateSellerPayoutSettings({ id: existing.id, ...updates })
      return this.getSellerSettings(sellerId)
    }

    const created = await this.createSellerPayoutSettings({
      seller_id: sellerId,
      ...updates,
    })
    return Array.isArray(created) ? created[0] : created
  }

  /**
   * Clear a seller's fee override, returning them to their plan's rate (or the
   * platform default). Distinct from setting the percent to 0, which is a real
   * "this seller pays nothing" concession.
   */
  async clearSellerFeeOverride(sellerId: string) {
    return this.upsertSellerSettings(sellerId, {
      custom_platform_fee_percent: null,
      fee_reduction_reason: null,
      fee_reduction_expires_at: null,
    })
  }

  /**
   * Calculate full payout breakdown for an order
   */
  async calculateBreakdown(input: BreakdownInput): Promise<{
    items: BreakdownItem[]
    totals: {
      customerPaid: number
      toProducers: number
      platformFees: number
      paymentProcessing: number
      delivery: number
      communityFund: number
      tax: number
      tip: number
      creatorCommission: number
      pluginDeveloperShare: number
      referralShare: number
    }
    sellerBreakdown: Array<{
      sellerId: string
      sellerName?: string
      gross: number
      fees: number
      net: number
    }>
    /**
     * Who to pay, and how much, out of the platform fee. The caller performs
     * the transfers — this module computes, it does not move money.
     */
    pluginShareAllocations: (PluginShareAllocation & { sellerId: string })[]
    referralShareAllocations: (ReferralShareAllocation & { sellerId: string })[]
  }> {
    const config = await this.getDefaultConfig()
    const items: BreakdownItem[] = []
    const sellerTotals: Array<{
      sellerId: string
      sellerName?: string
      gross: number
      fees: number
      net: number
    }> = []
    
    const totalSubtotal = input.subtotal
    let totalToProducers = 0
    let totalPlatformFees = 0
    let totalCreatorCommission = 0
    let totalPluginDeveloperShare = 0
    const pluginShareAllocations: (PluginShareAllocation & { sellerId: string })[] = []
    let totalReferralShare = 0
    const referralShareAllocations: (ReferralShareAllocation & { sellerId: string })[] = []

    // Handle multi-seller or single-seller
    const sellers = input.sellerBreakdown || [{
      sellerId: input.sellerId || "unknown",
      subtotal: input.subtotal,
      sellerName: undefined,
    }]

    // Creator commission is currently single-creator-per-order and funded out
    // of the first seller's gross. Multi-seller commission splitting can be
    // added later — for now allocate the full commission to the first seller.
    const creatorCommissionTotal = Math.max(0, Math.floor(input.creatorCommissionCents || 0))
    let creatorRemaining = creatorCommissionTotal

    for (const seller of sellers) {
      const platformFeePercent = await this.getEffectivePlatformFee(
        seller.sellerId,
        input.planFeePercentBySeller?.[seller.sellerId] ?? null
      )
      const platformFee = Math.round(seller.subtotal * (platformFeePercent / 100))

      // Check for additional community contribution from seller
      const sellerSettings = await this.getSellerSettings(seller.sellerId)
      const additionalCommunity = sellerSettings?.additional_community_contribution || 0
      const communityFromSeller = Math.round(seller.subtotal * (additionalCommunity / 100))

      // Allocate creator commission against this seller's slice (capped at
      // remaining gross after platform fee + community).
      const sellerGrossAfterPlatform = Math.max(0, seller.subtotal - platformFee - communityFromSeller)
      const creatorForSeller = Math.min(creatorRemaining, sellerGrossAfterPlatform)
      creatorRemaining -= creatorForSeller

      const producerAmount = seller.subtotal - platformFee - communityFromSeller - creatorForSeller

      // Carved out of the platform fee, after it is computed and after the
      // producer's net is fixed — so a developer share can never change what
      // the seller receives, only how the platform's cut is divided.
      const pluginShare = computePluginRevenueShare({
        platformFeeCents: platformFee,
        pluginDeveloperPercent: config.plugin_developer_percent ?? 0,
        sellerSubtotalCents: seller.subtotal,
        plugins: input.pluginsBySeller?.[seller.sellerId] ?? [],
        sellerId: seller.sellerId,
      })
      totalPluginDeveloperShare += pluginShare.total_cents
      for (const allocation of pluginShare.allocations) {
        pluginShareAllocations.push({ ...allocation, sellerId: seller.sellerId })
      }

      // Referral share, funded from what the plugin share LEFT of the platform
      // fee — so the two carve-outs can never together exceed the fee the
      // platform actually kept. Producer net is already fixed above and is
      // untouched by either share.
      const referralShare = computeReferralRevenueShare({
        availablePlatformFeeCents: pluginShare.platform_retained_cents,
        referralPercent: config.referral_percent ?? 0,
        sellerSubtotalCents: seller.subtotal,
        referrerSellerId:
          input.referralBySeller?.[seller.sellerId]?.referrer_seller_id ?? null,
        sellerId: seller.sellerId,
      })
      if (referralShare.allocation) {
        totalReferralShare += referralShare.amount_cents
        referralShareAllocations.push({
          ...referralShare.allocation,
          sellerId: seller.sellerId,
        })
      }

      totalToProducers += producerAmount
      totalPlatformFees += platformFee
      totalCreatorCommission += creatorForSeller

      sellerTotals.push({
        sellerId: seller.sellerId,
        sellerName: seller.sellerName,
        gross: seller.subtotal,
        fees: platformFee + creatorForSeller,
        net: producerAmount,
      })
    }
    
    // Calculate payment processing
    const totalBeforeProcessing = totalSubtotal + (input.deliveryFee || 0) + 
      (input.tax || 0) + (input.tip || 0) + (input.pickupDiscount || 0)
    const paymentProcessing = Math.round(
      totalBeforeProcessing * (config.payment_processing_percent / 100) + 
      config.payment_processing_fixed
    )
    
    // Community fund from platform
    const communityFund = Math.round(totalSubtotal * (config.community_fund_percent / 100))
    
    // Build breakdown items
    const customerPaid = totalBeforeProcessing
    
    // Producer amount item
    items.push({
      type: FeeType.PRODUCER_PRICE,
      amount: totalToProducers,
      percent: Math.round((totalToProducers / customerPaid) * 100),
      label: DEFAULT_FEE_LABELS[FeeType.PRODUCER_PRICE].label,
      description: DEFAULT_FEE_LABELS[FeeType.PRODUCER_PRICE].description,
      recipient: sellers.length === 1 ? sellers[0].sellerName : `${sellers.length} Producers`,
    })
    
    // Platform fee item
    if (totalPlatformFees > 0) {
      items.push({
        type: FeeType.PLATFORM_FEE,
        amount: totalPlatformFees,
        percent: Math.round((totalPlatformFees / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.PLATFORM_FEE].label,
        description: DEFAULT_FEE_LABELS[FeeType.PLATFORM_FEE].description,
        recipient: "Platform",
      })
    }

    // Creator commission item (when an attributed creator referred this sale)
    if (totalCreatorCommission > 0) {
      items.push({
        type: FeeType.CREATOR_COMMISSION,
        amount: totalCreatorCommission,
        percent: Math.round((totalCreatorCommission / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.CREATOR_COMMISSION].label,
        description: DEFAULT_FEE_LABELS[FeeType.CREATOR_COMMISSION].description,
        recipient: input.creatorName ?? "Creator",
      })
    }
    
    // Plugin developer share. Shown as its own line even though it is funded
    // out of the platform fee, because "3% platform fee, 1% of which goes to
    // the developers of the tools this vendor uses" is a more honest statement
    // of where the money went than a single undifferentiated platform line.
    if (totalPluginDeveloperShare > 0) {
      items.push({
        type: FeeType.PLUGIN_DEVELOPER_FEE,
        amount: totalPluginDeveloperShare,
        percent: Math.round((totalPluginDeveloperShare / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.PLUGIN_DEVELOPER_FEE].label,
        description: DEFAULT_FEE_LABELS[FeeType.PLUGIN_DEVELOPER_FEE].description,
        recipient:
          pluginShareAllocations.length === 1
            ? pluginShareAllocations[0].slug
            : `${pluginShareAllocations.length} developers`,
      })
    }

    // Referral share. Its own line for the same reason as the plugin line: it
    // is funded from the platform fee, and naming it is more honest than
    // folding it into an undifferentiated platform cut.
    if (totalReferralShare > 0) {
      items.push({
        type: FeeType.REFERRAL_FEE,
        amount: totalReferralShare,
        percent: Math.round((totalReferralShare / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.REFERRAL_FEE].label,
        description: DEFAULT_FEE_LABELS[FeeType.REFERRAL_FEE].description,
        recipient:
          referralShareAllocations.length === 1
            ? "Referrer"
            : `${referralShareAllocations.length} referrers`,
      })
    }

    // Delivery fee
    if (input.deliveryFee && input.deliveryFee > 0) {
      items.push({
        type: FeeType.DELIVERY_FEE,
        amount: input.deliveryFee,
        percent: Math.round((input.deliveryFee / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.DELIVERY_FEE].label,
        description: DEFAULT_FEE_LABELS[FeeType.DELIVERY_FEE].description,
      })
    }
    
    // Pickup discount
    if (input.pickupDiscount && input.pickupDiscount < 0) {
      items.push({
        type: FeeType.PICKUP_DISCOUNT,
        amount: input.pickupDiscount,
        percent: Math.round((Math.abs(input.pickupDiscount) / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.PICKUP_DISCOUNT].label,
        description: DEFAULT_FEE_LABELS[FeeType.PICKUP_DISCOUNT].description,
      })
    }
    
    // Community fund
    if (communityFund > 0) {
      items.push({
        type: FeeType.COMMUNITY_FUND,
        amount: communityFund,
        percent: Math.round((communityFund / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.COMMUNITY_FUND].label,
        description: config.community_fund_description || DEFAULT_FEE_LABELS[FeeType.COMMUNITY_FUND].description,
        recipient: "Community",
      })
    }
    
    // Tax
    if (input.tax && input.tax > 0) {
      items.push({
        type: FeeType.TAX,
        amount: input.tax,
        percent: Math.round((input.tax / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.TAX].label,
        description: DEFAULT_FEE_LABELS[FeeType.TAX].description,
      })
    }
    
    // Tip
    if (input.tip && input.tip > 0) {
      items.push({
        type: FeeType.TIP,
        amount: input.tip,
        percent: Math.round((input.tip / customerPaid) * 100),
        label: DEFAULT_FEE_LABELS[FeeType.TIP].label,
        description: DEFAULT_FEE_LABELS[FeeType.TIP].description,
        recipient: sellers.length === 1 ? sellers[0].sellerName : "Producers",
      })
    }
    
    return {
      items,
      totals: {
        customerPaid,
        toProducers: totalToProducers + (input.tip || 0),
        platformFees: totalPlatformFees,
        paymentProcessing,
        delivery: input.deliveryFee || 0,
        communityFund,
        tax: input.tax || 0,
        tip: input.tip || 0,
        creatorCommission: totalCreatorCommission,
        pluginDeveloperShare: totalPluginDeveloperShare,
        referralShare: totalReferralShare,
      },
      sellerBreakdown: sellerTotals,
      pluginShareAllocations,
      referralShareAllocations,
    }
  }
  
  /**
   * Store breakdown for an order
   */
  async storeOrderBreakdown(
    orderId: string,
    customerId: string,
    breakdown: Awaited<ReturnType<PayoutBreakdownService["calculateBreakdown"]>>,
    currencyCode: string = "usd"
  ) {
    return this.createOrderPayoutBreakdowns({
      order_id: orderId,
      customer_id: customerId,
      customer_paid: breakdown.totals.customerPaid,
      currency_code: currencyCode,
      breakdown_items: breakdown.items as unknown as Record<string, unknown>,
      total_to_producers: breakdown.totals.toProducers,
      total_platform_fees: breakdown.totals.platformFees,
      total_payment_processing: breakdown.totals.paymentProcessing,
      total_delivery: breakdown.totals.delivery,
      total_community_fund: breakdown.totals.communityFund,
      total_tax: breakdown.totals.tax,
      total_tip: breakdown.totals.tip,
      total_creator_commission: breakdown.totals.creatorCommission ?? 0,
      seller_breakdown: breakdown.sellerBreakdown as unknown as Record<string, unknown>,
    })
  }
  
  /**
   * Get stored breakdown for an order
   */
  async getOrderBreakdown(orderId: string): Promise<{
    items: BreakdownItem[]
    totals: {
      customerPaid: number
      toProducers: number
      platformFees: number
      delivery: number
      communityFund: number
      tax: number
      tip: number
      creatorCommission: number
    }
    sellerBreakdown: Array<{
      sellerId: string
      sellerName?: string
      gross: number
      fees: number
      net: number
    }>
  } | null> {
    const breakdowns = await this.listOrderPayoutBreakdowns({ order_id: orderId })

    if (breakdowns.length === 0) {
      return null
    }

    const breakdown = breakdowns[0]

    return {
      items: (breakdown.breakdown_items as Record<string, unknown>) as unknown as BreakdownItem[],
      totals: {
        customerPaid: Number(breakdown.customer_paid),
        toProducers: Number(breakdown.total_to_producers),
        platformFees: Number(breakdown.total_platform_fees),
        delivery: Number(breakdown.total_delivery),
        communityFund: Number(breakdown.total_community_fund),
        tax: Number(breakdown.total_tax),
        tip: Number(breakdown.total_tip),
        creatorCommission: Number((breakdown as any).total_creator_commission ?? 0),
      },
      sellerBreakdown: (breakdown.seller_breakdown as Record<string, unknown>) as unknown as Array<{
        sellerId: string
        sellerName?: string
        gross: number
        fees: number
        net: number
      }>,
    }
  }
  
  /**
   * Get customer-friendly breakdown display
   */
  getCustomerDisplay(breakdown: Awaited<ReturnType<PayoutBreakdownService["calculateBreakdown"]>>): {
    headline: string
    producerPercent: number
    items: Array<{
      label: string
      amount: string
      percent: string
      description: string
      highlight?: boolean
    }>
  } {
    const producerPercent = Math.round(
      (breakdown.totals.toProducers / breakdown.totals.customerPaid) * 100
    )
    
    return {
      headline: `${producerPercent}% goes directly to the producer`,
      producerPercent,
      items: breakdown.items.map(item => ({
        label: item.label,
        amount: `$${(item.amount / 100).toFixed(2)}`,
        percent: `${item.percent}%`,
        description: item.description,
        highlight: item.type === FeeType.PRODUCER_PRICE,
      })),
    }
  }
  
  /**
   * Compare price vs grocery store equivalent
   */
  async getPriceComparison(
    productPrice: number,
    groceryEquivalent?: number
  ): Promise<{
    directPrice: number
    groceryPrice?: number
    savings?: number
    savingsPercent?: number
    message: string
  }> {
    const config = await this.getDefaultConfig()
    const platformFee = productPrice * (config.platform_fee_percent / 100)
    const toProducer = productPrice - platformFee
    
    if (groceryEquivalent) {
      const savings = groceryEquivalent - productPrice
      const savingsPercent = Math.round((savings / groceryEquivalent) * 100)
      
      return {
        directPrice: productPrice / 100,
        groceryPrice: groceryEquivalent / 100,
        savings: savings / 100,
        savingsPercent,
        message: savings > 0 
          ? `Save ${savingsPercent}% vs grocery store while paying the producer directly`
          : `Pay only ${Math.abs(savingsPercent)}% more to support a local producer directly`,
      }
    }
    
    return {
      directPrice: productPrice / 100,
      message: `You're paying the producer directly - they receive $${(toProducer / 100).toFixed(2)} of your $${(productPrice / 100).toFixed(2)}`,
    }
  }
}

export default PayoutBreakdownService
