import { MedusaService } from "@medusajs/framework/utils"
import { 
  VendorRules, 
  FulfillmentWindow, 
  VendorCustomerTier,
  StandingOrder,
  FulfillmentMethod,
} from "./models"

/**
 * Order validation result
 */
export interface OrderValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Fulfillment options for display
 */
export interface FulfillmentOption {
  id: string
  type: FulfillmentMethod
  name: string
  date: Date
  timeWindow?: string
  additionalFee: number
  available: boolean
  capacityRemaining?: number
  location?: string
  instructions?: string
}

class VendorRulesService extends MedusaService({
  VendorRules,
  FulfillmentWindow,
  VendorCustomerTier,
  StandingOrder,
}) {
  /**
   * Get or create vendor rules
   */
  async getOrCreateRules(sellerId: string) {
    const existing = await this.listVendorRules({ seller_id: sellerId })
    
    if (existing.length > 0) {
      return existing[0]
    }
    
    return this.createVendorRules({
      seller_id: sellerId,
      allowed_fulfillment_methods: [FulfillmentMethod.DELIVERY, FulfillmentMethod.PICKUP] as unknown as Record<string, unknown>,
    })
  }
  
  /**
   * Validate an order against vendor rules
   */
  async validateOrder(
    sellerId: string,
    order: {
      total: number
      item_count: number
      delivery_address?: { lat: number; lng: number }
      fulfillment_method: FulfillmentMethod
      customer_id?: string
    }
  ): Promise<OrderValidation> {
    const rules = await this.getOrCreateRules(sellerId)
    const errors: string[] = []
    const warnings: string[] = []
    
    // Check if accepting orders
    if (!rules.accepting_orders) {
      errors.push(rules.pause_message || "This vendor is not currently accepting orders")
      return { valid: false, errors, warnings }
    }
    
    // Check minimum order value
    if (rules.min_order_value > 0 && order.total < rules.min_order_value) {
      errors.push(`Minimum order value is $${(rules.min_order_value / 100).toFixed(2)}`)
    }
    
    // Check minimum items
    if (rules.min_order_items > 1 && order.item_count < rules.min_order_items) {
      errors.push(`Minimum ${rules.min_order_items} items required`)
    }
    
    // Check fulfillment method
    const allowedMethodsRaw = rules.allowed_fulfillment_methods as Record<string, unknown> | null
    const allowedMethods: FulfillmentMethod[] = Array.isArray(allowedMethodsRaw)
      ? (allowedMethodsRaw as unknown as FulfillmentMethod[])
      : []
    if (!allowedMethods.includes(order.fulfillment_method)) {
      errors.push(`${order.fulfillment_method} is not available from this vendor`)
    }
    
    // Check delivery distance (would need geo calculation)
    if (order.fulfillment_method === FulfillmentMethod.DELIVERY && 
        rules.max_delivery_distance > 0 && 
        order.delivery_address) {
      // Would calculate distance here
      // If distance > rules.max_delivery_distance, add error
    }
    
    // Check daily/weekly order limits
    // Would need to query order counts here
    
    // Check customer tier for benefits
    if (order.customer_id) {
      const tier = await this.getCustomerTier(sellerId, order.customer_id)
      if (tier) {
        if (tier.waive_order_minimum && errors.some(e => e.includes("Minimum order"))) {
          // Remove minimum order error for this tier
          const idx = errors.findIndex(e => e.includes("Minimum order"))
          if (idx !== -1) {
            errors.splice(idx, 1)
            warnings.push(`Minimum order waived for ${tier.name} members`)
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
  
  /**
   * Get available fulfillment options
   */
  async getFulfillmentOptions(
    sellerId: string,
    options: {
      startDate?: Date
      days?: number
      fulfillmentType?: FulfillmentMethod
    } = {}
  ): Promise<FulfillmentOption[]> {
    const rules = await this.getOrCreateRules(sellerId)
    const windows = await this.listFulfillmentWindows({
      seller_id: sellerId,
      active: true,
      ...(options.fulfillmentType && { fulfillment_type: options.fulfillmentType }),
    })
    
    const startDate = options.startDate || new Date()
    const days = options.days || 14
    const result: FulfillmentOption[] = []
    
    // Generate options for each day
    for (let d = 0; d < days; d++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + d)
      const dayOfWeek = date.getDay()
      
      // Check if past lead time
      const hoursSinceNow = (date.getTime() - Date.now()) / (1000 * 60 * 60)
      if (hoursSinceNow < rules.lead_time_hours) {
        continue
      }
      
      // Find windows for this day
      const dayWindows = windows.filter(w => w.day_of_week === dayOfWeek)
      
      for (const window of dayWindows) {
        // Check if past cutoff
        const windowDate = new Date(date)
        const [startHour, startMin] = window.start_time.split(":").map(Number)
        windowDate.setHours(startHour, startMin, 0, 0)
        
        const hoursTilWindow = (windowDate.getTime() - Date.now()) / (1000 * 60 * 60)
        if (hoursTilWindow < window.cutoff_hours) {
          continue
        }
        
        // Check capacity
        const capacityRemaining = window.capacity > 0 
          ? window.capacity - window.current_bookings 
          : undefined
        const available = capacityRemaining === undefined || capacityRemaining > 0
        
        result.push({
          id: window.id,
          type: window.fulfillment_type as FulfillmentMethod,
          name: window.name,
          date: windowDate,
          timeWindow: `${window.start_time} - ${window.end_time}`,
          additionalFee: window.additional_fee,
          available,
          capacityRemaining,
          location: window.pickup_location || undefined,
          instructions: window.pickup_instructions || undefined,
        })
      }
    }
    
    return result.sort((a, b) => a.date.getTime() - b.date.getTime())
  }
  
  /**
   * Get customer tier for a customer with a vendor
   */
  async getCustomerTier(
    sellerId: string,
    customerId: string
  ) {
    const tiers = await this.listVendorCustomerTiers({
      seller_id: sellerId,
      active: true,
    })
    
    for (const tier of tiers) {
      const customerIdsRaw = tier.customer_ids as Record<string, unknown> | null
      const customerIds: string[] = Array.isArray(customerIdsRaw)
        ? (customerIdsRaw as unknown as string[])
        : []
      if (customerIds.includes(customerId)) {
        return tier
      }
    }
    
    return null
  }
  
  /**
   * Add customer to tier
   */
  async addCustomerToTier(
    tierId: string,
    customerId: string
  ): Promise<void> {
    const tier = await this.retrieveVendorCustomerTier(tierId)
    const customerIdsRaw = tier.customer_ids as Record<string, unknown> | null
    const currentIds: string[] = Array.isArray(customerIdsRaw)
      ? (customerIdsRaw as unknown as string[])
      : []
    
    if (!currentIds.includes(customerId)) {
      await this.updateVendorCustomerTiers({
        id: tierId,
        customer_ids: [...currentIds, customerId] as unknown as Record<string, unknown>,
      })
    }
  }
  
  /**
   * Create a standing order
   */
  async createStandingOrder(data: {
    seller_id: string
    customer_id: string
    name: string
    frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM"
    day_of_week?: number
    day_of_month?: number
    custom_frequency_days?: number
    start_date: Date
    line_items: Array<{ variant_id: string; quantity: number; price_override?: number }>
    order_value: number
    fulfillment_method: string
    fulfillment_window_id?: string
    customer_notes?: string
  }) {
    // Calculate first order date
    const nextOrderDate = new Date(data.start_date)
    
    return this.createStandingOrders({
      seller_id: data.seller_id,
      customer_id: data.customer_id,
      name: data.name,
      frequency: data.frequency,
      day_of_week: data.day_of_week,
      day_of_month: data.day_of_month,
      custom_frequency_days: data.custom_frequency_days,
      start_date: data.start_date,
      line_items: data.line_items as unknown as Record<string, unknown>,
      order_value: data.order_value,
      fulfillment_method: data.fulfillment_method,
      fulfillment_window_id: data.fulfillment_window_id,
      customer_notes: data.customer_notes,
      next_order_date: nextOrderDate,
      status: "ACTIVE",
    })
  }
  
  /**
   * Get standing orders due for processing
   */
  async getDueStandingOrders() {
    const now = new Date()
    const orders = await this.listStandingOrders({
      status: "ACTIVE",
      // next_order_date <= now - would need custom query
    })
    
    return orders.filter(o => 
      o.next_order_date && new Date(o.next_order_date) <= now
    )
  }
  
  /**
   * Calculate next order date for a standing order
   */
  calculateNextOrderDate(order: {
    next_order_date?: Date | string | null
    frequency: string
    day_of_month?: number | null
    custom_frequency_days?: number | null
  }): Date {
    const lastDate = order.next_order_date ? new Date(order.next_order_date) : new Date()
    const next = new Date(lastDate)
    
    switch (order.frequency) {
      case "WEEKLY":
        next.setDate(next.getDate() + 7)
        break
      case "BIWEEKLY":
        next.setDate(next.getDate() + 14)
        break
      case "MONTHLY":
        next.setMonth(next.getMonth() + 1)
        if (order.day_of_month) {
          next.setDate(order.day_of_month)
        }
        break
      case "CUSTOM":
        next.setDate(next.getDate() + (order.custom_frequency_days || 7))
        break
    }
    
    return next
  }
  
  /**
   * Get vendor's guaranteed revenue (from standing orders)
   */
  async getGuaranteedRevenue(
    sellerId: string,
    period: "weekly" | "monthly"
  ): Promise<{
    total: number
    breakdown: Array<{
      standingOrderId: string
      customerName?: string
      value: number
      frequency: string
    }>
  }> {
    const orders = await this.listStandingOrders({
      seller_id: sellerId,
      status: "ACTIVE",
    })
    
    let total = 0
    const breakdown: Array<{
      standingOrderId: string
      customerName?: string
      value: number
      frequency: string
    }> = []
    
    for (const order of orders) {
      let periodValue = Number(order.order_value)
      
      // Normalize to period
      if (period === "monthly") {
        switch (order.frequency) {
          case "WEEKLY":
            periodValue *= 4.33
            break
          case "BIWEEKLY":
            periodValue *= 2.17
            break
          case "CUSTOM":
            periodValue *= 30 / (order.custom_frequency_days || 7)
            break
        }
      } else {
        switch (order.frequency) {
          case "BIWEEKLY":
            periodValue *= 0.5
            break
          case "MONTHLY":
            periodValue *= 0.23
            break
          case "CUSTOM":
            periodValue *= 7 / (order.custom_frequency_days || 7)
            break
        }
      }
      
      total += periodValue
      breakdown.push({
        standingOrderId: order.id,
        value: periodValue,
        frequency: order.frequency,
      })
    }
    
    return { total: total / 100, breakdown }
  }
  
  /**
   * Pause vendor (vacation mode)
   */
  async pauseVendor(
    sellerId: string,
    data: {
      message: string
      resume_date?: Date
    }
  ): Promise<void> {
    const rules = await this.getOrCreateRules(sellerId)
    
    await this.updateVendorRules({
      id: rules.id,
      accepting_orders: false,
      pause_message: data.message,
      resume_date: data.resume_date,
    })
  }
  
  /**
   * Resume vendor (end vacation mode)
   */
  async resumeVendor(sellerId: string): Promise<void> {
    const rules = await this.getOrCreateRules(sellerId)
    
    await this.updateVendorRules({
      id: rules.id,
      accepting_orders: true,
      pause_message: null,
      resume_date: null,
    })
  }
  
  /**
   * Check and auto-resume vendors
   */
  async processAutoResumes(): Promise<number> {
    const allRules = await this.listVendorRules({
      accepting_orders: false,
    })
    
    const now = new Date()
    let resumed = 0
    
    for (const rules of allRules) {
      if (rules.resume_date && new Date(rules.resume_date) <= now) {
        await this.resumeVendor(rules.seller_id)
        resumed++
      }
    }
    
    return resumed
  }
}

export default VendorRulesService
