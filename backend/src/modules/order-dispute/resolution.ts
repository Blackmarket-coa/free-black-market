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
 * The decisions that close a case, each of which must carry a written reason.
 *
 * `/buyer-protection` tells buyers that every decision is recorded with a
 * written reason, and the note is not private: the buyer reads it as
 * `reviewer_note` (`GET /store/order-claims`) or `resolution_note`
 * (`GET /store/orders/:id/dispute`), and the seller in the case file
 * (`GET /vendor/disputes/:id`). The admin panel asked for a note, but the
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
 * Digits in a currency's minor unit: 2 for USD, 0 for JPY, 3 for KWD.
 *
 * Read from Intl, the same lookup the admin panel's Disputes screen formats
 * with (`admin-panel/src/routes/disputes/dispute-rules.ts`, `minorDigits`),
 * so a figure stored here reads back there as the amount that was meant. A
 * missing or unknown code counts as two digits.
 */
export function currencyMinorDigits(currencyCode: string | null | undefined): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: String(currencyCode ?? "usd").toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * A Medusa amount as an integer in the currency's minor unit.
 *
 * Medusa v2 keeps money in MAJOR units: an item total of 25.99 is $25.99,
 * usually handed back as a BigNumber (which `Number()` reads through its
 * `valueOf`). `order_dispute` stores minor units. The intake used to floor
 * the major figure and store that, so a $25.99 claim became 25 and every
 * screen that followed the declared unit showed it as $0.25.
 *
 * Rounded to the nearest minor unit; the `toFixed` step drops binary noise
 * first, so 25.99 × 100 (2598.9999999999995) is 2599 and a half-cent from
 * tax rounds up rather than down. Anything unreadable is 0, which the
 * callers already treat as "nothing to claim" for that line.
 */
export function toMinorUnits(amount: unknown, currencyCode: string | null | undefined): number {
  const major = Number(amount)
  if (!Number.isFinite(major)) return 0
  const scaled = major * 10 ** currencyMinorDigits(currencyCode)
  return Math.round(Number(scaled.toFixed(6)))
}

/**
 * The mark every dispute row written since the minor-unit fix carries:
 * `metadata.amount_unit = "minor"`, set by `OrderDisputeService.open`.
 *
 * A row the old intake wrote (claim = floor of the major-unit total) and a
 * row written since, whose buyer typed a claim equal to that same floored
 * figure, have identical amounts. Only this mark tells them apart, so the
 * corrective script (`minor-unit-correction.ts`) never touches a marked row.
 */
export const AMOUNT_UNIT_METADATA_KEY = "amount_unit"
export const AMOUNT_UNIT_MINOR = "minor"

export function isMarkedMinorUnits(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>)[AMOUNT_UNIT_METADATA_KEY] === AMOUNT_UNIT_MINOR
  )
}

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
