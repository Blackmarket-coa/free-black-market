import { createHmac, timingSafeEqual } from "crypto"

/**
 * Signed cart-handoff tokens for the native shell's buy-on-web flow.
 *
 * The shell WebView holds the `_medusa_cart_id` cookie, but the external
 * system browser it opens for checkout has its own cookie jar. The
 * handoff route (`/api/native/checkout-handoff`) therefore mints a
 * short-lived HMAC-signed token binding the cart id, and the GET leg
 * verifies it before re-setting the cookie in the external browser. The
 * signature stops link-crafted cart fixation (nobody without the server
 * secret can mint a token), and the TTL keeps a leaked link from staying
 * live.
 *
 * Pure functions — the route supplies the secret (NATIVE_HANDOFF_SECRET)
 * and clock, which keeps this module unit-testable. Token format:
 * `base64url(cartId|expiresAtMs).base64url(hmacSha256)`.
 */

export const HANDOFF_TOKEN_TTL_MS = 5 * 60 * 1000

const sign = (payload: string, secret: string): Buffer =>
  createHmac("sha256", secret).update(payload).digest()

export function mintHandoffToken(
  cartId: string,
  secret: string,
  now: number = Date.now()
): string {
  const payload = Buffer.from(`${cartId}|${now + HANDOFF_TOKEN_TTL_MS}`).toString(
    "base64url"
  )
  const signature = sign(payload, secret).toString("base64url")
  return `${payload}.${signature}`
}

/** Returns the cart id for a valid, unexpired token; null otherwise. */
export function verifyHandoffToken(
  token: string,
  secret: string,
  now: number = Date.now()
): string | null {
  if (!token || token.length > 512) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payload, signature] = parts

  let providedSig: Buffer
  try {
    providedSig = Buffer.from(signature, "base64url")
  } catch {
    return null
  }
  const expectedSig = sign(payload, secret)
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return null
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8")
  const sep = decoded.lastIndexOf("|")
  if (sep <= 0) return null
  const cartId = decoded.slice(0, sep)
  const expiresAt = Number(decoded.slice(sep + 1))
  if (!Number.isFinite(expiresAt) || now > expiresAt) return null
  return cartId
}
