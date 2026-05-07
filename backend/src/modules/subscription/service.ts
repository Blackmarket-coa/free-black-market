import { MedusaService } from "@medusajs/framework/utils"
import { Subscription } from "./models"
import { 
  CreateSubscriptionData, 
  SubscriptionData, 
  SubscriptionInterval, 
  SubscriptionStatus
} from "./types"

/**
 * Subscription Module Service
 * 
 * Manages subscription lifecycle for recurring orders including:
 * - CSA shares (weekly/monthly produce boxes)
 * - Meal plans (restaurant subscriptions)
 * - Garden memberships
 * - Cooperative memberships
 * 
 * Handles:
 * - Subscription creation with calculated dates
 * - Order date tracking
 * - Expiration and cancellation
 * - Pause/resume functionality
 */
class SubscriptionModuleService extends MedusaService({
  Subscription
}) {
  
  /**
   * Create subscriptions with calculated expiration and next order dates
   */
  // @ts-expect-error - override parent method
  async createSubscriptions(
    data: CreateSubscriptionData | CreateSubscriptionData[]
  ): Promise<SubscriptionData[]> {
    const input = Array.isArray(data) ? data : [data]

    const subscriptions = await Promise.all(
      input.map(async (subscription) => {
        const subscriptionDate = subscription.subscription_date || new Date()
        const expirationDate = this.getExpirationDate({
          subscription_date: subscriptionDate,
          interval: subscription.interval,
          period: subscription.period
        })

        return await super.createSubscriptions({
          ...subscription,
          subscription_date: subscriptionDate,
          last_order_date: subscriptionDate,
          next_order_date: this.getNextOrderDate({
            last_order_date: subscriptionDate,
            expiration_date: expirationDate,
            interval: subscription.interval,
            period: subscription.period
          }),
          expiration_date: expirationDate
        })
      })
    )
    
    return subscriptions
  }

  /**
   * Record when a new subscription order is created
   * Updates last_order_date and calculates next_order_date
   */
  async recordNewSubscriptionOrder(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const orderDate = new Date()

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        last_order_date: orderDate,
        next_order_date: this.getNextOrderDate({
          last_order_date: orderDate,
          expiration_date: subscription.expiration_date,
          interval: subscription.interval,
          period: subscription.period
        })
      }
    })

    return updated[0]
  }

  /**
   * Get subscriptions that are due for renewal
   */
  async getDueSubscriptions(): Promise<SubscriptionData[]> {
    const now = new Date()
    
    return this.listSubscriptions({
      status: SubscriptionStatus.ACTIVE,
      next_order_date: { $lte: now }
    })
  }

  /**
   * Pause a subscription
   */
  async pauseSubscription(id: string): Promise<SubscriptionData> {
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date()
      }
    })
    return updated[0]
  }

  /**
   * Resume a paused subscription
   */
  async resumeSubscription(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const now = new Date()
    
    // Calculate new next order date from now
    const nextOrderDate = this.getNextOrderDate({
      last_order_date: now,
      expiration_date: subscription.expiration_date,
      interval: subscription.interval,
      period: subscription.period
    })

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        paused_at: null,
        next_order_date: nextOrderDate
      }
    })
    return updated[0]
  }

  /**
   * Expire subscriptions that have passed their expiration date
   */
  async expireSubscription(id: string | string[]): Promise<SubscriptionData[]> {
    const input = Array.isArray(id) ? id : [id]

    return await this.updateSubscriptions({
      selector: { id: input },
      data: {
        next_order_date: null,
        status: SubscriptionStatus.EXPIRED
      }
    })
  }

  /**
   * Cancel subscriptions
   */
  async cancelSubscriptions(id: string | string[]): Promise<SubscriptionData[]> {
    const input = Array.isArray(id) ? id : [id]

    return await this.updateSubscriptions({
      selector: { id: input },
      data: {
        next_order_date: null,
        status: SubscriptionStatus.CANCELED,
        canceled_at: new Date()
      }
    })
  }

  /**
   * Mark subscription as failed (e.g., payment failure)
   */
  async failSubscription(id: string, reason?: string): Promise<SubscriptionData> {
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.FAILED,
        metadata: { failure_reason: reason }
      }
    })
    return updated[0]
  }

  /**
   * Record a dunning attempt against a subscription. Returns the updated
   * subscription with `metadata.dunning_attempts` incremented and
   * `metadata.dunning_last_error` set. Caller decides whether to schedule
   * a retry or pause.
   */
  async recordDunningAttempt(
    id: string,
    error?: string
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    const prevAttempts = Number(prevMetadata.dunning_attempts ?? 0)
    const attempts = prevAttempts + 1

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        metadata: {
          ...prevMetadata,
          dunning_attempts: attempts,
          dunning_last_attempt_at: new Date().toISOString(),
          dunning_last_error: error ?? null,
        },
      },
    })
    return updated[0]
  }

  /**
   * Pause a subscription with a reason recorded on metadata. Used by the
   * dunning workflow when retries are exhausted.
   */
  async pauseSubscriptionWithReason(
    id: string,
    reason: string
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date(),
        metadata: {
          ...prevMetadata,
          paused_reason: reason,
        },
      },
    })
    return updated[0]
  }

  /**
   * Reset dunning state, e.g. after a successful renewal payment.
   */
  async clearDunningAttempts(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    if (!prevMetadata.dunning_attempts) {
      return subscription
    }

    const cleared = { ...prevMetadata }
    delete cleared.dunning_attempts
    delete cleared.dunning_last_attempt_at
    delete cleared.dunning_last_error

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: { metadata: cleared },
    })
    return updated[0]
  }

  /**
   * Calculate the next order date based on interval
   */
  getNextOrderDate({
    last_order_date,
    expiration_date,
    interval,
    period
  }: {
    last_order_date: Date
    expiration_date: Date
    interval: SubscriptionInterval
    period: number
  }): Date | null {
    const lastDate = new Date(last_order_date)
    let nextDate: Date

    switch (interval) {
      case SubscriptionInterval.WEEKLY:
        nextDate = new Date(lastDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      case SubscriptionInterval.BIWEEKLY:
        nextDate = new Date(lastDate.getTime() + 14 * 24 * 60 * 60 * 1000)
        break
      case SubscriptionInterval.MONTHLY:
        nextDate = new Date(lastDate)
        nextDate.setMonth(nextDate.getMonth() + 1)
        break
      case SubscriptionInterval.QUARTERLY:
        nextDate = new Date(lastDate)
        nextDate.setMonth(nextDate.getMonth() + 3)
        break
      case SubscriptionInterval.YEARLY:
        nextDate = new Date(lastDate)
        nextDate.setFullYear(nextDate.getFullYear() + 1)
        break
      default:
        nextDate = new Date(lastDate)
        nextDate.setMonth(nextDate.getMonth() + 1)
    }

    // If next order date is after expiration, return null
    if (nextDate > new Date(expiration_date)) {
      return null
    }

    return nextDate
  }

  /**
   * Calculate expiration date based on subscription start and interval
   */
  getExpirationDate({
    subscription_date,
    interval,
    period
  }: {
    subscription_date: Date
    interval: SubscriptionInterval
    period: number
  }): Date {
    const startDate = new Date(subscription_date)
    let expirationDate: Date

    switch (interval) {
      case SubscriptionInterval.WEEKLY:
        expirationDate = new Date(startDate.getTime() + period * 7 * 24 * 60 * 60 * 1000)
        break
      case SubscriptionInterval.BIWEEKLY:
        expirationDate = new Date(startDate.getTime() + period * 14 * 24 * 60 * 60 * 1000)
        break
      case SubscriptionInterval.MONTHLY:
        expirationDate = new Date(startDate)
        expirationDate.setMonth(expirationDate.getMonth() + period)
        break
      case SubscriptionInterval.QUARTERLY:
        expirationDate = new Date(startDate)
        expirationDate.setMonth(expirationDate.getMonth() + (period * 3))
        break
      case SubscriptionInterval.YEARLY:
        expirationDate = new Date(startDate)
        expirationDate.setFullYear(expirationDate.getFullYear() + period)
        break
      default:
        expirationDate = new Date(startDate)
        expirationDate.setMonth(expirationDate.getMonth() + period)
    }

    return expirationDate
  }

  /**
   * Get subscriptions for a customer
   */
  async getCustomerSubscriptions(customerId: string): Promise<SubscriptionData[]> {
    return this.listSubscriptions({ customer_id: customerId })
  }

  /**
   * Get subscriptions for a seller/vendor
   */
  async getSellerSubscriptions(sellerId: string): Promise<SubscriptionData[]> {
    return this.listSubscriptions({ seller_id: sellerId })
  }

  /**
   * Get active subscriptions count for a product
   */
  async getProductSubscriptionCount(productId: string): Promise<number> {
    const subscriptions = await this.listSubscriptions({
      product_id: productId,
      status: SubscriptionStatus.ACTIVE
    })
    return subscriptions.length
  }
}

export default SubscriptionModuleService
