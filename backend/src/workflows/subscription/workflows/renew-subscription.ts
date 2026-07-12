import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  authorizePaymentSessionStep,
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  createRemoteLinkStep,
  emitEventStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { updateSubscriptionStep } from "../steps/update-subscription"
import { grantSubscriptionEntitlementsStep } from "../steps/grant-subscription-entitlements"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import {
  buildRenewalCartInput,
  buildRenewalPaymentContext,
  buildRenewalPaymentSessionInput,
  type RenewalSubscription,
} from "../renew-helpers"

type WorkflowInput = {
  subscription_id: string
}

/**
 * Whether the renewal workflow mints a real order and captures payment
 * off-session. Read once at registration so the compiled graph is fixed per
 * process; the hourly job (`process-subscription-renewals`) gates on the same
 * flag and only invokes this workflow in live mode. Ships dark: unset → the
 * legacy date-advance + entitlement path.
 */
const RENEWAL_LIVE = process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE === "1"

const SUBSCRIPTION_FIELDS = [
  "*",
  "cart.*",
  "cart.items.*",
  "cart.items.variant.*",
  "cart.shipping_address.*",
  "cart.billing_address.*",
  "cart.shipping_methods.*",
  "customer.*",
]

/**
 * Renew Subscription Workflow
 *
 * Per-cycle renewal pipeline. In live mode (`FBM_SUBSCRIPTION_RENEWAL_LIVE=1`)
 * it:
 *   1. Loads the subscription and its template cart
 *   2. Clones the template cart into a fresh cart (createCartWorkflow) —
 *      the original cart already became the initial order
 *   3. Creates a payment collection + an off-session payment session against
 *      the subscription's saved payment method, then authorizes it. With the
 *      Stripe provider's automatic capture this settles the charge; explicit
 *      settlement otherwise follows the standard order payment lifecycle.
 *   4. Completes the cart into an order and links it to the subscription
 *      (subscription↔order link, `isList` so each renewal appends)
 *   5. Advances the subscription dates and grants per-cycle entitlements with
 *      `source=SUBSCRIPTION` + `source_subscription_id` provenance, keyed by
 *      the new order id
 *   6. Emits `subscription.renewal_processed`
 *
 * Any failure in steps 2–4 throws, so the calling job routes to
 * `handleSubscriptionFailureWorkflow` (dunning + pause-on-max-retries) and the
 * core-flow compensations roll back the partial cart/payment.
 *
 * In legacy mode (flag unset) the order/payment steps are skipped: dates are
 * advanced and entitlements granted exactly as before.
 */
export const renewSubscriptionWorkflowId = "renew-subscription-workflow"
export const renewSubscriptionWorkflow = createWorkflow(
  renewSubscriptionWorkflowId,
  (input: WorkflowInput) => {
    const { data: subscriptions } = useQueryGraphStep({
      entity: "subscription",
      fields: SUBSCRIPTION_FIELDS,
      filters: {
        id: input.subscription_id,
      },
      options: {
        throwIfKeyNotFound: true,
      },
    })

    if (RENEWAL_LIVE) {
      // 1. Clone the template cart into a fresh cart for this cycle.
      const cartInput = transform({ subscriptions }, (data) =>
        buildRenewalCartInput(data.subscriptions[0] as RenewalSubscription)
      )
      const cart = createCartWorkflow.runAsStep({ input: cartInput })

      // 2. Attach a payment collection to the new cart.
      createPaymentCollectionForCartWorkflow.runAsStep({
        input: { cart_id: cart.id },
      })

      const { data: cartsWithPc } = useQueryGraphStep({
        entity: "cart",
        fields: ["id", "payment_collection.id"],
        filters: { id: cart.id },
        options: { throwIfKeyNotFound: true },
      }).config({ name: "renewal-cart-payment-collection" })

      // 3. Create + authorize an off-session payment session against the
      //    subscription's saved payment method.
      const sessionInput = transform(
        { cartsWithPc, subscriptions },
        (data) =>
          buildRenewalPaymentSessionInput({
            payment_collection_id: (data.cartsWithPc[0] as any).payment_collection
              ?.id,
            subscription: data.subscriptions[0] as RenewalSubscription,
          })
      )
      const paymentSession = createPaymentSessionsWorkflow.runAsStep({
        input: sessionInput,
      })

      const authContext = transform({ subscriptions }, (data) =>
        buildRenewalPaymentContext(data.subscriptions[0] as RenewalSubscription)
      )
      authorizePaymentSessionStep({
        id: paymentSession.id,
        context: authContext,
      })

      // 4. Complete the cart → order, then link it to the subscription.
      const order = completeCartWorkflow.runAsStep({
        input: { id: cart.id },
      })

      const linkDefs = transform({ order, input }, (data) => [
        {
          [SUBSCRIPTION_MODULE]: {
            subscription_id: data.input.subscription_id,
          },
          [Modules.ORDER]: {
            order_id: data.order.id,
          },
        },
      ])
      createRemoteLinkStep(linkDefs)

      // 5. Advance dates + grant entitlements keyed by the new order.
      const { subscription } = updateSubscriptionStep({
        subscription_id: input.subscription_id,
        action: "record_order",
      })

      const grantInputs = transform({ subscriptions, order }, (data) => {
        const sub = data.subscriptions[0] as RenewalSubscription & {
          product_id?: string | null
          variant_id?: string | null
        }
        return {
          subscription_id: sub.id,
          customer_id: sub.customer_id ?? null,
          product_id: sub.product_id ?? null,
          variant_id: sub.variant_id ?? null,
          order_id: data.order.id as string,
        }
      })
      const entitlementResult = grantSubscriptionEntitlementsStep(grantInputs)

      emitEventStep({
        eventName: "subscription.renewal_processed",
        data: {
          subscription_id: input.subscription_id,
          order_id: order.id,
          granted_entitlements: entitlementResult.granted_count,
        },
      })

      return new WorkflowResponse({
        subscription,
        renewal_prepared: true,
        order_id: order.id,
        granted_entitlements: entitlementResult.granted_count,
      })
    }

    // Legacy path (flag unset): advance dates + grant entitlements, no order.
    const grantInputs = transform({ subscriptions }, (data) => {
      const sub = data.subscriptions[0] as RenewalSubscription & {
        product_id?: string | null
        variant_id?: string | null
      }
      return {
        subscription_id: sub.id,
        customer_id: sub.customer_id ?? null,
        product_id: sub.product_id ?? null,
        variant_id: sub.variant_id ?? null,
      }
    })

    const { subscription } = updateSubscriptionStep({
      subscription_id: input.subscription_id,
      action: "record_order",
    })

    const entitlementResult = grantSubscriptionEntitlementsStep(grantInputs)

    emitEventStep({
      eventName: "subscription.renewal_processed",
      data: {
        subscription_id: input.subscription_id,
        granted_entitlements: entitlementResult.granted_count,
      },
    })

    return new WorkflowResponse({
      subscription,
      renewal_prepared: true,
      granted_entitlements: entitlementResult.granted_count,
    })
  }
)
