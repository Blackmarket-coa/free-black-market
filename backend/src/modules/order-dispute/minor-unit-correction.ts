import { DisputeStatus, isMarkedMinorUnits, toMinorUnits } from "./resolution"

/**
 * What to do about a stored dispute whose amounts may be in the wrong unit.
 *
 * Pure, container-free. Used by `scripts/fix-order-dispute-minor-units.ts`.
 *
 * The intake once stored `Math.floor(item.total)` summed over the seller's
 * lines, which is Medusa's MAJOR-unit figure with the cents cut off, in a
 * column declared as minor units: a $25.99 claim was stored as 25. That
 * intake also failed on every real order before it could store anything
 * (see `ORDER_FIELDS_FOR_DISPUTE` in `shared/order-dispute-intake.ts`), so
 * a row like this should not exist; but rows from an earlier intake, from
 * a direct service call or from a restored backup could, and an operator
 * now reads these figures to decide a refund by hand.
 *
 * A row is corrected only when it can be told apart with certainty:
 *
 * - it is not marked `metadata.amount_unit = "minor"`. Every row written
 *   since the fix carries that mark (`OrderDisputeService.open`), and a
 *   marked row is never touched, whatever its amounts say. Without it a
 *   late run could not tell an old row from a new one whose buyer typed a
 *   claim equal to the old floored figure (25 on a $25.99 order, meaning
 *   $0.25), and would multiply that claim and its award by 100;
 * - it was created before the cutoff the operator passes (the time the fix
 *   went live), as a second, independent line: the script filters on it
 *   and this checks it again;
 * - its claim equals exactly what the old intake would have stored for that
 *   seller's lines (the whole-order default: the storefront form never sends
 *   an amount), and the true minor-unit figure differs from it; and
 * - its award is unambiguous: none (0), or exactly the old claim (a refund
 *   decided with the amount left blank awards the whole claim).
 *
 * A claim above the old figure was stored after the fix: the old intake
 * clamped every claim to that figure, so it could not have produced one.
 * Anything else (a claim below the whole-order figure, a partial award) may
 * have been typed by a person in either unit, and the row cannot say which.
 * Those are reported for review and left alone, because guessing at a
 * money figure is how this went wrong in the first place.
 */

export type StoredDisputeAmounts = {
  status: DisputeStatus | string
  seller_id: string
  currency_code: string
  claim_amount: number
  award_amount: number
  created_at: Date | string
  metadata?: Record<string, unknown> | null
}

/** One order line as Medusa returns it: total in MAJOR units. */
export type MajorUnitLine = { seller_id: string | null; total_major: unknown }

export type MinorUnitCorrection =
  | {
      action: "correct"
      claim: { from: number; to: number }
      award: { from: number; to: number }
    }
  | {
      action: "skip"
      reason: "marked_minor_units" | "after_cutoff" | "already_minor_units" | "no_difference"
    }
  | { action: "review"; reason: string }

/** What the old intake stored as the claim for one seller's lines. */
export function legacyFlooredShare(lines: readonly MajorUnitLine[], sellerId: string): number {
  let sum = 0
  for (const line of lines) {
    if (line.seller_id !== sellerId) continue
    const floored = Math.floor(Number(line.total_major) || 0)
    if (Number.isFinite(floored) && floored > 0) sum += floored
  }
  return sum
}

/** The same lines, summed the way the fixed intake sums them. */
export function minorUnitShare(
  lines: readonly MajorUnitLine[],
  sellerId: string,
  currencyCode: string
): number {
  let sum = 0
  for (const line of lines) {
    if (line.seller_id !== sellerId) continue
    const minor = toMinorUnits(line.total_major, currencyCode)
    if (minor > 0) sum += minor
  }
  return sum
}

