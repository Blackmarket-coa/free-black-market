import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  emitEventStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { updateSubscriptionStep } from "../steps/update-subscription"
import { grantSubscriptionEntitlementsStep } from "../steps/grant-subscription-entitlements"

type WorkflowInput = {
  subscription_id: string
}

/**
 * Renew Subscription Workflow
 *
 * Per-cycle renewal pipeline. Today it:
 *   1. Loads the subscription and its template cart
 *   2. Records a renewal on the subscription (advances last/next order date)
 *   3. Grants per-cycle entitlements via EntitlementGrantRule, tagged with
 *      `source=SUBSCRIPTION` and `source_subscription_id` for audit/dashboards
 *   4. Emits `subscription.renewal_processed` for downstream notifications
 *
 * The actual order-creation + off-session payment-capture path is a
 * deliberate seam left for a follow-up PR that has access to a real Stripe
 * environment. When wiring it in, replace the TODO block below with:
 *   - clone the linked cart (variants, addresses, shipping methods)
 *   - run completeCartWorkflow.runAsStep on the new cart_id
 *   - record the new order_id back on the subscription via the
 *     subscription-order link
 *   - on failure, throw — the job will catch and route to
 *     handleSubscriptionFailureWorkflow which records a dunning attempt and
 *     pauses on max retries.
 */
export const renewSubscriptionWorkflowId = "renew-subscription-workflow"
export const renewSubscriptionWorkflow = createWorkflow(
  renewSubscriptionWorkflowId,
  (input: WorkflowInput) => {
    const { data: subscriptions } = useQueryGraphStep({
      entity: "subscription",
      fields: [
        "*",
        "cart.*",
        "cart.items.*",
        "cart.items.variant.*",
        "cart.shipping_address.*",
        "cart.billing_address.*",
        "cart.shipping_methods.*",
        "customer.*",
      ],
      filters: {
        id: input.subscription_id,
      },
      options: {
        throwIfKeyNotFound: true,
      },
    })

    // Build the order-data shape so a future order-creation step can be
    // dropped in here without changing this contract.
    const orderData = transform({ subscriptions }, (data) => {
      const subscription = data.subscriptions[0] as any
      const cart = subscription.cart

      return {
        region_id: cart?.region_id,
        customer_id: subscription.customer_id,
        sales_channel_id: cart?.sales_channel_id,
        email: cart?.email,
        currency_code: cart?.currency_code,
        shipping_address: cart?.shipping_address
          ? { ...cart.shipping_address, id: undefined }
          : undefined,
        billing_address: cart?.billing_address
          ? { ...cart.billing_address, id: undefined }
          : undefined,
        items: cart?.items?.map((item: any) => ({
          variant_id: item.variant_id,
          quantity: subscription.quantity || item.quantity,
          unit_price: item.unit_price,
          title: item.title,
        })),
        metadata: {
          subscription_id: subscription.id,
          renewal: true,
          renewal_date: new Date().toISOString(),
        },
      }
    })

    // Surface the seed values for the entitlement step.
    const grantInputs = transform({ subscriptions }, (data) => {
      const subscription = data.subscriptions[0] as any
      return {
        subscription_id: subscription.id,
        customer_id: subscription.customer_id ?? null,
        product_id: subscription.product_id ?? null,
        variant_id: subscription.variant_id ?? null,
      }
    })

    // TODO(creator-commerce/slice-A-followup): real order creation +
    // off-session Stripe capture replaces the no-op below. Failure here
    // must throw so the calling job can route to the failure workflow.

    // Advance subscription dates idempotently — recordSubscriptionOrder
    // bumps last_order_date and computes next_order_date.
    const { subscription } = updateSubscriptionStep({
      subscription_id: input.subscription_id,
      action: "record_order",
    })

    // Grant per-cycle entitlements with subscription provenance.
    const entitlementResult = grantSubscriptionEntitlementsStep({
      subscription_id: grantInputs.subscription_id,
      customer_id: grantInputs.customer_id,
      product_id: grantInputs.product_id,
      variant_id: grantInputs.variant_id,
    })

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
      order_data: orderData,
      granted_entitlements: entitlementResult.granted_count,
    })
  }
)
