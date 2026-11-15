import { createHmac, timingSafeEqual } from "crypto"

/**
 * Authentication for `POST /webhooks/suppliers/status`.
 *
 * One operator secret, one key per supplier. `SUPPLIER_WEBHOOK_SECRET` never
 * leaves the backend; each supplier is issued its own key,
 *
 *     supplier_key = hex(HMAC-SHA256(SUPPLIER_WEBHOOK_SECRET, supplier_id))
 *
 * and signs the exact request body with it,
 *
 *     x-fbm-signature = hex(HMAC-SHA256(supplier_key, raw_body))
 *
 * Deriving the key from the claimed `supplier_id` is what binds a request to
 * one supplier: supplier A holds only A's key, so it cannot produce a valid
 * signature over a body that says `supplier_id: "B"`. A single shared secret
 * handed to every supplier would let any of them sign as any other. The
 * supplier profile has no column for a secret, so the key is derived rather
 * than stored; revoking one supplier is `is_active: false` on its profile
 * (the route refuses inactive suppliers), and rotating the operator secret
 * re-keys all of them.
 *
 * The operator secret must be at least 32 characters. Every supplier holds an
 * HMAC of it over a known input, so a short one could be recovered offline by
 * any supplier and used to sign as the others; a short secret is treated as
 * unset and the route stays closed.
 */
export const SUPPLIER_WEBHOOK_SECRET_ENV = "SUPPLIER_WEBHOOK_SECRET"
export const SUPPLIER_WEBHOOK_SIGNATURE_HEADER = "x-fbm-signature"
export const SUPPLIER_WEBHOOK_MIN_SECRET_LENGTH = 32

/** The operator secret, or null when it is unset or too short to use. */
export function supplierWebhookSecret(
  env: Record<string, string | undefined> = process.env
): string | null {
  const secret = env[SUPPLIER_WEBHOOK_SECRET_ENV]
  if (!secret || secret.length < SUPPLIER_WEBHOOK_MIN_SECRET_LENGTH) return null
  return secret
}

/** The key issued to one supplier (hex). */
export function supplierWebhookKey(secret: string, supplierId: string): string {
  return createHmac("sha256", secret).update(supplierId, "utf8").digest("hex")
}

/** The signature a supplier sends for a body (hex). */
export function signSupplierWebhookBody(supplierKey: string, rawBody: Buffer | string): string {
  return createHmac("sha256", supplierKey).update(rawBody).digest("hex")
}

/**
 * True only when `signature` is the HMAC of `rawBody` under the key derived
 * for `supplierId`. Constant-time over equal-length digests; a missing or
 * malformed signature is false.
 */
export function verifySupplierWebhookSignature(input: {
  secret: string
  supplierId: string
  rawBody: Buffer
  signature: string | undefined
}): boolean {
  const provided = (input.signature ?? "").trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(provided)) return false

  const expected = signSupplierWebhookBody(
    supplierWebhookKey(input.secret, input.supplierId),
    input.rawBody
  )
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))
}