export function planMinorUnitCorrection(
  dispute: StoredDisputeAmounts,
  lines: readonly MajorUnitLine[],
  opts: { before: Date }
): MinorUnitCorrection {
  if (isMarkedMinorUnits(dispute.metadata)) return { action: "skip", reason: "marked_minor_units" }

  const before = opts.before.getTime()
  if (!Number.isFinite(before)) {
    // The script refuses to start without a valid cutoff; this is the same
    // rule for any other caller.
    throw new Error("planMinorUnitCorrection needs a valid cutoff")
  }
  const created = new Date(dispute.created_at).getTime()
  if (Number.isNaN(created)) {
    return { action: "review", reason: `created_at ${String(dispute.created_at)} is not a date` }
  }
  if (created >= before) return { action: "skip", reason: "after_cutoff" }

  const legacy = legacyFlooredShare(lines, dispute.seller_id)
  const minor = minorUnitShare(lines, dispute.seller_id, dispute.currency_code)
  const claim = Math.floor(Number(dispute.claim_amount) || 0)
  const award = Math.floor(Number(dispute.award_amount) || 0)

  if (minor === legacy) return { action: "skip", reason: "no_difference" }
  if (claim > legacy) return { action: "skip", reason: "already_minor_units" }

  if (claim !== legacy) {
    return {
      action: "review",
      reason:
        `claim ${claim} is below the whole-order figure the old intake stored (${legacy}); ` +
        `it may be an amount someone typed, in either unit`,
    }
  }

  let awardTo: number
  if (award === 0) {
    awardTo = 0
  } else if (dispute.status === DisputeStatus.RESOLVED_REFUND && award === claim) {
    awardTo = minor
  } else {
    return {
      action: "review",
      reason: `award ${award} on a ${dispute.status} dispute is neither 0 nor the whole claim (${claim}); its unit cannot be told`,
    }
  }

  return {
    action: "correct",
    claim: { from: claim, to: minor },
    award: { from: award, to: awardTo },
  }
}

/**
 * The cutoff the corrective script must be given, from its `medusa exec`
 * arguments: `before=<ISO 8601 timestamp with a zone>`, the time the
 * minor-unit intake fix went live. Only rows created before it are looked at.
 *
 * Why a bare word and not `--before=…`: `medusa exec` parses its arguments
 * with yargs in strict mode, so `--before=…` (or `--dry-run`) is refused as
 * an unknown argument, and anything after a `--` separator is dropped
 * before the script sees it (checked against the real CLI). Only bare words
 * arrive. The `--` spellings are accepted too, for a caller that passes
 * arguments directly.
 *
 * Refused, rather than guessed: no cutoff, an unreadable one, one with no
 * zone (`2026-11-20T15:00` is local time on whatever machine runs it), and
 * one in the future (that cannot be when the fix went live, and it would
 * leave the `amount_unit` mark as the only protection for rows written
 * since).
 */
export function parseCutoffArg(
  args: readonly string[] | undefined,
  now: Date = new Date()
): { ok: true; before: Date } | { ok: false; message: string } {
  const usage =
    "pass the time the minor-unit intake fix went live, e.g. " +
    "`npx medusa exec ./src/scripts/fix-order-dispute-minor-units.ts dry-run before=2026-11-20T15:00:00Z`"
  const raw = (args ?? []).find((a) => /^(--)?before=/.test(a))
  if (raw === undefined) return { ok: false, message: `a cutoff is required: ${usage}` }

  const value = raw.replace(/^(--)?before=/, "").trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return {
      ok: false,
      message: `cutoff "${value}" is not an ISO 8601 timestamp with a zone (Z or ±hh:mm): ${usage}`,
    }
  }
  const before = new Date(value)
  if (Number.isNaN(before.getTime())) {
    return { ok: false, message: `cutoff "${value}" is not a real time: ${usage}` }
  }
  if (before.getTime() > now.getTime()) {
    return { ok: false, message: `cutoff ${before.toISOString()} is in the future: ${usage}` }
  }
  return { ok: true, before }
}

/** `dry-run` (or `--dry-run`) among the `medusa exec` arguments. */
export function isDryRunArg(args: readonly string[] | undefined): boolean {
  return (args ?? []).some((a) => a === "dry-run" || a === "--dry-run")
}
