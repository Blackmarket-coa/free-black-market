/**
 * Order dispute lifecycle, filing window, and who may do what.
 *
 * Pure, container-free — the house pattern for anything that decides money.
 *
 * **This is the entry point, not a second arbitration engine.** The escrow
 * state machine in `hawala-ledger/escrow-state-machine.ts` already models
 * `funded → disputed → resolve_dispute_release / recover`, with tests, and it
 * is what moves escrowed funds. What did not exist was a way for a buyer to
 * *reach* it on an ordinary order: only service contracts and subcontracts
 * had a dispute route. This module is the case file and the queue.
 *
 * Most ordinary orders are not escrowed — they settle through Stripe and
 * payouts — so a dispute here is a claim with an admin resolution, and it
 * marks a linked escrow agreement disputed only when one actually exists for
 * the order. Nothing here pretends to freeze funds that are not held.
 */

export enum DisputeStatus {
  /** Buyer has raised it; the vendor can still respond. */
  OPEN = "open",
  /** An admin has picked it up. */
  UNDER_REVIEW = "under_review",
  /** Decided in the buyer's favour, in whole or in part. */
  RESOLVED_REFUND = "resolved_refund",
  /** Decided in the vendor's favour; funds stay with them. */
  RESOLVED_RELEASE = "resolved_release",
  /** Buyer withdrew it. */
  WITHDRAWN = "withdrawn",
}

export enum DisputeReason {
  NOT_RECEIVED = "not_received",
  NOT_AS_DESCRIBED = "not_as_described",
  DAMAGED = "damaged",
  INCOMPLETE = "incomplete",
  BILLING = "billing",
  OTHER = "other",
}

export type DisputeActor = "buyer" | "seller" | "admin"

export class DisputeStateError extends Error {}

const TERMINAL: readonly DisputeStatus[] = [
  DisputeStatus.RESOLVED_REFUND,
  DisputeStatus.RESOLVED_RELEASE,
  DisputeStatus.WITHDRAWN,
]

const TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  [DisputeStatus.OPEN]: [
    DisputeStatus.UNDER_REVIEW,
    DisputeStatus.RESOLVED_REFUND,
    DisputeStatus.RESOLVED_RELEASE,
    DisputeStatus.WITHDRAWN,
  ],
  [DisputeStatus.UNDER_REVIEW]: [
    DisputeStatus.RESOLVED_REFUND,
    DisputeStatus.RESOLVED_RELEASE,
    // Still withdrawable: a buyer and vendor who settle it themselves while
    // an admin is looking should not have to wait for a ruling.
    DisputeStatus.WITHDRAWN,
  ],
  [DisputeStatus.RESOLVED_REFUND]: [],
  [DisputeStatus.RESOLVED_RELEASE]: [],
  [DisputeStatus.WITHDRAWN]: [],
}

export function isTerminal(status: DisputeStatus): boolean {
  return TERMINAL.includes(status)
}

export function isAllowedDisputeTransition(
  from: DisputeStatus,
  to: DisputeStatus
): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Who is allowed to make this move.
 *
 * Only an admin resolves. A vendor cannot close a dispute against themselves,
 * and a buyer cannot rule in their own favour — a buyer who no longer wants
 * the claim withdraws it, which is a different act with a different record.
 */
export function canActorTransition(
  actor: DisputeActor,
  to: DisputeStatus
): boolean {
  switch (to) {
    case DisputeStatus.WITHDRAWN:
      return actor === "buyer" || actor === "admin"
    case DisputeStatus.UNDER_REVIEW:
    case DisputeStatus.RESOLVED_REFUND:
    case DisputeStatus.RESOLVED_RELEASE:
      return actor === "admin"
    default:
      return false
  }
}

