import { MedusaService } from "@medusajs/framework/utils"
import { 
  BuyerImpact, 
  ProducerImpact, 
  BuyerBadge, 
  OrderImpact,
  BuyerBadgeType,
} from "./models"
import { 
  OrderImpactData, 
  ProducerBreakdownItem, 
  BadgeRequirements 
} from "../../shared/types"

/**
 * Default buyer badges to seed
 */
export const DEFAULT_BUYER_BADGES: Array<{
  badge_type: BuyerBadgeType
  name: string
  description: string
  icon: string
  color: string
  requirements: BadgeRequirements
  display_order: number
}> = [
  {
    badge_type: BuyerBadgeType.FIRST_PURCHASE,
    name: "First Purchase",
    description: "Welcome! You've made your first purchase directly from a producer.",
    icon: "shopping-bag",
    color: "#10B981",
    requirements: { total_orders: 1 },
    display_order: 10,
  },
  {
    badge_type: BuyerBadgeType.LOCAL_SUPPORTER,
    name: "Local Supporter",
    description: "You've made 5+ purchases from local producers.",
    icon: "map-pin",
    color: "#3B82F6",
    requirements: { local_orders: 5 },
    display_order: 20,
  },
  {
    badge_type: BuyerBadgeType.CO_OP_BUYER,
    name: "Co-op Buyer",
    description: "You're part of a cooperative buying group.",
    icon: "users",
    color: "#8B5CF6",
    requirements: { is_coop_member: true },
    display_order: 30,
  },
  {
    badge_type: BuyerBadgeType.REGENERATIVE_PATRON,
    name: "Regenerative Patron",
    description: "You've supported farms using regenerative practices.",
    icon: "leaf",
    color: "#22C55E",
    requirements: { regenerative_orders: 3 },
    display_order: 40,
  },
  {
    badge_type: BuyerBadgeType.SUBSCRIPTION_SUPPORTER,
    name: "Subscription Supporter",
    description: "You have an active subscription with a producer.",
    icon: "refresh",
    color: "#F59E0B",
    requirements: { has_active_subscription: true },
    display_order: 50,
  },
  {
    badge_type: BuyerBadgeType.COMMUNITY_CHAMPION,
    name: "Community Champion",
    description: "You've sent $500+ directly to producers!",
    icon: "star",
    color: "#EC4899",
    requirements: { total_to_producers: 50000 }, // cents
    display_order: 60,
  },
  {
    badge_type: BuyerBadgeType.PRODUCER_PARTNER,
    name: "Producer Partner",
    description: "You've sent $1,000+ directly to producers!",
    icon: "trophy",
    color: "#EAB308",
    requirements: { total_to_producers: 100000 }, // cents
    display_order: 70,
  },
  {
    badge_type: BuyerBadgeType.LOYAL_CUSTOMER,
    name: "Loyal Customer",
    description: "You've been supporting producers for 12+ months.",
    icon: "clock",
    color: "#6366F1",
    requirements: { months_active: 12 },
    display_order: 80,
  },
  {
    badge_type: BuyerBadgeType.IMPACT_LEADER,
    name: "Impact Leader",
    description: "You're in the top 10% of supporters by impact.",
    icon: "trending-up",
    color: "#DC2626",
    requirements: { percentile: 90 },
    display_order: 90,
  },
  {
    badge_type: BuyerBadgeType.REFERRAL_STAR,
    name: "Referral Star",
    description: "You've referred 5+ new customers to the platform.",
    icon: "share",
    color: "#0891B2",
    requirements: { referrals: 5 },
    display_order: 100,
  },
]

/**
 * Platform-wide impact metrics
 */
export interface PlatformImpact {
  totalToProducers: number
  totalOrders: number
  totalCustomers: number
  totalProducers: number
  avgMilesSaved: number
  localOrderPercent: number
}

