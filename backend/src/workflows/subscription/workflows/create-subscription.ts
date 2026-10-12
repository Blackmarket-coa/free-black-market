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
  subscriptionOrderPaidStep,
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
 * resolved before Medusa authorizes the payment session (a card the buyer
 * already confirmed at Stripe, as Blackout's page does before it completes,
 * keeps that hold if the cart is refused), the order is linked to that
 * seller, and the card payment is captured before the subscription is
 * created — so the sale reaches the seller and the ledger. Flag off, those
 * steps do nothing; only the paid check below runs whatever the flag says.
 *
 * A refused capture fails the checkout; Medusa keeps the cancelled payment
 * on the cart's payment collection, so the capture step passes over a
 * cancelled payment whose session is gone, and a retry with a new session
 * completes normally (SD-48; before, every retry was refused). Every other
 * uncaptured FBM card payment stays the one to capture, so a payment whose
 * session was replaced mid-checkout is refused at the capture rather than
 * skipped.
 *
 * A replay — the checkout run again on a cart already completed (Blackout's
 * "retry finishes the record", a retried store call) — never runs
 * `completeCartWorkflow`: with the flag on, `completedCartOrderStep` finds
 * the cart's order first. On a completed cart `completeCartWorkflow` creates
 * nothing but still registers a compensation that refunds a captured
 * payment, so a later failure — a seller re-linked since the sale, a
 * transient read error — refunded the first payment of a subscription that
 * stayed active (seen on a real database; SD-48). The link and capture steps
 * still run on a replay, in their replay mode: a linked, captured order is
 * left as it is; an order whose first completion stopped before its link or
 * capture is linked to its products' one seller and captured before the
 * subscription is created. A refused capture fails the retry, and nothing on
 * this path refunds anything; an order with no single seller is neither
 * linked nor captured, and its subscription is made as without the flag
 * (SD-48 open item).
 *
 * Last before the subscription is made, an order that owes money and has no
 * payment is refused (`subscriptionOrderPaidStep`), with the flag on or off.
 * That is what Medusa's workflow engine leaves when it stops
 * `completeCartWorkflow` after the order and before the card is authorized
 * (SD-53): that first checkout is refused for want of an order id, and its
 * retry, finding the order (as a replay with the flag on; with it off,
 * through `completeCartWorkflow`, which hands a completed cart's order back)
 * would otherwise make an unpaid subscription — with the flag off it did, on
 * a real database, until SD-53 (c) took the check out from under the flag.
 * With the flag off this checkout takes no lock, so a second checkout of the
 * same cart that arrives before the first's card is authorized is refused
 * here too, and the first makes the subscription.
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

    // Only a cart not yet completed is checked for its seller and completed;
    // a replay keeps out of completeCartWorkflow and its refund compensation.
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

      return transform({ createdOrderId, resolvedSeller }, (data) => ({
        order_id: data.createdOrderId,
        seller_id: data.resolvedSeller.seller_id,
      }))
    })

    // A replay's order is the one already there; otherwise, the one just made.
    const checkout = transform({ completed, completion }, (data) => ({
      order_id: (data.completed.order_id ?? data.completion?.order_id) as string,
      mode: data.completed.order_id ? ("replay" as const) : ("initial" as const),
      expected_seller_id: data.completion?.seller_id ?? null,
    }))

    // F5: link the order to its seller — just made: the seller checked
    // before payment, or the checkout rolls back. SD-48, a replay's: left as
    // it is when linked, else linked to its products' one seller (its first
    // completion stopped before the link), never refused.
    const linked = linkSubscriptionOrderSellerStep(
      transform({ checkout }, (data) => ({
        order_id: data.checkout.order_id,
        mode: data.checkout.mode,
        expected_seller_id: data.checkout.expected_seller_id,
      }))
    )

    const toCapture = subscriptionPaymentToCaptureStep(
      transform({ checkout, linked }, (data) => ({
        order_id: data.checkout.order_id,
        mode: data.checkout.mode,
        linked_seller_id: data.linked.seller_id,
      }))
    )

    // F5: take the money the checkout authorized — on a replay too, when the
    // order's first completion left it uncaptured (SD-48). A refused capture
    // fails the checkout before any subscription exists. After a first
    // completion, a later failure deletes the order through
    // completeCartWorkflow's compensation, which then tries to refund the
    // capture (`compensatePaymentIfNeededStep`) — best effort: a refund
    // Stripe refuses is only logged by Medusa, the card stays charged with no
    // order, and the failed run's `payment.captured` is dropped, so the
    // ledger never hears of it (SD-48 open item). A replay has no such
    // compensation, so nothing refunds its capture.
    // Outside the block above because `when` blocks do not nest.
    when("capture-subscription-first-payment", { toCapture }, (data) => !!data.toCapture.payment_id).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform({ toCapture }, (data) => ({ payment_id: data.toCapture.payment_id as string })),
      })
    })

    // SD-48: no subscription for an order that owes money and has no payment,
    // which is what a first completion Medusa's workflow engine left
    // unfinished leaves behind for a retry to find (SD-53). Flag on or off.
    subscriptionOrderPaidStep(transform({ checkout }, (data) => ({ order_id: data.checkout.order_id })))

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
