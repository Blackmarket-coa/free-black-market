import { createHash } from "crypto"
import { cache } from "./cache"
import { createLogger } from "./logger"

const log = createLogger("shared/idempotency-store")

type IdempotencyRecord = {
  key: string
  fingerprint: string
  seen_at: string
}

const inMemoryFallback = new Map<string, IdempotencyRecord>()

function toFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function buildStorageKey(scope: string, idempotencyKey: string): string {
  return `idempotency:${scope}:${idempotencyKey}`
}

export async function checkAndStoreIdempotency(params: {
  scope: string
  idempotencyKey?: string
  payload: unknown
  ttlSeconds?: number
}) {
  const { scope, idempotencyKey, payload, ttlSeconds = 24 * 60 * 60 } = params

  if (!idempotencyKey) {
    return { duplicate: false as const }
  }

  const key = buildStorageKey(scope, idempotencyKey)
  const fingerprint = toFingerprint(payload)

  const existing = await cache.get<IdempotencyRecord>(key)
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return {
        duplicate: true as const,
        conflict: true as const,
        message: "idempotency_key already used with a different payload fingerprint",
      }
    }

    return { duplicate: true as const, conflict: false as const }
  }

  const record: IdempotencyRecord = {
    key,
    fingerprint,
    seen_at: new Date().toISOString(),
  }

  const cached = await cache.set(key, record, ttlSeconds)
  if (!cached) {
    // The shared store is unreachable, so we fall back to a per-process Map.
    // That is a real guard for a single instance and NO guard at all across a
    // multi-instance deploy: a replay routed to another instance sees an empty
    // map and passes. Surfaced as `degraded` rather than silently pretending
    // the check held, so callers can decide (mirroring the `degraded` flag
    // convention used for Matrix outages).
    log.warn(
      `[idempotency] shared store unavailable for scope "${scope}"; falling back to per-process memory. Replays across instances will not be caught.`
    )

    const fallback = inMemoryFallback.get(key)
    if (fallback) {
      if (fallback.fingerprint !== fingerprint) {
        return {
          duplicate: true as const,
          conflict: true as const,
          degraded: true as const,
          message: "idempotency_key already used with a different payload fingerprint",
        }
      }

      return { duplicate: true as const, conflict: false as const, degraded: true as const }
    }

    inMemoryFallback.set(key, record)
    return { duplicate: false as const, degraded: true as const }
  }

  return { duplicate: false as const }
}
