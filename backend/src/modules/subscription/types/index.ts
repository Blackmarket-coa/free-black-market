import { InferTypeOf } from "@medusajs/framework/types"
import Subscription from "../models/subscription"

/**
 * Subscription Status
 * 
 * Tracks the lifecycle of a subscription:
 * - ACTIVE: Currently running, will renew
 * - PAUSED: Temporarily paused by customer or admin
 * - CANCELED: Customer canceled, no more renewals
 * - EXPIRED: Reached end of subscription period
 * - FAILED: Payment or other failure
 * - PAST_DUE: In a grace period after a customer cancel or exhausted payment
 *   retries (FF_CONSUMER_SUBSCRIPTIONS_V1 only). Access continues until
 *   `grace_ends_at`; nothing is revoked on entry.
 * - READ_ONLY: Grace has ended (FF_CONSUMER_SUBSCRIPTIONS_V1 only). A
 *   read/export entitlement is kept and nothing is deleted — BLACK_MASK
 *   launch plan F4: "then read-only access with export. Never quick deletion."
 */
export enum SubscriptionStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  CANCELED = "canceled",
  EXPIRED = "expired",
  FAILED = "failed",
  PAST_DUE = "past_due",
  READ_ONLY = "read_only",
}

/**
 * Subscription Interval
 * 
 * Defines the billing cycle:
 * - WEEKLY: Weekly renewals (great for CSA boxes)
 * - BIWEEKLY: Every two weeks
 * - MONTHLY: Monthly billing
 * - QUARTERLY: Every 3 months
 * - YEARLY: Annual subscriptions
 */
export enum SubscriptionInterval {
  WEEKLY = "weekly",
  BIWEEKLY = "biweekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  YEARLY = "yearly"
}

/**
 * Subscription Type
 * 
 * Different subscription models:
 * - CSA_SHARE: Farm share subscription
 * - MEAL_PLAN: Restaurant meal subscription
 * - PRODUCE_BOX: Curated produce delivery
 * - MEMBERSHIP: Garden/coop membership
 * - CUSTOM: Custom subscription type
 */
export enum SubscriptionType {
  CSA_SHARE = "csa_share",
  MEAL_PLAN = "meal_plan",
  PRODUCE_BOX = "produce_box",
  MEMBERSHIP = "membership",
  CUSTOM = "custom"
}

export type CreateSubscriptionData = {
  interval: SubscriptionInterval
  period: number
  type?: SubscriptionType
  status?: SubscriptionStatus
  subscription_date?: Date
  seller_id?: string
  customer_id?: string
  product_id?: string
  variant_id?: string
  quantity?: number
  metadata?: Record<string, unknown>
  /**
   * No fixed horizon: `expiration_date` is stored NULL and renewals continue
   * until the subscription is canceled. Only set by createSubscriptionStep
   * under FF_CONSUMER_SUBSCRIPTIONS_V1, when the customer affirmatively
   * approved auto-renewal AND the product's metadata sets
   * `subscription_until_canceled` (the product-side marker that it MAY be
   * sold until cancelled — never, on its own, a reason to renew).
   */
  until_canceled?: boolean
  /**
   * Exactly one period, never renewed: `period` is stored as 1, the
   * expiration is the end of the first paid period and no next order is
   * scheduled. Set by createSubscriptionStep under FF_CONSUMER_SUBSCRIPTIONS_V1
   * when the customer did not approve auto-renewal.
   */
  single_period?: boolean
  auto_renew_approved?: boolean
  auto_renew_approved_at?: Date | null
  auto_renew_disclosure_version?: string | null
}

export type SubscriptionData = InferTypeOf<typeof Subscription>
