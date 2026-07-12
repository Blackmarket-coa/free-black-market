/**
 * Pure input-shaping helpers for the subscription renewal order path
 * (Creator-Commerce Slice A). Kept free of any container / I/O so they are
 * unit-testable without a database or Stripe — the workflow composes the
 * Medusa core-flows (createCart → payment collection → session → authorize →
 * completeCart) around these shapes.
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
 * Build the off-session context passed to the payment provider so the saved
 * payment method is charged without customer interaction.
 */
export function buildRenewalPaymentContext(subscription: RenewalSubscription) {
  return {
    off_session: true,
    subscription_id: subscription.id,
    payment_method_id: subscription.payment_method_id ?? undefined,
    stripe_subscription_id: subscription.stripe_subscription_id ?? undefined,
  }
}

/**
 * Build the input for `createPaymentSessionsWorkflow` from the renewal cart's
 * payment collection and the subscription's saved payment context.
 */
export function buildRenewalPaymentSessionInput(args: {
  payment_collection_id: string
  subscription: RenewalSubscription
  provider_id?: string
}) {
  return {
    payment_collection_id: args.payment_collection_id,
    provider_id: args.provider_id ?? SUBSCRIPTION_PAYMENT_PROVIDER_ID,
    customer_id: args.subscription.customer_id ?? undefined,
    context: buildRenewalPaymentContext(args.subscription),
    data: buildRenewalPaymentContext(args.subscription),
  }
}