export function assertDisputeTransition(args: {
  from: DisputeStatus
  to: DisputeStatus
  actor: DisputeActor
}): void {
  if (!isAllowedDisputeTransition(args.from, args.to)) {
    throw new DisputeStateError(
      `cannot move a dispute from ${args.from} to ${args.to}`
    )
  }
  if (!canActorTransition(args.actor, args.to)) {
    throw new DisputeStateError(
      `a ${args.actor} may not move a dispute to ${args.to}`
    )
  }
}

/** How long after an order a buyer may raise a dispute. */
export const DEFAULT_FILING_WINDOW_DAYS = 60

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Is this order still disputable?
 *
 * The window runs from the order date because that is the timestamp every
 * order has. Delivery would be the fairer anchor and is not universally
 * populated; anchoring on a field that is often null would silently make some
 * orders disputable forever and others not at all.
 */
export function isWithinFilingWindow(args: {
  orderPlacedAt: Date | string
  now: Date
  windowDays?: number
}): boolean {
  const placed =
    args.orderPlacedAt instanceof Date
      ? args.orderPlacedAt
      : new Date(args.orderPlacedAt)
  if (Number.isNaN(placed.getTime())) return false

  const windowDays = args.windowDays ?? DEFAULT_FILING_WINDOW_DAYS
  const deadline = placed.getTime() + windowDays * MS_PER_DAY
  return args.now.getTime() <= deadline
}

/**
 * How much a buyer may claim.
 *
 * Clamped to the order total: a dispute is a claim against a specific
 * purchase, and a claim larger than what was paid is a data error, not a
 * negotiating position. Zero means "the whole order" — the common case, and
 * it saves a buyer having to restate a figure the platform already knows.
 */
export function resolveClaimCents(args: {
  requestedCents?: number | null
  orderTotalCents: number
}): number {
  const total = Math.max(0, Math.floor(args.orderTotalCents))
  const requested = args.requestedCents
  if (requested === null || requested === undefined) return total
  const value = Math.floor(Number(requested))
  if (!Number.isFinite(value) || value <= 0) return total
  return Math.min(value, total)
}

/**
 * The refund a resolution actually awards.
 *
 * A `resolved_release` awards nothing by definition, so an award attached to
 * one is refused rather than quietly zeroed: it means the resolver picked the
 * wrong outcome, and silently discarding the number would hide that.
 */
export function resolveAwardCents(args: {
  status: DisputeStatus
  awardCents?: number | null
  claimCents: number
}): number {
  if (args.status === DisputeStatus.RESOLVED_RELEASE) {
    const award = Math.floor(Number(args.awardCents ?? 0))
    if (Number.isFinite(award) && award > 0) {
      throw new DisputeStateError(
        "a release resolution awards nothing — use resolved_refund to award a refund"
      )
    }
    return 0
  }

  if (args.status !== DisputeStatus.RESOLVED_REFUND) return 0

  const claim = Math.max(0, Math.floor(args.claimCents))
  const raw = args.awardCents
  // A refund with no figure awards the full claim, mirroring how a claim with
  // no figure means the whole order.
  if (raw === null || raw === undefined) return claim
  const award = Math.floor(Number(raw))
  if (!Number.isFinite(award) || award < 0) return 0
  if (award > claim) {
    throw new DisputeStateError(
      `award of ${award} exceeds the ${claim} claimed`
    )
  }
  return award
}

/**
 * Which escrow transition, if any, this resolution implies.
 *
 * Returns null when the order has no escrow agreement — the ordinary case
 * today, since ordinary orders settle through Stripe. The caller must treat
 * null as "record the resolution, move no escrowed funds", never as a
 * failure: pretending an escrow transition happened is worse than saying
 * plainly that none was needed.
 */
export function escrowTransitionFor(
  status: DisputeStatus
): "resolve_dispute_release" | "recover" | null {
  if (status === DisputeStatus.RESOLVED_RELEASE) return "resolve_dispute_release"
  if (status === DisputeStatus.RESOLVED_REFUND) return "recover"
  return null
}
