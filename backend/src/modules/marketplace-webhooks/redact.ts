/**
 * Secrets inside a stored delivery's payload.
 *
 * A delivery row keeps the exact envelope it will send, because a retry or a
 * replay has to send the same bytes. One Blackstar event carries a secret in
 * that envelope: `node.operator.approved` holds the credential a seller's
 * node signs with, at `payload.credential.secret`. So the plaintext sat in
 * `marketplace_webhook_delivery.payload` for good, and
 * `GET /admin/blackstar/deliveries` returned it to any admin (measured on
 * Postgres).
 *
 * Two uses, both in `service.ts`:
 * - on read: whatever returns a Blackstar delivery to a caller returns it
 *   through {@link redactSecrets};
 * - at rest: once Blackstar has accepted a delivery it is never sent again
 *   (a replay refuses a succeeded row), so its payload is rewritten through
 *   {@link redactSecrets} and the secret is gone from the table.
 *
 * A delivery that has not succeeded (pending, failed and awaiting its retry,
 * or dead) still holds the secret at rest: sending it is what the row is for.
 */

/** What a secret reads as wherever a stored delivery is shown, or kept after delivery. */
export const REDACTED = "[redacted]"

/** `secret`, `client_secret`, `signingSecret`: any key that ends in "secret". */
const isSecretKey = (key: string): boolean => /secret$/i.test(key)

/** A JSON object, as a stored payload's are; not a Date or another class instance. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * A deep copy of `value` with every value under a key ending in "secret"
 * replaced by {@link REDACTED}. Everything else, key ids included, is kept,
 * so a redacted delivery still says which credential it carried.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((inner) => redactSecrets(inner)) as unknown as T
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      out[key] =
        isSecretKey(key) && inner !== null && inner !== undefined
          ? REDACTED
          : redactSecrets(inner)
    }
    return out as T
  }
  return value
}
