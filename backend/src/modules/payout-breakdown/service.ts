import { MedusaService } from "@medusajs/framework/utils"
import { 
  PayoutConfig, 
  SellerPayoutSettings, 
  OrderPayoutBreakdown,
  FeeType,
  BreakdownItem,
} from "./models"

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
   * Get effective platform fee for a seller
   */
  async getEffectivePlatformFee(sellerId: string): Promise<number> {
    const config = await this.getDefaultConfig()
    const sellerSettings = await this.getSellerSettings(sellerId)
    
    // Check for custom fee that's still valid.
    // Guard on sellerSettings itself: when no settings row exists (the default
    // for every seller today — createSellerPayoutSettings has no call site),
    // getSellerSettings returns null and `null?.custom_platform_fee_percent !== null`
    // is `undefined !== null` → true, which previously fell through to a
    // non-null assertion and threw a TypeError swallowed by the order subscriber.
    if (
      sellerSettings &&
      sellerSettings.custom_platform_fee_percent !== null &&
      sellerSettings.custom_platform_fee_percent !== undefined
    ) {
      const expiresAt = sellerSettings.fee_reduction_expires_at
      if (!expiresAt || new Date(expiresAt) > new Date()) {
        return sellerSettings.custom_platform_fee_percent
      }
    }
    
    return config.platform_fee_percent
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
    }
    sellerBreakdown: Array<{
      sellerId: string
      sellerName?: string
      gross: number
      fees: number
      net: number
    }>
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
      const platformFeePercent = await this.getEffectivePlatformFee(seller.sellerId)
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
      },
      sellerBreakdown: sellerTotals,
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
