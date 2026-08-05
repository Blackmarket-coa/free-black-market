import { createHash } from "crypto"

/**
 * Deterministic idempotency keys for client-initiated money movements.
 *
 * Server-driven transfers get a natural business key — a bounty payout is
 * `bounty-payout-${bounty_id}-m${milestone_index}`, which is stable by
 * construction. Client-initiated deposits, withdrawals and investments have no
 * such key, and the endpoints previously reached for `Date.now()` or
 * `randomUUID()`. Both guarantee the opposite of idempotency: every retry
 * produces a fresh key, so the ledger's `idempotency_key` UNIQUE constraint
 * never matches and the operation runs again.
 *
 * That is worst on `deposit` and `withdraw`, which hand the key to Stripe
 * *before* writing to the ledger — so a retry moves real money at the bank
 * before reaching the row that would have rejected it.
 *
 * The key comes from the caller's `Idempotency-Key` header, following the
 * precedent already set by the vendor-hype positions route. Clients should
 * generate one per user action and reuse it across retries of that action.
 */

/**
 * Width of the fallback bucket. Retries of one action land in the same bucket
 * and collapse; deliberate repeats minutes later do not.
 */
const DERIVED_BUCKET_MS = 15 * 60 * 1000

export type IdempotencyKeySource = "header" | "body" | "derived"

export type ResolvedIdempotencyKey = {
  /** Deterministic key, safe to pass to the ledger and to Stripe. */
  key: string
  /** Where it came from — `derived` means the client sent none. */
  source: IdempotencyKeySource
}

function readHeader(headers: unknown, name: string): string | undefined {
  const bag = (headers ?? {}) as Record<string, string | string[] | undefined>
  const raw = bag[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Resolve a deterministic idempotency key for a money-moving request.
 *
 * Preference order:
 *  1. `Idempotency-Key` header — the client controls the retry boundary.
 *  2. `idempotency_key` in the body, matching the vendor-hype precedent.
 *  3. Derived from actor + scope + payload + a coarse time bucket.
 *
 * The derived fallback exists so tightening this does not break callers that
 * predate the header. It is a transitional safety net, not the intended path:
 * it collapses a fast retry of the same action (the case that caused double
 * charges) while leaving a deliberate identical repeat in a later bucket free
 * to proceed. Callers that care about exactness must send the header — see
 * `nowMs` for why the bucket alone cannot be exact.
 */
export function resolveRequestIdempotencyKey(params: {
  /** Short operation name, e.g. `deposit`. Namespaces the key. */
  scope: string
  /** The acting customer/seller/user id, so keys cannot collide across actors. */
  actorId: string
  headers?: unknown
  body?: unknown
  /**
   * Payload the key should be derived from when the client sends none.
   * Include every field that makes the operation distinct (amount, target
   * account), and nothing incidental.
   */
  payload?: unknown
  /** Injectable clock, for deterministic tests. */
  nowMs?: number
}): ResolvedIdempotencyKey {
  const { scope, actorId, headers, body, payload, nowMs } = params

  const headerKey = readHeader(headers, "idempotency-key")
  if (headerKey) {
    return { key: `${scope}-${actorId}-${hash(headerKey)}`, source: "header" }
  }

  const bodyKey = (body as { idempotency_key?: unknown } | undefined)
    ?.idempotency_key
  if (typeof bodyKey === "string" && bodyKey.trim().length > 0) {
    return { key: `${scope}-${actorId}-${hash(bodyKey.trim())}`, source: "body" }
  }

  const bucket = Math.floor((nowMs ?? Date.now()) / DERIVED_BUCKET_MS)
  const derived = hash(
    JSON.stringify({ scope, actorId, payload: payload ?? null, bucket })
  )
  return { key: `${scope}-${actorId}-${derived}`, source: "derived" }
}

function hash(value: string): string {
  // 32 hex chars — 128 bits, collision-resistant at any realistic volume,
  // while keeping the stored key short.
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}
