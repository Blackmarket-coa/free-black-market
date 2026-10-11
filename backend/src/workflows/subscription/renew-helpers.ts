/**
 * Pure input-shaping helpers for the subscription renewal order path
 * (Creator-Commerce Slice A). Kept free of any container / I/O so they are
 * unit-testable without a database or Stripe — the workflow composes the
 * Medusa core-flows (createCart → payment collection → direct charge →
 * system session → authorize → completeCart) around these shapes.
 */

export type RenewalCartAddress = Record<string, unknown> & { id?: unknown }

export type RenewalCartData = {
  region_id?: string | null
  sales_channel_id?: string | null
  email?: string | null
  currency_code?: string | null
  shipping_address?: RenewalCartAddress | null
  billing_address?: RenewalCartAddress | null
  items?: Array<{
    variant_id?: string | null
    quantity?: number | null
    unit_price?: number | null
    title?: string | null
  }> | null
}

export type RenewalSubscription = {
  id: string
  customer_id?: string | null
  quantity?: number | null
  payment_method_id?: string | null
  stripe_subscription_id?: string | null
  cart?: RenewalCartData | null
}

/**
 * The Stripe (or other off-session-capable) payment provider used for
 * unattended renewal charges. Overridable per environment; defaults to the
 * conventional Medusa Stripe provider id.
 */
export const SUBSCRIPTION_PAYMENT_PROVIDER_ID =
  process.env.FBM_SUBSCRIPTION_PAYMENT_PROVIDER_ID ?? "pp_stripe_stripe"

/**
 * Build the `createCartWorkflow` input for a renewal by cloning the
 * subscription's template cart. The original cart already became the initial
 * order, so a fresh cart is minted each cycle; addresses are cloned without
 * their ids so new address rows are created.
 */
export function buildRenewalCartInput(subscription: RenewalSubscription) {
  const cart = subscription.cart ?? {}

  const stripAddress = (
    addr: RenewalCartAddress | null | undefined
  ): Record<string, unknown> | undefined => {
    if (!addr) {
      return undefined
    }
    const { id: _id, ...rest } = addr
    return rest
  }

  const items = (cart.items ?? [])
    .filter((item) => !!item?.variant_id)
    .map((item) => ({
      variant_id: item.variant_id as string,
      quantity: subscription.quantity || item.quantity || 1,
      unit_price: item.unit_price ?? undefined,
      title: item.title ?? undefined,
      metadata: { subscription_renewal: true },
    }))

  return {
    region_id: cart.region_id ?? undefined,
    customer_id: subscription.customer_id ?? undefined,
    sales_channel_id: cart.sales_channel_id ?? undefined,
    email: cart.email ?? undefined,
    currency_code: cart.currency_code ?? undefined,
    shipping_address: stripAddress(cart.shipping_address),
    billing_address: stripAddress(cart.billing_address),
    items,
    metadata: {
      subscription_id: subscription.id,
      renewal: true,
      // Explicit channel stamp (Phase 3A); the attribute-channel-on-placed
      // subscriber would also infer `subscription` from subscription_id, but
      // the stamp keeps one mechanism across all order-creation paths.
      order_channel: "subscription",
    },
  }
}

/**
 * The provider for the renewal order's bookkeeping payment session.
 *
 * The money for a live renewal is collected BEFORE the order exists, by a
 * direct off-session Stripe PaymentIntent (`../renewal-charge.ts`, the
 * vendor-plan pattern). The order still needs an authorized payment session
 * for `completeCartWorkflow`, so it gets one on Medusa's built-in system
 * provider, which every payment module registers as `pp_system_default`
 * (@medusajs/payment 2.14.2 dist/loaders/providers.js registers
 * `SystemPaymentProvider` with id "default"; its `authorizePayment` returns
 * AUTHORIZED and touches no rail).
 *
 * The session data names the PaymentIntent, but it does not survive:
 * authorization writes the provider's answer over the session's and the new
 * payment's `data`, and the system provider answers `{}` (as it does to
 * capture and refund). So the record that ties the order to its charge is
 * stamped on the PAYMENT's `metadata` once the order exists
 * (`steps/subscription-order-settlement.ts`, SD-46), which no provider call
 * rewrites and no store route can set.
 *
 * Before this, the live path asked the Stripe provider for the session with
 * `payment_method_id` and no `confirm`; the installed provider reads only
 * `payment_method`/`confirm` (stripe-base.js:49-51) and authorizes by reading
 * status (stripe-base.js:149-151), with capture defaulting to manual
 * (stripe-base.js:31-34) — so no renewal could have collected.
 */
export const RENEWAL_RECORD_PROVIDER_ID = "pp_system_default"

/** The `collected_by` marker on a renewal charge record. */
export const RENEWAL_RECORD_COLLECTED_BY = "subscription_renewal_payment_intent"

/** Where the record sits in a renewal order's payment `metadata` (SD-46). */
export const RENEWAL_RECORD_METADATA_KEY = "subscription_renewal"

/** The record of the PaymentIntent that collected a renewal cycle. */
export function buildRenewalRecord(args: {
  subscription_id: string
  payment_intent_id: string
  idempotency_key: string
}) {
  return {
    collected_by: RENEWAL_RECORD_COLLECTED_BY,
    subscription_id: args.subscription_id,
    stripe_payment_intent_id: args.payment_intent_id,
    renewal_idempotency_key: args.idempotency_key,
  }
}

/**
 * Input for `createPaymentSessionsWorkflow` on the renewal cart: a system
 * session that records, rather than performs, the charge.
 */
export function buildRenewalRecordSessionInput(args: {
  payment_collection_id: string
  subscription_id: string
  payment_intent_id: string
  idempotency_key: string
}) {
  return {
    payment_collection_id: args.payment_collection_id,
    provider_id: RENEWAL_RECORD_PROVIDER_ID,
    data: buildRenewalRecord(args),
  }
}

/**
 * What a payment's provider and `metadata` claim about a renewal charge: the
 * subscription it names and the PaymentIntent that collected it, or null when
 * it carries no record shaped like `buildRenewalRecord`'s.
 *
 * Read as a claim, not proof. Only the renewal workflow writes payment
 * metadata, but the system provider authorizes anything and a store client can
 * pay on it wherever a region lists `pp_system_default` (the seed scripts do),
 * so a reader that moves money on this also checks that the order is linked
 * to the subscription named here — a link only the renewal workflow writes.
 */
export function renewalRecordClaim(
  providerId: unknown,
  metadata: unknown
): { subscription_id: string; payment_intent_id: string } | null {
  if (providerId !== RENEWAL_RECORD_PROVIDER_ID) return null
  const d = (((metadata ?? {}) as Record<string, unknown>)[RENEWAL_RECORD_METADATA_KEY] ?? {}) as Record<string, unknown>
  if (d.collected_by !== RENEWAL_RECORD_COLLECTED_BY) return null
  const subscriptionId = d.subscription_id
  const intentId = d.stripe_payment_intent_id
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) return null
  if (typeof intentId !== "string" || !intentId.startsWith("pi_")) return null
  return { subscription_id: subscriptionId, payment_intent_id: intentId }
}
