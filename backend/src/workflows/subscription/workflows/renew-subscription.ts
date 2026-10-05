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
import { chargeSubscriptionRenewalStep } from "../steps/charge-subscription-renewal"
import { grantSubscriptionEntitlementsStep } from "../steps/grant-subscription-entitlements"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import {
  buildRenewalCartInput,
  buildRenewalRecordSessionInput,
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
 *   3. Creates a payment collection, then COLLECTS the cycle's charge with a
 *      direct off-session Stripe PaymentIntent (confirm + automatic capture)
 *      on the saved payment method — `chargeSubscriptionRenewalStep`, which
 *      records the charge on the subscription, keyed by the record
 *      (subscription id + period start), BEFORE the period rolls in step 5.
 *      The order gets a bookkeeping session on the system provider carrying
 *      the PaymentIntent id (renew-helpers `RENEWAL_RECORD_PROVIDER_ID`).
 *      (Previously this step asked the Medusa Stripe provider with keys it
 *      ignores and manual capture by default, so nothing was collected.)
 *   4. Completes the cart into an order and links it to the subscription
 *      (subscription↔order link, `isList` so each renewal appends)
 *   5. Advances the subscription dates and grants per-cycle entitlements with
 *      `source=SUBSCRIPTION` + `source_subscription_id` provenance, keyed by
 *      the new order id
 *   6. Emits `subscription.renewal_processed`
 *
 * Any failure in steps 2–4 throws, so the calling job routes to
 * `handleSubscriptionFailureWorkflow` (dunning + pause-on-max-retries) and the
 * core-flow compensations roll back the partial cart. A charge that already
 * succeeded is not refunded; it stays recorded for the cycle and is not
 * presented again on the retry. A missing saved payment method throws in the
 * charge step — a dunning failure, never a free renewal.
 *
 * In legacy mode (flag unset) the order/payment steps are skipped: dates are
 * advanced and entitlements granted exactly as before — i.e. the renewal is
 * FREE. That is the pre-existing behaviour, kept byte-identical here and
 * recorded for the ledger; it is why FBM_SUBSCRIPTION_RENEWAL_LIVE must be set
 * before any paid recurring product is sold.
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
        fields: ["id", "total", "currency_code", "payment_collection.id"],
        filters: { id: cart.id },
        options: { throwIfKeyNotFound: true },
      }).config({ name: "renewal-cart-payment-collection" })

      // 3. Collect the cycle's charge (recorded on the subscription first),
      //    then give the order a system-provider session recording it.
      const chargeInput = transform({ cartsWithPc, input }, (data) => {
        const row = data.cartsWithPc[0] as unknown as {
          total: number | string
          currency_code: string
        }
        return {
          subscription_id: data.input.subscription_id,
          amount: row.total,
          currency_code: row.currency_code,
        }
      })
      const charge = chargeSubscriptionRenewalStep(chargeInput)

      const sessionInput = transform(
        { cartsWithPc, charge, input },
        (data) =>
          buildRenewalRecordSessionInput({
            payment_collection_id: (
              data.cartsWithPc[0] as unknown as {
                payment_collection?: { id?: string } | null
              }
            ).payment_collection?.id as string,
            subscription_id: data.input.subscription_id,
            payment_intent_id: data.charge.payment_intent_id ?? "",
            idempotency_key: data.charge.idempotency_key,
          })
      )
      const paymentSession = createPaymentSessionsWorkflow.runAsStep({
        input: sessionInput,
      })

      authorizePaymentSessionStep({
        id: paymentSession.id,
        context: {},
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

      // 5. Advance dates + grant entitlements keyed by the new order. The
      //    grant carries the rolled-forward `next_order_date` and the Blackout
      //    listing id (when present) so tier feature bundles extend each
      //    cycle instead of expiring after the first one.
      const { subscription } = updateSubscriptionStep({
        subscription_id: input.subscription_id,
        action: "record_order",
      })

      const grantInputs = transform(
        { subscriptions, order, subscription },
        (data) => {
          const sub = data.subscriptions[0] as RenewalSubscription & {
            product_id?: string | null
            variant_id?: string | null
            seller_id?: string | null
            metadata?: Record<string, unknown> | null
          }
          const updated = data.subscription as {
            next_order_date?: Date | string | null
          }
          const creatorListingId = sub.metadata?.["creator_listing_id"]
          return {
            subscription_id: sub.id,
            customer_id: sub.customer_id ?? null,
            product_id: sub.product_id ?? null,
            variant_id: sub.variant_id ?? null,
            order_id: data.order.id as string,
            creator_listing_id:
              typeof creatorListingId === "string" ? creatorListingId : null,
            seller_id: sub.seller_id ?? null,
            expires_at: updated.next_order_date ?? null,
          }
        }
      )
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
    const { subscription } = updateSubscriptionStep({
      subscription_id: input.subscription_id,
      action: "record_order",
    })

    const grantInputs = transform({ subscriptions, subscription }, (data) => {
      const sub = data.subscriptions[0] as RenewalSubscription & {
        product_id?: string | null
        variant_id?: string | null
        seller_id?: string | null
        metadata?: Record<string, unknown> | null
      }
      const updated = data.subscription as {
        next_order_date?: Date | string | null
      }
      const creatorListingId = sub.metadata?.["creator_listing_id"]
      return {
        subscription_id: sub.id,
        customer_id: sub.customer_id ?? null,
        product_id: sub.product_id ?? null,
        variant_id: sub.variant_id ?? null,
        creator_listing_id:
          typeof creatorListingId === "string" ? creatorListingId : null,
        seller_id: sub.seller_id ?? null,
        expires_at: updated.next_order_date ?? null,
      }
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
