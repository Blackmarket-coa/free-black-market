"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { fetchQuery } from "../config"
import { getAuthHeaders, getCacheTag, removeCartId } from "./cookies"
import { addToCart, retrieveCart, updateCart } from "./cart"
import {
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
  SUBSCRIPTION_CHECKOUT_METADATA_KEY,
  type StoreSubscription,
  type StoredSubscriptionCheckout,
  type SubscriptionCheckout,
} from "@/lib/subscriptions/auto-renew"

/**
 * Consumer subscriptions (NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1). Every
 * caller is behind that flag; with it off nothing here is reached. The
 * backend's FF_CONSUMER_SUBSCRIPTIONS_V1 enforces the same rules again.
 */

type ActionResult = { ok: true } | { ok: false; error: string }

const errorOf = (res: { error?: { message?: string } | null }, fallback: string) =>
  res.error?.message || fallback

/** The signed-in customer's subscriptions, newest first. Empty on any failure. */
export async function listSubscriptions(): Promise<StoreSubscription[]> {
  const res = await fetchQuery("/store/subscriptions", {
    method: "GET",
    headers: { ...(await getAuthHeaders()) },
  })
  if (!res.ok) return []
  const list = (res.data as { subscriptions?: StoreSubscription[] } | null)?.subscriptions
  return Array.isArray(list) ? list : []
}

/**
 * The subscribe step: put the one subscription item in the cart and record
 * the customer's answer on it, then go to checkout. A subscription checks out
 * on its own — a cart that already holds items is refused here, and again by
 * the backend.
 */
export async function startSubscriptionCheckout(args: {
  variantId: string
  countryCode: string
  checkout: SubscriptionCheckout
}): Promise<ActionResult> {
  const existing = await retrieveCart().catch(() => null)
  if (existing?.items?.length) {
    return {
      ok: false,
      error:
        "Your cart already has items. A subscription checks out on its own — finish or empty your cart first.",
    }
  }

  await addToCart({ variantId: args.variantId, quantity: 1, countryCode: args.countryCode })
  const stored: StoredSubscriptionCheckout = { ...args.checkout, variant_id: args.variantId }
  await updateCart({
    metadata: { [SUBSCRIPTION_CHECKOUT_METADATA_KEY]: stored },
  })

  redirect(`/${args.countryCode}/checkout?step=address`)
}

/**
 * Complete a subscription cart through POST /store/subscriptions instead of
 * the ordinary cart completion: the backend completes the cart, creates the
 * subscription with the customer's recorded answer, and keeps the card only
 * when they approved auto-renewal.
 */
export async function completeSubscriptionCheckout(
  cartId: string,
  checkout: SubscriptionCheckout
): Promise<ActionResult> {
  const res = await fetchQuery("/store/subscriptions", {
    method: "POST",
    headers: { ...(await getAuthHeaders()) },
    body: {
      cart_id: cartId,
      interval: checkout.interval,
      period: 1,
      type: "membership",
      auto_renew_approved: checkout.auto_renew_approved,
      ...(checkout.auto_renew_approved && checkout.auto_renew_disclosure_version
        ? { auto_renew_disclosure_version: checkout.auto_renew_disclosure_version }
        : {}),
    },
  })

  if (!res.ok) {
    return { ok: false, error: errorOf(res, "The subscription could not be started.") }
  }

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
  revalidatePath("/user/orders")
  revalidatePath("/user/subscriptions")
  await removeCartId()
  redirect("/user/subscriptions")
}

/** Turn automatic renewal off: no further charges, access to the paid period end. */
export async function disableAutoRenew(subscriptionId: string): Promise<ActionResult> {
  return manage(subscriptionId, { action: "disable_auto_renew" })
}

/** Turn automatic renewal back on: a fresh approval of the current re-approval disclosure. */
export async function approveAutoRenew(subscriptionId: string): Promise<ActionResult> {
  return manage(subscriptionId, {
    action: "approve_auto_renew",
    auto_renew_approved: true,
    auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
  })
}

/** Cancel: stops all future charges. */
export async function cancelSubscription(subscriptionId: string): Promise<ActionResult> {
  return manage(subscriptionId, { action: "cancel" })
}

async function manage(
  subscriptionId: string,
  body: Record<string, unknown>
): Promise<ActionResult> {
  const res = await fetchQuery(`/store/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "POST",
    headers: { ...(await getAuthHeaders()) },
    body,
  })
  if (!res.ok) {
    return { ok: false, error: errorOf(res, "That change could not be made.") }
  }
  revalidatePath("/user/subscriptions")
  return { ok: true }
}
