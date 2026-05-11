/**
 * EscrowAgreement state machine.
 *
 * Stellar 2-of-3 multisig escrow state transitions. The model itself
 * stores `state` as text; this helper is the authoritative transition
 * table used by escrow workflows.
 *
 *     pending ──fund──► funded ──release──► released
 *                          │
 *                          ├──dispute──► disputed ──release──► released
 *                          │                   └──recover──► recovered
 *                          │
 *                          └──recover (time-locked)──► recovered
 *
 * The `recover` transition from `funded` is only valid after
 * `recovery_unlock_at`; this protects the buyer from premature
 * recovery and the vendor from premature release-without-delivery.
 */

export type EscrowState =
  | "pending"
  | "funded"
  | "released"
  | "disputed"
  | "recovered"

export type EscrowTransition =
  | "fund"
  | "release"
  | "dispute"
  | "recover"
  | "resolve_dispute_release"

const ALLOWED: Record<EscrowState, EscrowTransition[]> = {
  pending: ["fund"],
  funded: ["release", "dispute", "recover"],
  released: [],
  disputed: ["resolve_dispute_release", "recover"],
  recovered: [],
}

export type EscrowTransitionContext = {
  /** Now() supplied for testability. */
  now: Date
  /** Earliest time recovery may be executed. */
  recovery_unlock_at: Date | null
}

export const isAllowedTransition = (
  from: EscrowState,
  transition: EscrowTransition
): boolean => (ALLOWED[from] ?? []).includes(transition)

/**
 * Resolve the next state for a (from, transition) pair, applying
 * time-lock semantics for `recover`. Returns null if disallowed.
 */
export const resolveNextState = (
  from: EscrowState,
  transition: EscrowTransition,
  ctx: EscrowTransitionContext
): EscrowState | null => {
  if (!isAllowedTransition(from, transition)) return null

  if (transition === "recover") {
    // Time-lock: recovery from `funded` (auto-recovery path) requires
    // unlock time to have passed. From `disputed` the arbitrator can
    // recover at any time.
    if (from === "funded") {
      if (!ctx.recovery_unlock_at || ctx.now < ctx.recovery_unlock_at) {
        return null
      }
    }
    return "recovered"
  }

  if (transition === "fund") return "funded"
  if (transition === "release") return "released"
  if (transition === "dispute") return "disputed"
  if (transition === "resolve_dispute_release") return "released"

  return null
}
