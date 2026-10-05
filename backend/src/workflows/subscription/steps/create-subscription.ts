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

    // D (F4): until-canceled — no fixed horizon — only for a product that opts
    // in via metadata `subscription_until_canceled`, and only with
    // FF_CONSUMER_SUBSCRIPTIONS_V1 on. Otherwise the subscription expires
    // after `period` cycles exactly as before; flag off, the product is not
    // even looked up.
    const untilCanceled =
      consumerSubscriptionsEnabled() &&
      (await isUntilCanceledForProduct(container, product_id))

    const subscription = await subscriptionService.createSubscriptions({
      ...subscription_data,
      ...(untilCanceled ? { until_canceled: true } : {}),
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
