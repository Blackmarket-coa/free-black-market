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

/**
 * Every non-empty string held under a key ending in "secret" in `value`.
 * Cycle-safe: a payload that could not be serialized is walked as it is.
 */
function secretValues(value: unknown, found: string[] = [], seen = new Set<object>()): string[] {
  if (value && typeof value === "object") {
    if (seen.has(value)) return found
    seen.add(value)
  }
  if (Array.isArray(value)) {
    for (const inner of value) secretValues(inner, found, seen)
  } else if (isPlainObject(value)) {
    for (const [key, inner] of Object.entries(value)) {
      if (isSecretKey(key)) {
        if (typeof inner === "string" && inner && inner !== REDACTED) found.push(inner)
      } else {
        secretValues(inner, found, seen)
      }
    }
  }
  return found
}

/**
 * `text` with every secret that `payload` carries replaced by
 * {@link REDACTED}. For the far end's response body, which is stored on the
 * delivery and returned with it: a response that echoes the request it
 * refused would otherwise put the secret straight back.
 */
export function scrubSecretsFrom(text: string | null, payload: unknown): string | null {
  if (!text) return text
  let out = text
  for (const secret of secretValues(asSent(payload))) {
    out = out.split(secret).join(REDACTED)
  }
  return out
}

/**
 * `payload` as the JSON that was sent, so a json column handed back as
 * something other than plain objects still has its secrets found. Never
 * throws: whatever cannot be serialized is read as it is.
 */
function asSent(payload: unknown): unknown {
  try {
    const sent = JSON.stringify(payload)
    return sent === undefined ? payload : JSON.parse(sent)
  } catch {
    return payload
  }
}
