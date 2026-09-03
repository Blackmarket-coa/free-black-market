/**
 * Which Blackstar lifecycle events may overwrite a shipment's status.
 *
 * Pure, container-free — the house pattern for anything that decides state.
 *
 * **Why this exists.** The bridge is at-least-once in both directions and
 * contract v1 has no sequence numbers, so independent retries can deliver
 * lifecycle events out of order (`docs/integrations/federated-logistics.md`
 * §8). The receiver applied last-writer-wins, which means a delayed
 * `shipment.in_transit` retry arriving after `shipment.delivered` would
 * rewind a delivered shipment to in-transit. The contract acknowledged this
 * and pushed it onto "downstream consumers reconciling shipment state".
 *
 * That was the wrong place for it. Every consumer would have to re-derive the
 * same rule, and any consumer that forgot would be silently wrong about
 * whether a parcel arrived. The receiver knows the current status and the
 * incoming one; it is the only place the rule has to be written once.
 *
 * This closes the FBM half of §9.3 without a contract change. A monotonic
 * per-shipment sequence number is still the complete fix and still needs both
 * sides — it stays an open contract item. What this removes is the class of
 * corruption FBM can prevent alone.
 */

/** Lifecycle states, as mapped from event types by `STATUS_FOR_BLACKSTAR_EVENT`. */
export type ShipmentStatus =
  | "claimed"
  | "in_transit"
  | "delivered"
  | "disputed"
  | "cancelled"

/**
 * How far along the happy path a status is.
 *
 * Only the forward-progress states are ranked. `disputed` and `cancelled` are
 * not points on this line — they are exits from it, and are handled
 * separately below rather than given a rank they would have to fake.
 */
const PROGRESS_RANK: Record<string, number> = {
  claimed: 1,
  in_transit: 2,
  delivered: 3,
}

/**
 * Exits from the happy path.
 *
 * `cancelled` ends a shipment that never arrived. `disputed` is a claim about
 * one that may well have arrived — a buyer disputes *after* delivery at least
 * as often as before it — so it is reachable from anywhere, `delivered`
 * included.
 */
const EXIT_STATES: readonly string[] = ["disputed", "cancelled"]

/**
 * States nothing may follow.
 *
 * `cancelled` and `disputed` are where a shipment's automated lifecycle ends:
 * whatever happens next is a human decision recorded elsewhere (an
 * `order_dispute` resolution, a re-listing), not a webhook that quietly
 * rewrites history. `delivered` is deliberately NOT terminal — it can still
 * be disputed.
 */
const TERMINAL_STATES: readonly string[] = ["cancelled", "disputed"]

export function isExitState(status: string): boolean {
  return EXIT_STATES.includes(status)
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_STATES.includes(status)
}

export type StatusDecision = {
  /** Whether the incoming status should be written. */
  apply: boolean
  /**
   * Why not, when it is not. Recorded on the shipment so an operator
   * reconciling a confusing timeline can see that an event arrived and was
   * deliberately not applied, rather than wondering whether it was lost.
   */
  reason:
    | "applied"
    | "first_status"
    | "same_status"
    | "out_of_order"
    | "terminal"
    | "unknown_status"
}

/**
 * May `incoming` overwrite `current`?
 *
 * The rules, in order:
 *
 * 1. No current status — anything applies.
 * 2. Identical status — a duplicate; harmless, but reported as such rather
 *    than counted as progress.
 * 3. Current status is terminal (`cancelled` / `disputed`) — nothing applies.
 *    A late `in_transit` must not reopen a cancelled shipment.
 * 4. Incoming is an exit (`disputed` / `cancelled`) — applies from any
 *    non-terminal state, `delivered` included.
 * 5. Both are progress states — applies only if it moves forward. This is the
 *    rule that stops a delayed retry rewinding `delivered` to `in_transit`.
 * 6. An unrecognised status never overwrites a known one. A newer Blackstar
 *    may add lifecycle states; guessing where an unknown one sits on the line
 *    would be worse than leaving the last known-good status in place.
 */
export function decideStatusWrite(
  current: string | null | undefined,
  incoming: string
): StatusDecision {
  if (!current) return { apply: true, reason: "first_status" }
  if (current === incoming) return { apply: false, reason: "same_status" }

  if (isTerminalStatus(current)) return { apply: false, reason: "terminal" }

  if (isExitState(incoming)) return { apply: true, reason: "applied" }

  const incomingRank = PROGRESS_RANK[incoming]
  const currentRank = PROGRESS_RANK[current]

  if (incomingRank === undefined) return { apply: false, reason: "unknown_status" }
  // A known incoming status against an unknown current one: treat the unknown
  // as unranked and let the known one land, so an unfamiliar state cannot
  // wedge a shipment permanently.
  if (currentRank === undefined) return { apply: true, reason: "applied" }

  if (incomingRank > currentRank) return { apply: true, reason: "applied" }
  return { apply: false, reason: "out_of_order" }
}