class ImpactMetricsService extends MedusaService({
  BuyerImpact,
  ProducerImpact,
  BuyerBadge,
  OrderImpact,
}) {
  /**
   * Get or create buyer impact record
   */
  async getOrCreateBuyerImpact(customerId: string) {
    const existing = await this.listBuyerImpacts({
      customer_id: customerId,
    })
    
    if (existing.length > 0) {
      return existing[0]
    }
    
    return this.createBuyerImpacts({
      customer_id: customerId,
    })
  }
  
  /**
   * Get or create producer impact record
   */
  async getOrCreateProducerImpact(sellerId: string) {
    const existing = await this.listProducerImpacts({
      seller_id: sellerId,
    })
    
    if (existing.length > 0) {
      return existing[0]
    }
    
    return this.createProducerImpacts({
      seller_id: sellerId,
    })
  }
  
  /**
   * Record impact from a completed order
   */
  async recordOrderImpact(data: {
    order_id: string
    customer_id: string
    order_total: number
    producer_breakdown: Array<{
      seller_id: string
      amount: number
      percentage: number
    }>
    platform_fee: number
    delivery_fee?: number
    community_reinvestment?: number
    tip_amount?: number
    food_miles?: number
    is_repeat?: boolean
    order_type?: "ONE_TIME" | "SUBSCRIPTION" | "PRE_ORDER" | "STANDING"
  }) {
    const producerAmount = data.producer_breakdown.reduce((sum, p) => sum + p.amount, 0)
    const avgGroceryMiles = 1500 // Average food in US travels 1500 miles
    const milesSaved = Math.max(0, avgGroceryMiles - (data.food_miles || 50))
    
    // Create order impact record
    const orderImpact = await this.createOrderImpacts({
      order_id: data.order_id,
      customer_id: data.customer_id,
      order_total: data.order_total,
      producer_amount: producerAmount,
      platform_fee: data.platform_fee,
      delivery_fee: data.delivery_fee || 0,
      community_reinvestment: data.community_reinvestment || 0,
      tip_amount: data.tip_amount || 0,
      producer_breakdown: data.producer_breakdown as unknown as Record<string, unknown>,
      food_miles: data.food_miles || 50,
      miles_saved: milesSaved,
      is_local: (data.food_miles || 50) < 100,
      is_repeat: data.is_repeat || false,
      order_type: data.order_type || "ONE_TIME",
    })
    
    // Update buyer impact
    await this.updateBuyerImpactFromOrder(data.customer_id, orderImpact, data.producer_breakdown)
    
    // Update producer impacts
    for (const producer of data.producer_breakdown) {
      await this.updateProducerImpactFromOrder(producer.seller_id, producer.amount, data.customer_id)
    }
    
    // Check and grant badges
    await this.checkAndGrantBuyerBadges(data.customer_id)
    
    return orderImpact
  }
  
  /**
   * Update buyer impact from an order
   */
  private async updateBuyerImpactFromOrder(
    customerId: string,
    orderImpact: OrderImpactData,
    producerBreakdown: ProducerBreakdownItem[]
  ): Promise<void> {
    const buyerImpact = await this.getOrCreateBuyerImpact(customerId)
    
    // Get current producer IDs
    const currentProducerIds = Array.isArray(buyerImpact.producer_ids) 
      ? (buyerImpact.producer_ids as unknown as string[])
      : []
    const newProducerIds = producerBreakdown.map(p => p.seller_id)
    const uniqueProducerIds = [...new Set([...currentProducerIds, ...newProducerIds])]
    
    const isFirstPurchase = !buyerImpact.first_purchase_at
    
    await this.updateBuyerImpacts({
      id: buyerImpact.id,
      total_spent: Number(buyerImpact.total_spent) + Number(orderImpact.order_total),
      total_to_producers: Number(buyerImpact.total_to_producers) + Number(orderImpact.producer_amount),
      total_platform_fees: Number(buyerImpact.total_platform_fees) + Number(orderImpact.platform_fee),
      total_community_reinvestment: Number(buyerImpact.total_community_reinvestment) + Number(orderImpact.community_reinvestment),
      unique_producers_supported: uniqueProducerIds.length,
      producer_ids: uniqueProducerIds as unknown as Record<string, unknown>,
      estimated_miles_saved: buyerImpact.estimated_miles_saved + orderImpact.miles_saved,
      total_orders: buyerImpact.total_orders + 1,
      repeat_orders: buyerImpact.repeat_orders + (orderImpact.is_repeat ? 1 : 0),
      subscription_orders: buyerImpact.subscription_orders + 
        (orderImpact.order_type === "SUBSCRIPTION" ? 1 : 0),
      first_purchase_at: isFirstPurchase ? new Date() : buyerImpact.first_purchase_at,
      last_purchase_at: new Date(),
    })
  }
  
  /**
   * Update producer impact from an order
   */
  private async updateProducerImpactFromOrder(
    sellerId: string,
    amount: number,
    _customerId: string
  ): Promise<void> {
    const producerImpact = await this.getOrCreateProducerImpact(sellerId)
    
    // Simple customer tracking (would be more sophisticated in production)
    const isNewCustomer = true // Would need to check order history
    const isFirstSale = !producerImpact.first_sale_at
    
    await this.updateProducerImpacts({
      id: producerImpact.id,
      total_revenue: Number(producerImpact.total_revenue) + amount,
      total_payout: Number(producerImpact.total_payout) + amount, // Simplified
      total_orders: producerImpact.total_orders + 1,
      total_customers: isNewCustomer 
        ? producerImpact.total_customers + 1 
        : producerImpact.total_customers,
      first_sale_at: isFirstSale ? new Date() : producerImpact.first_sale_at,
      last_sale_at: new Date(),
    })
  }
  
  /**
   * Check and grant badges to a buyer
   */
  async checkAndGrantBuyerBadges(customerId: string): Promise<string[]> {
    const buyerImpact = await this.getOrCreateBuyerImpact(customerId)
    const allBadges = await this.listBuyerBadges({ active: true })
    const earnedBadgesRaw = buyerImpact.badges as Record<string, unknown> | null
    const earnedBadges: Array<{ badge_type: string; earned_at: Date }> = Array.isArray(earnedBadgesRaw) 
      ? (earnedBadgesRaw as unknown as Array<{ badge_type: string; earned_at: Date }>)
      : []
    const earnedTypes = new Set(earnedBadges.map(b => b.badge_type))
    
    const newlyEarned: string[] = []
    
    for (const badge of allBadges) {
      if (earnedTypes.has(badge.badge_type)) continue
      
      const requirements = badge.requirements as Record<string, unknown>
      let earned = false
      
      // Check requirements
      if (requirements.total_orders && buyerImpact.total_orders >= (requirements.total_orders as number)) {
        earned = true
      }
      if (requirements.total_to_producers && Number(buyerImpact.total_to_producers) >= (requirements.total_to_producers as number)) {
        earned = true
      }
      if (requirements.months_active && buyerImpact.months_active >= (requirements.months_active as number)) {
        earned = true
      }
      // Add more requirement checks as needed
      
      if (earned) {
        earnedBadges.push({
          badge_type: badge.badge_type,
          earned_at: new Date(),
        })
        newlyEarned.push(badge.badge_type)
      }
    }
    
    if (newlyEarned.length > 0) {
      await this.updateBuyerImpacts({
        id: buyerImpact.id,
        badges: earnedBadges as unknown as Record<string, unknown>,
      })
    }
    
    return newlyEarned
  }
  
  /**
   * Get buyer's impact summary for display
   */
  async getBuyerImpactSummary(customerId: string): Promise<{
    dollarsToProducers: number
    producersSupported: number
    milesSaved: number
    totalOrders: number
    monthsActive: number
    badges: Array<{
      type: string
      name: string
      description: string
      icon: string
      color: string
      earnedAt?: Date
    }>
  }> {
    const buyerImpact = await this.getOrCreateBuyerImpact(customerId)
    const allBadges = await this.listBuyerBadges({ active: true })
    const earnedBadgesRaw = buyerImpact.badges as Record<string, unknown> | null
    const earnedBadges: Array<{ badge_type: string; earned_at?: Date }> = Array.isArray(earnedBadgesRaw) 
      ? (earnedBadgesRaw as unknown as Array<{ badge_type: string; earned_at?: Date }>)
      : []
    
    const badgesWithDetails = earnedBadges.map(earned => {
      const badge = allBadges.find(b => b.badge_type === earned.badge_type)
      return {
        type: earned.badge_type,
        name: badge?.name || earned.badge_type,
        description: badge?.description || "",
        icon: badge?.icon || "badge",
        color: badge?.color || "#6B7280",
        earnedAt: earned.earned_at,
      }
    })
    
    return {
      dollarsToProducers: Number(buyerImpact.total_to_producers) / 100,
      producersSupported: buyerImpact.unique_producers_supported,
      milesSaved: buyerImpact.estimated_miles_saved,
      totalOrders: buyerImpact.total_orders,
      monthsActive: buyerImpact.months_active,
      badges: badgesWithDetails,
    }
  }
  
  /**
   * Get producer's impact summary for dashboard
   */
  async getProducerImpactSummary(sellerId: string): Promise<{
    totalRevenue: number
    totalPayout: number
    totalOrders: number
    totalCustomers: number
    repeatCustomers: number
    repeatCustomerPercent: number
    revenueStabilityScore: number
    subscriptionRevenuePercent: number
    fulfillmentReliability: number
    avgOrderValue: number
    monthsActive: number
  }> {
    const producerImpact = await this.getOrCreateProducerImpact(sellerId)
    
    return {
      totalRevenue: Number(producerImpact.total_revenue) / 100,
      totalPayout: Number(producerImpact.total_payout) / 100,
      totalOrders: producerImpact.total_orders,
      totalCustomers: producerImpact.total_customers,
      repeatCustomers: producerImpact.repeat_customers,
      repeatCustomerPercent: producerImpact.total_customers > 0
        ? (producerImpact.repeat_customers / producerImpact.total_customers) * 100
        : 0,
      revenueStabilityScore: producerImpact.revenue_stability_score,
      subscriptionRevenuePercent: producerImpact.subscription_revenue_percent,
      fulfillmentReliability: producerImpact.fulfillment_reliability,
      avgOrderValue: Number(producerImpact.avg_order_value) / 100,
      monthsActive: producerImpact.months_active,
    }
  }
  
  /**
   * Generate impact receipt for an order
   */
  async generateImpactReceipt(orderId: string): Promise<{
    orderTotal: number
    breakdown: {
      toProducers: { amount: number; percent: number }
      platformFee: { amount: number; percent: number }
      delivery: { amount: number; percent: number }
      communityReinvestment: { amount: number; percent: number }
    }
    producers: Array<{
      sellerId: string
      amount: number
      percent: number
    }>
    environmental: {
      foodMiles: number
      milesSaved: number
      isLocal: boolean
    }
  } | null> {
    const impacts = await this.listOrderImpacts({ order_id: orderId })
    
    if (impacts.length === 0) {
      return null
    }
    
    const impact = impacts[0]
    const orderTotal = Number(impact.order_total)
    
    return {
      orderTotal: orderTotal / 100,
      breakdown: {
        toProducers: {
          amount: Number(impact.producer_amount) / 100,
          percent: (Number(impact.producer_amount) / orderTotal) * 100,
        },
        platformFee: {
          amount: Number(impact.platform_fee) / 100,
          percent: (Number(impact.platform_fee) / orderTotal) * 100,
        },
        delivery: {
          amount: Number(impact.delivery_fee) / 100,
          percent: (Number(impact.delivery_fee) / orderTotal) * 100,
        },
        communityReinvestment: {
          amount: Number(impact.community_reinvestment) / 100,
          percent: (Number(impact.community_reinvestment) / orderTotal) * 100,
        },
      },
      producers: ((impact.producer_breakdown as Record<string, unknown>) as unknown as Array<{ seller_id: string; amount: number; percentage: number }>).map(p => ({
        sellerId: p.seller_id,
        amount: p.amount / 100,
        percent: p.percentage,
      })),
      environmental: {
        foodMiles: impact.food_miles,
        milesSaved: impact.miles_saved,
        isLocal: impact.is_local,
      },
    }
  }
  
  /**
   * Seed default buyer badges
   */
  async seedDefaultBadges(): Promise<void> {
    for (const badge of DEFAULT_BUYER_BADGES) {
      const existing = await this.listBuyerBadges({ badge_type: badge.badge_type })
      if (existing.length === 0) {
        await this.createBuyerBadges(badge)
      }
    }
  }
}

export default ImpactMetricsService
