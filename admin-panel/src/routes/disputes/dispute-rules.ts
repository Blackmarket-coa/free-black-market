/**
 * The rules behind the Disputes screens, kept apart from the pages so they
 * are tested on their own (`dispute-rules.spec.ts`).
 *
 * The backend is the authority on every one of these: `GET /admin/disputes`,
 * `GET /admin/disputes/:id` and `PATCH /admin/disputes/:id`, over
 * `backend/src/modules/order-dispute`. What is here is the panel's copy of
 * that vocabulary, so the screen never offers a move the server will refuse.
 * The spec reads `order-dispute/resolution.ts` and fails if the two drift.
 *
 * Money: `claim_amount` and `award_amount` are integers in the currency's
 * minor unit, as the `order_dispute` model declares, and the PATCH takes
 * `award_amount` in the same unit. A person types a decimal amount; it is
 * turned into minor units here, exactly or not at all.
 */

import type {
  AdminDispute,
  AdminDisputeEvent,
  AdminDisputeListParams,
  AdminDisputeUpdateBody,
  DisputeActorType,
  DisputeReason,
  DisputeStatus,
} from "@custom-types/dispute"

export const DISPUTE_STATUSES: readonly DisputeStatus[] = [
  "open",
  "under_review",
  "resolved_refund",
  "resolved_release",
  "withdrawn",
]

export const STATUS_LABELS: Record<DisputeStatus, string> = {
  open: "Open",
  under_review: "Under review",
  resolved_refund: "Decided: refund",
  resolved_release: "Decided: release",
  withdrawn: "Withdrawn",
}

/** The same statuses as words inside a sentence. */
const STATUS_WORDS: Record<DisputeStatus, string> = {
  open: "open",
  under_review: "under review",
  resolved_refund: "decided for a refund",
  resolved_release: "decided for a release",
  withdrawn: "withdrawn",
}

export const STATUS_COLORS: Record<DisputeStatus, "orange" | "blue" | "green" | "grey" | "purple"> = {
  open: "orange",
  under_review: "blue",
  resolved_refund: "green",
  resolved_release: "purple",
  withdrawn: "grey",
}

export const REASON_LABELS: Record<DisputeReason, string> = {
  not_received: "Never arrived",
  not_as_described: "Not as described",
  damaged: "Arrived damaged",
  incomplete: "Items missing",
  billing: "Billing",
  other: "Other",
}

/**
 * The moves an admin may make from each status: the backend's TRANSITIONS
 * table, filtered by `canActorTransition("admin", …)`. Every move there is an
 * admin's, so today the two are the same table. The terminal statuses allow
 * nothing; a decision is not re-opened from this screen because the backend
 * does not allow it at all.
 */
export const ADMIN_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  open: ["under_review", "resolved_refund", "resolved_release", "withdrawn"],
  under_review: ["resolved_refund", "resolved_release", "withdrawn"],
  resolved_refund: [],
  resolved_release: [],
  withdrawn: [],
}

export const isDisputeStatus = (value: unknown): value is DisputeStatus =>
  typeof value === "string" && (DISPUTE_STATUSES as readonly string[]).includes(value)

export const adminActionsFor = (status: DisputeStatus): readonly DisputeStatus[] =>
  ADMIN_TRANSITIONS[status] ?? []

/** Still waiting for a decision. */
export const isLive = (status: DisputeStatus) => status === "open" || status === "under_review"

/**
 * The list filter. `queue` is the backend's default when no status is sent:
 * open and under review, oldest first. Any other value is one status, which
 * the backend also returns oldest first.
 */
export type DisputeFilter = "queue" | DisputeStatus

export const FILTER_OPTIONS: ReadonlyArray<{ value: DisputeFilter; label: string }> = [
  { value: "queue", label: "Needs a decision" },
  ...DISPUTE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
]

export const parseFilter = (raw: string | null | undefined): DisputeFilter =>
  isDisputeStatus(raw) ? raw : "queue"

/** The query string for `GET /admin/disputes`; none at all for the queue. */
export const listQuery = (filter: DisputeFilter): AdminDisputeListParams | undefined =>
  filter === "queue" ? undefined : { status: filter }

/** Digits after the decimal point in this currency (2 for USD, 0 for JPY). */
export function minorDigits(currencyCode: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

export function formatMinor(amount: number, currencyCode: string): string {
  const digits = minorDigits(currencyCode)
  const major = (Number(amount) || 0) / 10 ** digits
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode.toUpperCase(),
    }).format(major)
  } catch {
    return `${major.toFixed(digits)} ${currencyCode.toUpperCase()}`
  }
}

/**
 * A Medusa order amount, which is in major units (5 is $5.00), unlike the
 * dispute's own minor-unit figures. Used for the order total shown beside
 * the claim.
 */
export function formatMajor(amount: number, currencyCode: string): string {
  return formatMinor(Math.round((Number(amount) || 0) * 10 ** minorDigits(currencyCode)), currencyCode)
}

/**
 * An amount typed by a person, in minor units. Anything that is not a plain
 * amount with no more decimals than the currency has (no sign, no symbol, no
 * thousands separator) is null, so it is never rounded into a different
 * amount silently. Empty is null too: the caller decides what blank means.
 */
