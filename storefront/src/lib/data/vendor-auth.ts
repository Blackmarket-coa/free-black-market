"use server"

import { revalidatePath } from "next/cache"
import { medusaFetch } from "../config"
import { logger } from "../logger"
import {
  getSellerAuthHeaders,
  getSellerToken,
  removeSellerAuthToken,
  setSellerAuthToken,
} from "./cookies"
import {
  decodeJwtPayload,
  isTokenExpired,
  readSellerClaims,
  shouldRefreshToken,
} from "../helpers/seller-token"

/**
 * Seller sign-in for the in-app vendor surface.
 *
 * This is a PARALLEL, opt-in path — it does not change shopper login.
 * `customer.ts#login` still bounces seller emails to the vendor portal
 * with its existing message, because a seller account genuinely has no
 * shopper profile. A vendor reaches this surface deliberately, from the
 * vendor entry points or a push notification.
 *
 * Everything runs server-side on purpose. Two reasons, both load-bearing:
 *   - CORS: the MercurJS plugin fronts `/vendor/*` with its own allowlist
 *     that does not include the storefront origin, so a browser-side call
 *     dies at the preflight. Server-to-server has no preflight.
 *   - Custody: a seller bearer authorizes payout-capable endpoints. It
 *     stays in an httpOnly cookie and never enters page JS.
 */

export type SellerSession = {
  seller_id: string | null
  email: string | null
}

export type SellerLoginResult =
  | { ok: true }
  | { ok: false; error: string }

/** Sign a seller in and store their token in the seller cookie. */
export async function sellerLogin(input: {
  email: string
  password: string
}): Promise<SellerLoginResult> {
  const email = input.email?.trim()
  const password = input.password

  if (!email || !password) {
    return { ok: false, error: "Enter your email and password." }
  }

  try {
    const result = await medusaFetch<string | { token?: string }>(
      "/auth/seller/emailpass",
      {
        method: "POST",
        body: { email, password },
        cache: "no-store",
      }
    )

    // Medusa returns either a bare token string or { token }.
    const token = typeof result === "string" ? result : result?.token
    if (!token) {
      return { ok: false, error: "Sign-in failed. Please try again." }
    }

    const claims = readSellerClaims(token)
    if (!claims?.seller_id) {
      // An authenticated identity with no seller_id is a seller who has
      // not been approved yet (or a shopper email). Do not store it.
      return {
        ok: false,
        error:
          "This account is not an approved vendor yet. Once your application is approved you can sign in here.",
      }
    }

    await setSellerAuthToken(token)
    return { ok: true }
  } catch (error) {
    logger.warn("[vendor-auth] seller sign-in failed", error)
    return { ok: false, error: "Incorrect email or password." }
  }
}

/**
 * Sign the seller out. Detaches this device from seller pushes first so a
 * signed-out phone stops receiving vendor notifications, then clears the
 * cookie. The shopper session on the same device is untouched.
 */
export async function sellerLogout(pushToken?: string): Promise<void> {
  if (pushToken) {
    try {
      const headers = await getSellerAuthHeaders()
      if (headers) {
        await medusaFetch("/v1/seller/push-tokens", {
          method: "DELETE",
          body: { token: pushToken },
          cache: "no-store",
          headers,
        })
      }
    } catch (error) {
      // Best-effort: never block sign-out on the push detach.
      logger.warn("[vendor-auth] push detach on logout failed", error)
    }
  }

  await removeSellerAuthToken()
  revalidatePath("/", "layout")
}

/**
 * Keep an active vendor signed in.
 *
 * Medusa seller tokens last a day and nothing renews them, so without
 * this a vendor who taps an order push on day two lands on a login form.
 *
 * IMPORTANT: this writes a cookie, so it must only ever run in a context
 * Next.js allows that in — a server action invoked from the client, or a
 * route handler. Cookies are sealed during a Server Component render;
 * calling this from a page render would throw. `retrieveSellerSession`
 * below is therefore strictly read-only, and `VendorSessionKeeper`
 * invokes this from the client.
 */
export async function refreshSellerSession(): Promise<{ refreshed: boolean }> {
  const token = await getSellerToken()
  if (!token) return { refreshed: false }
  if (isTokenExpired(token, Date.now())) {
    await removeSellerAuthToken()
    return { refreshed: false }
  }
  if (!shouldRefreshToken(token, Date.now())) return { refreshed: false }

  try {
    const result = await medusaFetch<string | { token?: string }>(
      "/auth/token/refresh",
      {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      }
    )
    const refreshed = typeof result === "string" ? result : result?.token
    if (refreshed) {
      await setSellerAuthToken(refreshed)
      return { refreshed: true }
    }
  } catch (error) {
    // A failed refresh is not a sign-out: the current token stays valid
    // until its own expiry.
    logger.warn("[vendor-auth] seller token refresh failed", error)
  }
  return { refreshed: false }
}

/**
 * Current seller session, or null when signed out / expired.
 *
 * READ-ONLY by construction — it is called from Server Component renders,
 * where `cookies().set()` throws. An expired cookie is simply reported as
 * "no session" and left for `refreshSellerSession` (or the next sign-in)
 * to clear; it cannot authorize anything either way, and its own maxAge
 * matches the token lifetime.
 */
export async function retrieveSellerSession(): Promise<SellerSession | null> {
  const token = await getSellerToken()
  if (!token) return null
  if (isTokenExpired(token, Date.now())) return null

  const claims = readSellerClaims(token)
  if (!claims?.seller_id) return null

  const payload = decodeJwtPayload(token)
  const email = payload && typeof payload.email === "string" ? payload.email : null

  return { seller_id: claims.seller_id, email }
}

/**
 * Register this device for SELLER pushes. Called from the vendor surface
 * once a seller session exists; the buyer-side registration is separate
 * and unaffected.
 */
export async function registerSellerPushToken(input: {
  token: string
  platform: "ios" | "android"
}): Promise<{ ok: boolean }> {
  try {
    const headers = await getSellerAuthHeaders()
    if (!headers) return { ok: false }
    await medusaFetch("/v1/seller/push-tokens", {
      method: "POST",
      body: input,
      cache: "no-store",
      headers,
    })
    return { ok: true }
  } catch (error) {
    logger.warn("[vendor-auth] seller push registration failed", error)
    return { ok: false }
  }
}
