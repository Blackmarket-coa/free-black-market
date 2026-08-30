import { createLogger } from "../shared/logger"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"

const log = createLogger("lib/karma-grants")

/**
 * Route-layer karma producers (W4, decision D7).
 *
 * Reputation writes ride the canonical hawala-ledger log via
 * `recordKarmaEvent`, and they are strictly best-effort: a review or an
 * admin verification decision must never fail because the reputation write
 * did. Deltas live here, in one reviewable table — `five_star_review`
 * mirrors the grower/wellness config that existed for years with no
 * emitter.
 */
export const KARMA_DELTAS = {
  /** Seller/provider receives this when a 5-star review lands. */
  five_star_review: 15,
  /** A verification badge granted by an operator. */
  verification_badge: 10,
} as const

export interface KarmaGrantInput {
  member_id: string
  delta: number
  reason: string
  source_module: string
  source_id: string
  metadata?: Record<string, unknown>
}

/**
 * Record one karma event from a request scope, swallowing (but logging)
 * every failure — including the hawala module being absent, which is how
 * several route harnesses run in unit tests.
 */
export async function grantKarmaBestEffort(
  scope: { resolve: (key: string) => unknown },
  input: KarmaGrantInput
): Promise<void> {
  try {
    const hawala = scope.resolve(HAWALA_LEDGER_MODULE) as {
      recordKarmaEvent: (input: KarmaGrantInput) => Promise<unknown>
    } | null
    if (!hawala?.recordKarmaEvent) return
    await hawala.recordKarmaEvent(input)
  } catch (error) {
    log.warn(
      `karma grant skipped (${input.reason} → ${input.member_id}): ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
