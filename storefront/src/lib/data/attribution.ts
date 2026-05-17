"use server"

import { cookies as nextCookies } from "next/headers"
import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

const AFF_COOKIE = "_fbm_aff"
const VISITOR_COOKIE = "_fbm_visitor"
// Marker so we don't re-POST attribution on every cart fetch.
const STAMPED_COOKIE_PREFIX = "_fbm_aff_applied_"

/**
 * If the visitor has a `_fbm_aff` cookie (set by the storefront middleware on
 * `?fbm_ref=`), POST it to the backend so the cart picks up the attribution.
 * Idempotent: short-circuits when this cart already has the same code applied.
 */
export async function applyAttributionToCart(cartId: string): Promise<void> {
  if (!cartId) return

  let cookieStore: Awaited<ReturnType<typeof nextCookies>>
  try {
    cookieStore = await nextCookies()
  } catch {
    return
  }

  const ref = cookieStore.get(AFF_COOKIE)?.value
  if (!ref) return

  const refCode = ref.split(".")[0]
  if (!refCode) return

  const stampKey = `${STAMPED_COOKIE_PREFIX}${cartId}`
  const stamped = cookieStore.get(stampKey)?.value
  if (stamped === refCode) return

  const visitorToken = cookieStore.get(VISITOR_COOKIE)?.value || undefined

  const headers = {
    ...((await getAuthHeaders()) ?? {}),
  }

  try {
    await medusaFetch(`/store/carts/${cartId}/attribution`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref_code: refCode,
        ...(visitorToken ? { visitor_token: visitorToken } : {}),
      }),
    } as any)

    cookieStore.set(stampKey, refCode, {
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
  } catch {
    // Attribution is best-effort; never block checkout because it failed.
  }
}
