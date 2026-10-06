import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../shared/logger"
import { SUBSCRIPTION_MODULE } from "../../modules/subscription"
import type SubscriptionModuleService from "../../modules/subscription/service"
import { extractPaymentMethodId } from "../../lib/blackout-checkout"

const log = createLogger("workflows/subscription/auto-renew")

/**
 * Container-side pieces of the affirmative auto-renew approval
 * (FF_CONSUMER_SUBSCRIPTIONS_V1). The decisions themselves are pure
 * (modules/subscription/utils/auto-renew.ts) and the writes are guarded in the
 * service (`withdrawAutoRenew`, `approveAutoRenew`); this file adds the two
 * lookups the service module cannot make — the cart's lines and its payment
 * session — and the post-purchase card save.
 */

type CartLines = { item_count: number; product_ids: string[]; quantities: number[] }

/**
 * The cart's line items, or null when the cart cannot be read. A subscription
 * cart must hold exactly one line: the subscription records only the first
 * order item, while a renewal re-buys every line — so a second line would be
 * renewed on an approval the customer gave for the first. The line's quantity
 * is reported too: a renewal re-buys it, so a seat is checked out as one.
 */
export async function subscriptionCartLines(
  container: MedusaContainer,
  cartId: string
): Promise<CartLines | null> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "items.id", "items.product_id", "items.quantity"],
      filters: { id: cartId },
    })
    type Line = { product_id?: string | null; quantity?: unknown }
    const cart = (data as Array<{ items?: Array<Line | null> | null }>)[0]
    if (!cart) return null
    const items = (cart.items ?? []).filter((item): item is Line => !!item)
    return {
      item_count: items.length,
      product_ids: items
        .map((item) => item.product_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
      quantities: items.map((item) => Number(item.quantity)),
    }
  } catch (error) {
    log.warn(
      `[auto-renew] cart line lookup failed for ${cartId}: ${(error as Error)?.message ?? error}`
    )
    return null
  }
}

type SessionRow = { status?: string | null; data?: unknown }

/** The saved card on the cart's payment session — the authorized one first. */
async function cartPaymentMethodId(
  container: MedusaContainer,
  cartId: string
): Promise<string | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: cartId },
  })
  const cart = (data as Array<{
    payment_collection?: { payment_sessions?: Array<SessionRow | null> | null } | null
  }>)[0]
  const sessions = (cart?.payment_collection?.payment_sessions ?? []).filter(
    (s): s is SessionRow => !!s
  )
  const ordered = [
    ...sessions.filter((s) => s.status === "authorized" || s.status === "captured"),
    ...sessions.filter((s) => s.status !== "authorized" && s.status !== "captured"),
  ]
  for (const session of ordered) {
    const pm = extractPaymentMethodId(session.data)
    if (pm) return pm
  }
  return null
}

export type SavePaymentMethodResult =
  | { saved: true; payment_method_id: string }
  | { saved: false; reason: "not_approved" | "no_payment_method" | "lookup_failed" }

/**
 * After the order completes, keep the card for off-session renewals — ONLY
 * when the customer approved auto-renewal and the subscription was created
 * until cancelled. With no approval nothing is written: the subscription never
 * renews, so there is nothing to charge the card for.
 *
 * The storefront asks Stripe to keep the card (`setup_future_usage:
 * "off_session"`) on the payment session of an approved subscription cart only
 * (storefront/src/lib/subscriptions/auto-renew.ts); so does the Blackout hosted
 * checkout for a recurring listing under the flag
 * (commerce/checkout/sessions/[token]/page), which calls this too.
 *
 * Best-effort: a failure is logged, never thrown — the order and subscription
 * exist, and a renewal with no card goes to dunning rather than renewing free.
 */
export async function saveAutoRenewPaymentMethod(
  container: MedusaContainer,
  args: {
    subscription: { id: string; auto_renew_approved?: boolean | null; expiration_date?: unknown }
    cart_id: string
  }
): Promise<SavePaymentMethodResult> {
  const { subscription } = args
  const renews =
    subscription.auto_renew_approved === true &&
    (subscription.expiration_date === null || subscription.expiration_date === undefined)
  if (!renews) return { saved: false, reason: "not_approved" }

  try {
    const pm = await cartPaymentMethodId(container, args.cart_id)
    if (!pm) {
      log.warn(
        `[auto-renew] subscription ${subscription.id} approved auto-renewal but its cart ` +
          `${args.cart_id} carries no saved payment method; the first renewal will go to dunning`
      )
      return { saved: false, reason: "no_payment_method" }
    }
    const service = container.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
    await service.updateSubscriptions({
      selector: { id: subscription.id },
      data: { payment_method_id: pm },
    })
    return { saved: true, payment_method_id: pm }
  } catch (error) {
    log.error(`[auto-renew] failed to save the payment method for ${subscription.id}:`, error)
    return { saved: false, reason: "lookup_failed" }
  }
}
