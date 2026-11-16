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

/**
 * An award the decision cannot carry: not a whole, non-negative number of
 * minor units, more than was claimed, money on a release, or nothing on a
 * refund. A `DisputeStateError`, so a caller catching that still catches
 * this, but `PATCH /admin/disputes/:id` answers it with 400
 * `invalid_award_amount`, not 409: the request was wrong, the case did not
 * change under it. That keeps 409 meaning one thing, "this case is no longer
 * in the status you decided from", which is what the admin panel tells the
 * operator when it gets one.
 */
export class DisputeAwardError extends DisputeStateError {}

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
 * The refund a resolution actually awards, in minor units.
 *
 * `awardCents` absent or null means "no figure was given": a refund then
 * awards the whole claim, mirroring how a claim with no figure means the
 * whole order, and a release awards nothing. Any figure that is given must
 * be a whole, non-negative number of minor units; anything else is refused,
 * never coerced. The PATCH used to pass a non-number through as null, so a
 * string "0" became a whole-claim refund, a negative became a 0 refund and
 * a fraction was floored, each one a different figure from the one sent, and
 * this is the figure an operator later pays out by hand.
 *
 * A `resolved_release` awards nothing by definition, so an award attached to
 * one is refused rather than quietly zeroed: it means the resolver picked the
 * wrong outcome, and silently discarding the number would hide that. The
 * mirror case is refused too: a `resolved_refund` that awards nothing (an
 * explicit 0, or a whole-claim refund of a 0 claim) is a release, and the
 * buyer's claims API would otherwise call it "accepted" with nothing awarded.
 */
export function resolveAwardCents(args: {
  status: DisputeStatus
  awardCents?: number | null
  claimCents: number
}): number {
  const raw = args.awardCents
  const given = raw !== null && raw !== undefined
  if (given && (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0)) {
    throw new DisputeAwardError(
      `award ${String(raw)} is not a whole, non-negative number of the currency's minor unit`
    )
  }

  if (args.status === DisputeStatus.RESOLVED_RELEASE) {
    if (given && raw > 0) {
      throw new DisputeAwardError(
        "a release resolution awards nothing — use resolved_refund to award a refund"
      )
    }
    return 0
  }

  if (args.status !== DisputeStatus.RESOLVED_REFUND) return 0

  const claim = Math.max(0, Math.floor(args.claimCents))
  const award = given ? raw : claim
  if (award > claim) {
    throw new DisputeAwardError(`award of ${award} exceeds the ${claim} claimed`)
  }
  if (award === 0) {
    throw new DisputeAwardError(
      "a refund resolution must award something — use resolved_release to award nothing"
    )
  }
  return award
}

/**
 * The decisions that close a case, each of which must carry a written reason.
 *
 * `/buyer-protection` tells buyers that every decision is recorded with a
 * written reason, and the note is not private: the buyer reads it as
 * `reviewer_note` (`GET /store/order-claims`) or `resolution_note`
 * (`GET /store/orders/:id/dispute`), and the seller in the case file
 * (`GET /vendor/disputes/:id`, which resolves the vendor login's member to
 * its seller with `requireSellerId`; it compared the member id with the
 * dispute's seller id before, so no vendor could read a dispute at all).
 * Those are API reads: no storefront page and no vendor-panel screen shows
 * the note yet, and nothing emails it. The admin panel asked for a note, but the
 * PATCH accepted a decision without one, so the promise held only for
 * decisions made through that one screen. `PATCH /admin/disputes/:id`
 * refuses these without a note (`decisionNoteMissing`); the storefront's
 * `buyer-protection-copy.spec.ts` keeps the page's promise tied to that check.
 */
export const DECISIONS_NEEDING_A_NOTE: readonly DisputeStatus[] = [
  DisputeStatus.RESOLVED_REFUND,
  DisputeStatus.RESOLVED_RELEASE,
  DisputeStatus.WITHDRAWN,
]

/** True when `to` closes the case and `note` has no text in it. */
export function decisionNoteMissing(to: DisputeStatus | string, note: unknown): boolean {
  if (!(DECISIONS_NEEDING_A_NOTE as readonly string[]).includes(to)) return false
  return typeof note !== "string" || note.trim() === ""
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

/**
 * Medusa amounts as integer minor units, and the `amount_unit` mark rows
 * written in minor units carry. They live in `shared/minor-units.ts` since
 * creator attribution needed the same conversion (SD-95); re-exported here so
 * the dispute code and its tests keep their imports.
 */
export {
  AMOUNT_UNIT_METADATA_KEY,
  AMOUNT_UNIT_MINOR,
  currencyMinorDigits,
  isMarkedMinorUnits,
  toMinorUnits,
} from "../../shared/minor-units"

export type OrderLineForDispute = {
  seller_id?: string | null
  /** Minor units (see `toMinorUnits`). */
  total?: number | string | null
}

/**
 * The sellers a buyer could dispute on one order.
 *
 * FBM is a multi-vendor marketplace, so an order routinely spans sellers. The
 * first version of the dispute route took `items.find(...)` — the first seller
 * it happened to encounter — and recorded that as the respondent. On a
 * two-vendor order that names the wrong vendor half the time.
 */
export function sellersOnOrder(
  lines: readonly OrderLineForDispute[]
): string[] {
  const seen = new Set<string>()
  for (const line of lines) {
    const id = line.seller_id
    if (typeof id === "string" && id) seen.add(id)
  }
  return [...seen]
}

/**
 * What ONE seller's goods on an order came to, in minor units. The lines
 * must already be in minor units: this sums, it does not convert.
 *
 * This is the ceiling a claim against that seller may reach. Clamping to the
 * whole order total — as the first version did — let a claim against Vendor A
 * be worth up to Vendor B's goods as well, which is not a rounding problem but
 * a vendor being made liable for someone else's shipment.
 *
 * Lines with no seller attribution are excluded rather than spread across
 * sellers: attributing money to a vendor because nothing said otherwise is how
 * a wrong respondent gets a real bill.
 */
export function sellerShareCents(
  lines: readonly OrderLineForDispute[],
  sellerId: string
): number {
  let sum = 0
  for (const line of lines) {
    if (line.seller_id !== sellerId) continue
    const value = Math.floor(Number(line.total) || 0)
    if (Number.isFinite(value) && value > 0) sum += value
  }
  return sum
}
