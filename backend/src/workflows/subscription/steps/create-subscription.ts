import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionInterval, SubscriptionType } from "../../../modules/subscription/types"
import {
  consumerSubscriptionsEnabled,
  isUntilCanceledForProduct,
} from "../grace-lifecycle"
import {
  decideCreateTerms,
  type AutoRenewApproval,
} from "../../../modules/subscription/utils/auto-renew"

type StepInput = {
  cart_id: string
  order_id: string
  customer_id?: string
  seller_id?: string
  product_id?: string
  variant_id?: string
  quantity?: number
  subscription_data: {
    interval: SubscriptionInterval
    period: number
    type?: SubscriptionType
    delivery_day?: string
    delivery_instructions?: string
    /**
     * The customer's answer to the auto-renew question, recorded under
     * FF_CONSUMER_SUBSCRIPTIONS_V1 by POST /store/subscriptions and by the
     * Blackout hosted checkout (commerce/checkout/sessions/[token]/page) for
     * recurring listings. Absent for callers that never ask, and always with
     * the flag off.
     */
    auto_renew?: AutoRenewApproval
  }
}

/**
 * Create Subscription Step
 * 
 * Creates a new subscription and links it to order, cart, customer, and seller
 */
export const createSubscriptionStep = createStep(
  "create-subscription-step",
  async ({ 
    cart_id, 
    order_id, 
    customer_id,
    seller_id,
    product_id,
    variant_id,
    quantity,
    subscription_data
  }: StepInput, { container }) => {
    const subscriptionService: SubscriptionModuleService = 
      container.resolve(SUBSCRIPTION_MODULE)
    const linkDefs: LinkDefinition[] = []

    // Affirmative auto-renew approval (FF_CONSUMER_SUBSCRIPTIONS_V1; operator
    // answer 2026-10-05, "renew upon approval"). Replaces the earlier rule
    // that made every subscription for a product marked
    // `subscription_until_canceled` renew until cancelled by default:
    //
    //   - approved AND product marked  → until cancelled, approval recorded
    //     with its time and disclosure version;
    //   - otherwise (declined, or a product not marked) → exactly one period,
    //     never renewed;
    //   - no answer recorded (a caller that never asks) → never until
    //     cancelled; the fixed horizon it always had.
    //
    // Flag off: the product is not looked up and every write below is what it
    // always was.
    const { auto_renew: approval, ...plainData } = subscription_data
    let terms: Record<string, unknown> = {}
    if (consumerSubscriptionsEnabled() && approval) {
      const decision = decideCreateTerms({
        approved: approval.approved === true,
        product_allows_until_canceled: await isUntilCanceledForProduct(container, product_id),
      })
      terms =
        decision.mode === "until_canceled"
          ? {
              until_canceled: true,
              auto_renew_approved: true,
              auto_renew_approved_at: new Date(approval.approved_at),
              auto_renew_disclosure_version: approval.disclosure_version,
            }
          : { single_period: true, auto_renew_approved: false }
    }

    const subscription = await subscriptionService.createSubscriptions({
      ...plainData,
      ...terms,
      customer_id,
      seller_id,
      product_id,
      variant_id,
      quantity: quantity || 1,
      metadata: {
        initial_order_id: order_id,
        initial_cart_id: cart_id
      }
    })

    // Link subscription to order
    linkDefs.push({
      [SUBSCRIPTION_MODULE]: {
        subscription_id: subscription[0].id
      },
      [Modules.ORDER]: {
        order_id: order_id
      }
    })

    // Link subscription to cart (for renewal reference)
    linkDefs.push({
      [SUBSCRIPTION_MODULE]: {
        subscription_id: subscription[0].id
      },
      [Modules.CART]: {
        cart_id: cart_id
      }
    })

    // Link subscription to customer
    if (customer_id) {
      linkDefs.push({
        [SUBSCRIPTION_MODULE]: {
          subscription_id: subscription[0].id
        },
        [Modules.CUSTOMER]: {
          customer_id: customer_id
        }
      })
    }

    return new StepResponse({
      subscription: subscription[0],
      linkDefs
    }, {
      subscription: subscription[0]
    })
  },
  // Compensation: cancel subscription if workflow fails
  async (data, { container }) => {
    if (!data) {
      return
    }
    const subscriptionService: SubscriptionModuleService = 
      container.resolve(SUBSCRIPTION_MODULE)

    await subscriptionService.cancelSubscriptions(data.subscription.id)
  }
)
