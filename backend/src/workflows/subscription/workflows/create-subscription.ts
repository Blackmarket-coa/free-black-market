import { 
  createWorkflow,
  transform,
  when,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  capturePaymentWorkflow,
  createRemoteLinkStep,
  completeCartWorkflow,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { SubscriptionInterval, SubscriptionType } from "../../../modules/subscription/types"
import type { AutoRenewApproval } from "../../../modules/subscription/utils/auto-renew"
import { createSubscriptionStep } from "../steps/create-subscription"
import { emitSubscriptionStateStep } from "../steps/emit-subscription-state"
import {
  completedCartOrderStep,
  linkSubscriptionOrderSellerStep,
  resolveSubscriptionSellerStep,
  subscriptionCheckoutLockStep,
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
 *
 * A replay — the checkout run again on a cart already completed (Blackout's
 * "retry finishes the record", a retried store call) — runs none of them,
 * nor `completeCartWorkflow` itself: with the flag on,
 * `completedCartOrderStep` finds the cart's order first and it is returned
 * as its first completion left it. On a completed cart `completeCartWorkflow`
 * creates nothing but still registers a compensation that refunds a captured
 * payment, so a later failure — a seller re-linked since the sale, a
 * transient read error — refunded the first payment of a subscription that
 * stayed active (seen on a real database; SD-48).
 *
 * Two checkouts of one cart at once (a double submit) are kept apart, flag
 * on, by a lock on the cart id held from the first step to the last
 * (`subscriptionCheckoutLockStep`): the second waits, then returns the
 * first's order as a replay. Medusa's locking module here is its in-memory
 * provider (no locking module is configured), so the lock holds within one
 * server process only — the same limit `completeCartWorkflow`'s own lock has.
 */
export const createSubscriptionWorkflowId = "create-subscription-workflow"
export const createSubscriptionWorkflow = createWorkflow(
  createSubscriptionWorkflowId,
  (input: WorkflowInput) => {
    // One checkout of a cart at a time, held to the end: a second waits
    // here, then finds the first's order below and returns it as a replay
    // (flag off: no key, no lock, as before).
    const lock = subscriptionCheckoutLockStep({ cart_id: input.cart_id })
    acquireLockStep({
      key: lock.key,
      timeout: 30,
      ttl: 120,
    })

    // The order of a cart already completed (flag off: null, unread).
    const completed = completedCartOrderStep({ cart_id: input.cart_id })

    // Only a cart not yet completed is completed, linked and charged; a
    // replay keeps out of completeCartWorkflow and its refund compensation.
    const completion = when(
      "complete-subscription-cart",
      { completed },
      (data) => !data.completed.order_id
    ).then(() => {
      // F5: refuse, before payment, a cart no single seller can be credited with.
      const resolvedSeller = resolveSubscriptionSellerStep({ cart_id: input.cart_id })

      // Complete the cart and create the initial order
      const { id: createdOrderId } = completeCartWorkflow.runAsStep({
        input: {
          id: input.cart_id
        }
      })

      linkSubscriptionOrderSellerStep({
        order_id: createdOrderId,
        mode: "initial",
        expected_seller_id: resolvedSeller.seller_id,
      })

      const toCapture = subscriptionPaymentToCaptureStep({ order_id: createdOrderId, mode: "initial" })

      return transform({ createdOrderId, toCapture }, (data) => ({
        order_id: data.createdOrderId,
        payment_id: data.toCapture.payment_id,
      }))
    })

    // A replay's order is the one already there; otherwise, the one just made.
    const checkout = transform({ completed, completion }, (data) => ({
      order_id: (data.completed.order_id ?? data.completion?.order_id) as string,
      payment_id: data.completion?.payment_id ?? null,
    }))

    // F5: take the money the checkout authorized. A refused capture fails
    // the checkout before any subscription exists; a capture followed by a
    // later failure is refunded by completeCartWorkflow's own compensation
    // (`compensatePaymentIfNeededStep` refunds a captured payment). Outside
    // the block above because `when` blocks do not nest.
    when("capture-subscription-first-payment", { checkout }, (data) => !!data.checkout.payment_id).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform({ checkout }, (data) => ({ payment_id: data.checkout.payment_id as string })),
      })
    })

    const id = transform({ checkout }, (data) => data.checkout.order_id)

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

    releaseLockStep({
      key: lock.key,
    })

    return new WorkflowResponse({
      subscription,
      order: orders[0]
    })
  }
)
