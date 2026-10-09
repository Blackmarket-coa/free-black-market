import { 
  createWorkflow,
  transform,
  when,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import { 
  capturePaymentWorkflow,
  createRemoteLinkStep,
  completeCartWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { SubscriptionInterval, SubscriptionType } from "../../../modules/subscription/types"
import type { AutoRenewApproval } from "../../../modules/subscription/utils/auto-renew"
import { createSubscriptionStep } from "../steps/create-subscription"
import { emitSubscriptionStateStep } from "../steps/emit-subscription-state"
import {
  linkSubscriptionOrderSellerStep,
  resolveSubscriptionSellerStep,
  subscriptionPaymentToCaptureStep,
} from "../steps/subscription-order-settlement"
import subscriptionOrderLink from "../../../links/subscription-order"

type WorkflowInput = {
  cart_id: string
  subscription_data: {
    interval: SubscriptionInterval
    period: number
    type?: SubscriptionType
    delivery_day?: string
    delivery_instructions?: string
    /** FF_CONSUMER_SUBSCRIPTIONS_V1: the customer's auto-renew answer. */
    auto_renew?: AutoRenewApproval
  }
}

/**
 * Create Subscription Workflow
 * 
 * Creates a new subscription from a cart checkout:
 * 1. Completes the cart (creates initial order)
 * 2. Retrieves order details
 * 3. Creates subscription record
 * 4. Links subscription to order, cart, customer
 *
 * With FF_CONSUMER_SUBSCRIPTIONS_V1 (F5 / SD-46,
 * `steps/subscription-order-settlement.ts`): the cart's one seller is
 * resolved before any payment is authorized, the order is linked to that
 * seller, and the card payment is captured before the subscription is
 * created — so the sale reaches the seller and the ledger. Flag off, those
 * steps do nothing.
 */
export const createSubscriptionWorkflowId = "create-subscription-workflow"
export const createSubscriptionWorkflow = createWorkflow(
  createSubscriptionWorkflowId,
  (input: WorkflowInput) => {
    // F5: refuse, before payment, a cart no single seller can be credited with.
    const resolvedSeller = resolveSubscriptionSellerStep({ cart_id: input.cart_id })

    // Complete the cart and create the initial order
    const { id } = completeCartWorkflow.runAsStep({
      input: {
        id: input.cart_id
      }
    })

    // Get the created order details
    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "customer_id",
        "items.*",
        "items.variant.*",
        "items.variant.product.*",
        "items.variant.product.seller.*",
      ],
      filters: {
        id
      },
      options: {
        throwIfKeyNotFound: true
      }
    })

    linkSubscriptionOrderSellerStep({
      order_id: id,
      mode: "initial",
      expected_seller_id: resolvedSeller.seller_id,
    })

    // F5: take the money the checkout authorized. A refused capture fails
    // the checkout before any subscription exists; a capture followed by a
    // later failure is refunded by completeCartWorkflow's own compensation
    // (`compensatePaymentIfNeededStep` refunds a captured payment).
    const toCapture = subscriptionPaymentToCaptureStep({ order_id: id, mode: "initial" })
    when("capture-subscription-first-payment", { toCapture }, (data) => !!data.toCapture.payment_id).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform({ toCapture }, (data) => ({ payment_id: data.toCapture.payment_id as string })),
      })
    })

    // Check if subscription already exists for this order
    const { data: existingLinks } = useQueryGraphStep({
      entity: subscriptionOrderLink.entryPoint,
      fields: ["subscription.id"],
      filters: { order_id: orders[0].id },
    }).config({ name: "retrieve-existing-links" })

    // Only create subscription if one doesn't exist
    const subscription = when(
      "create-subscription-condition",
      { existingLinks },
      (data) => data.existingLinks.length === 0
    )
    .then(() => {
      // Extract seller and product info from first item
      const firstItem = orders[0].items?.[0] as any
      const sellerId = firstItem?.variant?.product?.seller?.id
      const productId = firstItem?.variant?.product?.id
      const variantId = firstItem?.variant?.id
      const quantity = firstItem?.quantity

      const { subscription, linkDefs } = createSubscriptionStep({
        cart_id: input.cart_id,
        order_id: orders[0].id,
        customer_id: orders[0].customer_id!,
        seller_id: sellerId,
        product_id: productId,
        variant_id: variantId,
        quantity,
        subscription_data: input.subscription_data
      })
  
      createRemoteLinkStep(linkDefs)

      // Real-time Blackout membership sync: a brand-new subscribe activates the
      // member's Space ACL immediately, without waiting for the renewal cron.
      emitSubscriptionStateStep({ subscription, transition: "subscribe" })

      return subscription
    })

    return new WorkflowResponse({
      subscription,
      order: orders[0]
    })
  }
)