export function parseAmount(input: string, currencyCode: string): number | null {
  const s = input.trim()
  const digits = minorDigits(currencyCode)
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`)
  if (!pattern.test(s)) return null
  const [whole, frac = ""] = s.split(".")

  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0")
}

export type ResolutionDraft = {
  /** What is wrong, in words for the person; empty when it can be sent. */
  problems: string[]
  body: AdminDisputeUpdateBody | null
}

/**
 * What the admin chose, checked the way the server will check it, so a
 * refusal is explained before the request rather than after.
 *
 * - The move must be one the backend allows from the current status.
 * - Taking a case under review carries nothing else.
 * - A refund with no amount awards the whole claim (the backend's rule); an
 *   amount must be exact and no more than was claimed.
 * - A release awards nothing; an amount on one is refused, as the backend
 *   refuses it, because it means the wrong outcome was picked.
 * - Every decision that closes the case (refund, release, withdrawal) needs
 *   a note. The backend accepts one without, but `/buyer-protection` tells
 *   buyers a claim is not closed silently, and the note is the written
 *   reason the parties are given.
 */
export function resolutionDraft(
  dispute: Pick<AdminDispute, "status" | "claim_amount" | "currency_code">,
  to: DisputeStatus,
  input: { award?: string; note?: string } = {}
): ResolutionDraft {
  if (!adminActionsFor(dispute.status).includes(to)) {
    return {
      problems: [`A dispute that is ${STATUS_WORDS[dispute.status]} cannot be moved to ${STATUS_WORDS[to]}`],
      body: null,
    }
  }

  if (to === "under_review") return { problems: [], body: { status: to } }

  const problems: string[] = []
  const note = (input.note ?? "").trim()
  const awardText = (input.award ?? "").trim()
  const claim = Math.max(0, Math.floor(Number(dispute.claim_amount) || 0))
  let award: number | undefined

  if (to === "resolved_refund" && awardText !== "") {
    const parsed = parseAmount(awardText, dispute.currency_code)
    if (parsed === null) {
      problems.push("The award is not an amount")
    } else if (parsed > claim) {
      problems.push(
        `The award of ${formatMinor(parsed, dispute.currency_code)} is more than the ${formatMinor(
          claim,
          dispute.currency_code
        )} claimed`
      )
    } else {
      award = parsed
    }
  }

  if (to === "resolved_release" && awardText !== "") {
    const parsed = parseAmount(awardText, dispute.currency_code)
    if (parsed === null || parsed > 0) {
      problems.push("A release awards the buyer nothing. To award money, refund instead")
    }
  }

  if (!note) problems.push("Write a note for the buyer and the seller saying why")

  return {
    problems,
    body:
      problems.length === 0
        ? { status: to, note, ...(award !== undefined ? { award_amount: award } : {}) }
        : null,
  }
}

/**
 * The escrow transition a decision implies, as the PATCH reports it — but
 * only when the order has an escrow agreement. Most orders settle through
 * Stripe and have none; then nothing but the record changed, and any refund
 * still has to be made through the order's payment.
 */
export function escrowTransitionFor(
  status: DisputeStatus,
  escrowAgreementId: string | null
): "resolve_dispute_release" | "recover" | null {
  if (!escrowAgreementId) return null
  if (status === "resolved_release") return "resolve_dispute_release"
  if (status === "resolved_refund") return "recover"

  return null
}

const ACTOR_LABELS: Record<DisputeActorType, string> = {
  buyer: "Buyer",
  seller: "Seller",
  admin: "Admin",
  system: "System",
}

const statusWord = (s: string | null) => (isDisputeStatus(s) ? STATUS_WORDS[s] : s ?? "?")

/** One line of the event log, in words. */
export function describeEvent(event: AdminDisputeEvent, currencyCode: string): string {
  const actor = ACTOR_LABELS[event.actor_type as DisputeActorType] ?? event.actor_type
  switch (event.kind) {
    case "opened":
      return `${actor} opened the dispute`
    case "seller_responded":
      return `${actor} responded`
    case "status_changed":
      return `${actor} moved it from ${statusWord(event.from_status)} to ${statusWord(event.to_status)}`
    case "resolved": {
      const award = Number(event.metadata?.award_amount)
      const outcome =
        event.to_status === "resolved_refund"
          ? "refund the buyer"
          : event.to_status === "resolved_release"
            ? "release to the seller"
            : statusWord(event.to_status)
      const decided = `${actor} decided: ${outcome}`

      return Number.isFinite(award) && award > 0
        ? `${decided}, awarding ${formatMinor(award, currencyCode)}`
        : decided
    }
    case "note":
      return `${actor} added a note`
    default:
      return `${actor}: ${event.kind.replace(/_/g, " ")}`
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole days since the dispute was opened; null when the date is unreadable. */
export function daysWaiting(createdAt: string, now: Date = new Date()): number | null {
  const opened = new Date(createdAt).getTime()
  if (Number.isNaN(opened)) return null

  return Math.max(0, Math.floor((now.getTime() - opened) / MS_PER_DAY))
}
