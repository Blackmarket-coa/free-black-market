import { CommissionStatus } from "./models/order-attribution"
import { allocateCommission, type LevelSplits } from "./utils/referral-chain"
import { isMarkedMinorUnits, toMinorUnits } from "../../shared/minor-units"

/**
 * What to do about the stored attribution rows of one order whose amounts
 * may be in the wrong unit (SD-95).
 *
 * Pure, container-free. Used by `scripts/fix-creator-commission-minor-units.ts`.
 *
 * `subscribers/attribute-order-on-placed.ts` passed Medusa's MAJOR-unit
 * `order.subtotal` (25 for $25.00) as `subtotalCents`, so each row stored
 * that figure in `attributed_subtotal_cents` and `commission_basis_cents`
 * and `floor(major × percent / 100)` in `commission_amount_cents`, split
 * across referral levels by `allocateCommission`. A $25 order at 10% stored
 * a commission of 2 where 250 is right.
 *
 * An order's rows are corrected together (the level split has to stay whole)
 * and only when every one of these holds:
 *
 * - no row is marked `metadata.amount_unit = "minor"`. Every row written
 *   since the fix carries it (the subscriber passes it), and a marked row is
 *   never touched whatever its figures say;
 * - every row's stored subtotal and basis equal the order's subtotal read
 *   exactly as the old subscriber read it (`Number(subtotal ?? total)`), and
 *   the minor-unit figure differs from it (it does not for a currency with
 *   no minor unit, JPY, whose rows were right all along);
 * - every row's commission is exactly what the old code would have stored
 *   for its level, from its own stored percent and level split; and
 * - no row has moved money: each is `pending`, `held`, `reversed` or
 *   `disqualified` with no ledger entry. An `approved` (or `paid`) row was
 *   credited to the creator's ledger at the old figure, and a reversal reads
 *   the column to undo it, so changing the column alone would make a later
 *   refund take back more than was ever credited. Those are listed for the
 *   operator, never changed here.
 *
 * Anything else — the order edited since (its subtotal no longer matches),
 * figures that fit neither unit, a broken level chain — is reported for
 * review and left alone: guessing at a money figure is how this went wrong.
 *
 * "Has not moved money" is about the creator's side only. A `pending` or
 * `held` row's commission never left the vendor: settlement credits the
 * vendor's SELLER_EARNINGS the sale less the platform fee and processing,
 * with no commission carved out, and it is the approve-held job that later
 * debits the vendor (`vendor_id`) for the commission, at whatever the column
 * says when it runs. So correcting such a row raises that future debit 100×,
 * out of the vendor's balance at the time. {@link reviewVendorDebit} lists
 * the orders where what the script can read already argues against that
 * debit; the script asks it for every order this planner would correct. It
 * is a check made once, when the script runs, of a debit that happens later:
 * see its own comment for what it does not cover.
 */

export type StoredAttributionAmounts = {
  id: string
  order_id: string
  level?: number | null
  commission_status: string
  ledger_entry_id?: string | null
  attributed_subtotal_cents: unknown
  commission_basis_cents: unknown
  commission_amount_cents: unknown
  /** NUMERIC columns: Postgres hands them back as strings ("10"). */
  commission_percent?: number | string | null
  level_split_percent?: number | string | null
  currency_code?: string | null
  /** The vendor the approve-held job debits for this row's commission. */
  vendor_id?: string | null
  metadata?: Record<string, unknown> | null
}

/** The order as Medusa returns it: MAJOR units. */
export type MajorUnitOrderTotals = {
  subtotal?: unknown
  total?: unknown
  currency_code?: string | null
}

export const CORRECTED_METADATA_KEY = "amount_units_corrected"

/** Statuses whose commission has not moved money and never will by itself. */
const UNMOVED_STATUSES: ReadonlySet<string> = new Set([
  CommissionStatus.PENDING,
  CommissionStatus.HELD,
  CommissionStatus.REVERSED,
  CommissionStatus.DISQUALIFIED,
])

/**
 * Statuses the approve-held job will still credit, debiting `vendor_id`:
 * `held`, and `pending` (held once the order is paid).
 */
const CREDITABLE_STATUSES: ReadonlySet<string> = new Set([CommissionStatus.PENDING, CommissionStatus.HELD])

export type CommissionMinorUnitCorrection =
  | {
      action: "correct"
      subtotal: { from: number; to: number }
      commission_total: { from: number; to: number }
      rows: Array<{ id: string; level: number; status: string; commission: { from: number; to: number } }>
    }
  | {
      action: "skip"
      reason: "marked_minor_units" | "already_corrected" | "already_minor_units" | "no_difference"
    }
  | { action: "review"; reason: string }

/** Two stored amounts (numeric column, read back through Number) are the same figure. */
function same(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6
}

function hasCorrectionRecord(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && CORRECTED_METADATA_KEY in (metadata as object)
}

/** A NUMERIC column's value as a number, or null when it is unset or unreadable. */
function numeric(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/** The commission the service takes on a subtotal (`attributeOrder`, unchanged formula). */
export function commissionOn(subtotal: number, percent: number): number {
  return Math.floor((subtotal * percent) / 100)
}

export function planCommissionMinorUnitCorrection(
  rows: readonly StoredAttributionAmounts[],
  order: MajorUnitOrderTotals | null
): CommissionMinorUnitCorrection {
  if (!rows.length) return { action: "review", reason: "no attribution rows" }

  const corrected = rows.filter((r) => hasCorrectionRecord(r.metadata)).length
  if (corrected === rows.length) return { action: "skip", reason: "already_corrected" }
  if (corrected > 0) {
    return { action: "review", reason: `${corrected} of ${rows.length} level rows already corrected; the chain is split` }
  }

  const marked = rows.filter((r) => isMarkedMinorUnits(r.metadata)).length
  if (marked === rows.length) return { action: "skip", reason: "marked_minor_units" }
  if (marked > 0) {
    return { action: "review", reason: `${marked} of ${rows.length} level rows are marked minor units and the rest are not` }
  }

  if (!order) return { action: "review", reason: "order not found" }

  const sorted = [...rows].sort((a, b) => Number(a.level ?? 1) - Number(b.level ?? 1))
  for (let i = 0; i < sorted.length; i++) {
    if (Number(sorted[i].level ?? 1) !== i + 1) {
      return { action: "review", reason: `levels are ${sorted.map((r) => r.level ?? 1).join(",")}, not 1..${sorted.length}` }
    }
  }

  const currency = String(sorted[0].currency_code ?? "usd").toLowerCase()
  if (sorted.some((r) => String(r.currency_code ?? "usd").toLowerCase() !== currency)) {
    return { action: "review", reason: "level rows disagree on currency" }
  }
  if (order.currency_code && String(order.currency_code).toLowerCase() !== currency) {
    return { action: "review", reason: `rows are in ${currency}, the order in ${String(order.currency_code).toLowerCase()}` }
  }

  // Exactly the old subscriber's read, and the fixed one's.
  const orderAmount = order.subtotal ?? order.total ?? 0
  const legacy = Number(orderAmount)
  const minor = toMinorUnits(orderAmount, currency)
  if (!Number.isFinite(legacy) || legacy <= 0) {
    return { action: "review", reason: `order subtotal ${String(orderAmount)} is not a positive amount` }
  }
  if (minor === legacy) return { action: "skip", reason: "no_difference" }

  const stored = Number(sorted[0].attributed_subtotal_cents)
  for (const r of sorted) {
    const s = Number(r.attributed_subtotal_cents)
    const b = Number(r.commission_basis_cents)
    if (!same(s, stored) || !same(b, stored)) {
      return { action: "review", reason: `row ${r.id}: subtotal ${s} and basis ${b} disagree with the chain's ${stored}` }
    }
  }
  if (same(stored, minor)) return { action: "skip", reason: "already_minor_units" }
  if (!same(stored, legacy)) {
    return {
      action: "review",
      reason:
        `stored subtotal ${stored} is neither the order's major figure (${legacy}) nor its minor figure (${minor}); ` +
        `the order may have been edited since it was attributed`,
    }
  }

  const percent = numeric(sorted[0].commission_percent)
  if (
    percent === null ||
    percent < 0 ||
    percent > 100 ||
    sorted.some((r) => numeric(r.commission_percent) !== percent)
  ) {
    return {
      action: "review",
      reason: `commission_percent ${String(sorted[0].commission_percent)} is missing, out of range or differs by level`,
    }
  }

  // The split the rows were allocated with, as `attributeOrder` recorded it
  // per level (a null there was a non-number split, which allocates 0).
  const splits: LevelSplits = {}
  sorted.forEach((r, i) => {
    const split = numeric(r.level_split_percent)
    if (split !== null) splits[`L${i + 1}`] = split
  })

  const oldTotal = commissionOn(stored, percent)
  const oldLevels = allocateCommission({ totalCents: oldTotal, levels: sorted.length, splits })
  for (let i = 0; i < sorted.length; i++) {
    const amount = Number(sorted[i].commission_amount_cents)
    if (!same(amount, oldLevels[i] ?? 0)) {
      return {
        action: "review",
        reason:
          `row ${sorted[i].id} (L${i + 1}): commission ${amount} is not what the old code stored ` +
          `for a ${stored} subtotal at ${percent}% (${oldLevels[i] ?? 0})`,
      }
    }
  }

  const moved = sorted.filter((r) => !UNMOVED_STATUSES.has(r.commission_status) || !!r.ledger_entry_id)
  if (moved.length) {
    return {
      action: "review",
      reason:
        moved
          .map((r) => `row ${r.id} is ${r.commission_status}${r.ledger_entry_id ? ` with ledger entry ${r.ledger_entry_id}` : ""}`)
          .join("; ") +
        `: commission already credited (or approved) at the old figure ${oldTotal}; ` +
        `the right figure is ${commissionOn(minor, percent)}. Operator decision, not changed here`,
    }
  }

  const newTotal = commissionOn(minor, percent)
  const newLevels = allocateCommission({ totalCents: newTotal, levels: sorted.length, splits })
  return {
    action: "correct",
    subtotal: { from: stored, to: minor },
    commission_total: { from: oldTotal, to: newTotal },
    rows: sorted.map((r, i) => ({
      id: r.id,
      level: i + 1,
      status: r.commission_status,
      commission: { from: oldLevels[i] ?? 0, to: newLevels[i] ?? 0 },
    })),
  }
}

/**
 * How long the nightly payout can still be about to send an order's proceeds
 * to the vendor. The job runs once a day (`jobs/daily-payouts.ts`,
 * "0 0 * * *") and pays every order not paid yet, so an order waits up to a
 * day for its run, and the run's own queue, delays and retries take it past
 * that. Two days.
 *
 * Counted from the later of the order's placement and its settlement to the
 * vendor's earnings, not from placement alone. An order settles only once
 * its money is captured, and the payout pays what was captured. Stripe
 * intents here are manual-capture (the provider is registered with no
 * `capture` option, `medusa-config.ts`); Mercur's
 * `order-set-placed-payment-capture` subscriber captures a cart's payment
 * right after it is placed, but when that capture fails and is made later
 * the proceeds reach the vendor days after the order. An order placed a week
 * ago and captured this morning is paid tonight.
 */
export const PAYOUT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

/**
 * What the script reads about who approve-held would debit for an order,
 * whether the order's proceeds reached them, and whether they were paid
 * since. All of it is true as of `checked_at` and no later.
 */
export type VendorDebitContext = {
  /** The order's seller (Mercur's seller link), or null when it has none. */
  order_seller_id: string | null
  /** When the order was placed (ISO), or null when unknown. */
  order_placed_at: string | null
  /** When this was read (ISO): the moment the checks below speak for. */
  checked_at: string
  /** Mercur payouts that paid this order's proceeds to the vendor (`order.payouts`). */
  order_payout_ids: readonly string[]
  /**
   * Per vendor id: whether a settlement leg of this order that moved money
   * (`order-payment-<order>-seller`, `-vendor` or `-consignor`, COMPLETED or
   * since anchored as SETTLED) credited one of that vendor's SELLER_EARNINGS
   * accounts. A vendor missing here counts as not settled.
   */
  order_settled_to_vendor: Readonly<Record<string, boolean>>
  /**
   * Per vendor id: when the latest of those legs was written (ISO), which is
   * when the order's proceeds reached that vendor. The payout window is
   * counted from it when it is later than the placement. A vendor settled
   * above with no time here counts as settled at an unknown time.
   */
  order_settled_at: Readonly<Record<string, string | null>>
  /**
   * Per vendor id: a settlement leg of this order credited that vendor's
   * earnings and is now REVERSED: a refund undid it (a card order refunded in
   * full, a wallet order refunded at all). Only changes what the review line
   * says for a vendor not settled above.
   */
  order_settlement_reversed: Readonly<Record<string, boolean>>
  /**
   * The order's REFUND legs that moved money, whoever they debited (the
   * customer's leg, the fee reversal, the seller's share). `from_vendor_id`
   * names the attributed vendor whose SELLER_EARNINGS a leg came out of, or
   * is null. A refund does not reverse a held attribution (nothing emits the
   * `order.refund_created` its reversal listens for; only `order.canceled`
   * does), so any of these on an order whose row is still creditable means
   * the commission is on a sale that was undone in part or in full.
   */
  order_refunds: ReadonlyArray<{ id: string; status: string; amount: number; from_vendor_id: string | null }>
  /**
   * Per vendor id: money that left that vendor's earnings after the order was
   * placed (payout requests PROCESSING, IN_TRANSIT or COMPLETED; WITHDRAWAL
   * or VENDOR_PAYMENT legs off their SELLER_EARNINGS that moved money).
   */
  vendor_withdrawals: Readonly<Record<string, ReadonlyArray<{ id: string; kind: string; status: string }>>>
}

/** The vendors approve-held would debit for these rows: those of rows it will still credit. */
export function vendorsDebitedOnApproval(rows: readonly StoredAttributionAmounts[]): string[] {
  const ids = rows
    .filter((r) => CREDITABLE_STATUSES.has(r.commission_status) && typeof r.vendor_id === "string" && r.vendor_id)
    .map((r) => r.vendor_id as string)
  return [...new Set(ids)]
}

/** An age in whole hours for a review line, or "an unknown time" when it cannot be read. */
function describeAge(ms: number): string {
  if (!Number.isFinite(ms)) return "an unknown time"
  const hours = Math.max(0, Math.floor(ms / 3_600_000))
  return `${hours} ${hours === 1 ? "hour" : "hours"}`
}

/**
 * Whether what the script could read, when it read it, already argues
 * against the vendor debit that correcting this order sets up. Returns the
 * reason to list the order for review, or null when nothing read does.
 *
 * The correction raises what approve-held will debit from `vendor_id`'s
 * SELLER_EARNINGS to the full commission (today every credit is refused, a
 * separate defect, so this lands when that is fixed). That is right only if
 * the vendor debited is the one who sold the order and the order's proceeds
 * are in their balance when the debit happens. So an order is listed when
 * any row approve-held will still credit:
 *
 * - names a vendor that is not the order's seller (the vendor comes from the
 *   creator's link or promo code, never from the order; under Mercur's split
 *   a cart's other sellers' orders carry the link's vendor too), or the order
 *   has no seller to compare with;
 * - names a vendor whose earnings do not hold the order's proceeds: no
 *   settlement leg of the order that moved money credits them. Either none
 *   was written (settlement with FF_CARD_ORDER_LEDGER_V1 off throws before
 *   any leg, SD-39; a charge on a partner's connected account settles
 *   nothing here; a card order in another currency is refused; a consignment
 *   split can send the whole seller side to the consignor), or a refund
 *   reversed it. The debit would then come out of other orders' proceeds, or
 *   fail on an empty account;
 * - is on an order that has been refunded in the ledger, in part or in full:
 *   a REFUND leg of the order moved money. A refund does not reverse a held
 *   attribution (only a cancellation does), and a card order refunded in
 *   part keeps its settlement leg, so without this the full commission would
 *   be debited for a sale the vendor gave most of back;
 * - names a vendor who has been paid out since the order was placed: a
 *   payout request that moved money, or a withdrawal or a payment to another
 *   vendor off their earnings. The commission was never carved out of that
 *   money, so the debit would come out of later sales' proceeds;
 * - is on an order whose proceeds a Mercur payout already sent;
 * - is on an order placed, or settled to the vendor's earnings, less than
 *   {@link PAYOUT_WINDOW_MS} before the check with no Mercur payout yet: the
 *   nightly payout has not reached it, and will send its proceeds in full,
 *   commission included. Settled, because an order whose payment was
 *   captured days after it was placed is paid out the night after the
 *   capture; or
 * - the order's placement time is unknown, so the above cannot be checked.
 *
 * Rows approve-held will not credit (reversed, disqualified) and rows with no
 * vendor (approve-held disqualifies those) set up no debit and pass.
 *
 * WHAT A NULL DOES NOT MEAN. This looks once, at `checked_at`. The debit
 * happens at approve-held, after the row's hold (7 days by default) and only
 * once crediting works, and nothing looks again then: a vendor paid out
 * between this check and that debit (an order older than the window whose
 * seller only later gets an active payout account, a payout request raised
 * the next day), or an order refunded in between, is debited the full
 * commission out of whatever the vendor holds by then. Nor does it read
 * every way money leaves a vendor's earnings: recoveries of what a vendor
 * owes (ADJUSTMENT legs taken from the seller credit at settlement) and
 * advance repayments are not looked at. Commission is not reserved from the
 * vendor at settlement, for corrected rows or for any new attributed order;
 * until it is, or until approve-held makes these checks itself, this narrows
 * the cases and settles none of them. Hence: run the script immediately
 * before the repair that makes crediting work deploys, not earlier.
 */
export function reviewVendorDebit(
  plan: Extract<CommissionMinorUnitCorrection, { action: "correct" }>,
  rows: readonly StoredAttributionAmounts[],
  ctx: VendorDebitContext
): string | null {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const creditable = plan.rows.filter((r) => CREDITABLE_STATUSES.has(r.status) && byId.get(r.id)?.vendor_id)
  if (!creditable.length) return null

  const vendors = vendorsDebitedOnApproval(creditable.map((r) => byId.get(r.id) as StoredAttributionAmounts))
  const reasons: string[] = []
  if (!ctx.order_placed_at) {
    reasons.push("the order's placement time is unknown, so payouts since it cannot be checked")
  }
  for (const vendor of vendors) {
    if (!ctx.order_seller_id) {
      reasons.push(`the order has no seller, so it cannot be confirmed that vendor ${vendor} sold it`)
    } else if (vendor !== ctx.order_seller_id) {
      reasons.push(
        `the attributed vendor ${vendor} is not the order's seller ${ctx.order_seller_id} ` +
          `(the vendor comes from the creator's link or promo code, not the order)`
      )
    }
    if (ctx.order_settled_to_vendor[vendor] !== true) {
      reasons.push(
        ctx.order_settlement_reversed[vendor] === true
          ? `the order's proceeds reached vendor ${vendor}'s earnings in the ledger and a refund reversed them ` +
              `(its settlement leg is REVERSED), so the debit would come out of other orders' proceeds`
          : `the order's proceeds never reached vendor ${vendor}'s earnings in the ledger ` +
              `(no settlement leg of the order that moved money credits them), ` +
              `so the debit would come out of other orders' proceeds`
      )
    }
    const refunded = ctx.order_refunds.filter((r) => r.from_vendor_id === vendor)
    if (refunded.length) {
      const shown = refunded.slice(0, 3).map((r) => `refund leg ${r.id} ${r.amount} ${r.status}`)
      reasons.push(
        `the order was refunded out of vendor ${vendor}'s earnings (${shown.join(", ")}${refunded.length > 3 ? ", …" : ""}) ` +
          `and its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)`
      )
    }
    const paid = ctx.vendor_withdrawals[vendor] ?? []
    if (paid.length) {
      const shown = paid.slice(0, 3).map((w) => `${w.kind} ${w.id} ${w.status}`)
      reasons.push(
        `vendor ${vendor} has been paid out since the order was placed (${shown.join(", ")}${paid.length > 3 ? ", …" : ""}), ` +
          `and the commission was never carved out of what they were paid`
      )
    }
  }
  if (ctx.order_refunds.length && !ctx.order_refunds.some((r) => r.from_vendor_id !== null && vendors.includes(r.from_vendor_id))) {
    // Refunded, but not out of the attributed vendor's earnings: they held
    // nothing to take (the ledger records the refund as owed by the vendor),
    // or the order settled to someone else.
    const shown = ctx.order_refunds.slice(0, 3).map((r) => `refund leg ${r.id} ${r.amount} ${r.status}`)
    reasons.push(
      `the order was refunded in the ledger (${shown.join(", ")}${ctx.order_refunds.length > 3 ? ", …" : ""}) ` +
        `with nothing taken from ${vendors.join(", ")}'s earnings, and its attribution was not reversed ` +
        `(a refund does not reverse a held attribution; only a cancellation does)`
    )
  }
  if (ctx.order_payout_ids.length) {
    reasons.push(`the order's proceeds were already sent to the vendor by Mercur payout ${ctx.order_payout_ids.join(", ")}`)
  } else if (ctx.order_placed_at) {
    // Not paid by Mercur yet. Inside the payout window that is only because
    // the nightly run has not reached the order. The window runs from the
    // later of the placement and the settlement to a vendor debited: the
    // payout pays captured money, and a capture can come days after the
    // order. `!(<=)` and `!(>=)` so an unreadable time anywhere lists the
    // order too, and once one is unreadable no later vendor's time replaces
    // it.
    const checkedAt = Date.parse(ctx.checked_at)
    const placedAt = Date.parse(ctx.order_placed_at)
    let windowStart = placedAt
    let settledLater = false
    for (const vendor of vendors) {
      if (Number.isNaN(windowStart)) break
      if (ctx.order_settled_to_vendor[vendor] !== true) continue
      const settledAt = Date.parse(ctx.order_settled_at[vendor] ?? "")
      if (!(settledAt <= windowStart)) {
        windowStart = settledAt
        settledLater = true
      }
    }
    const age = checkedAt - windowStart
    if (!(age >= PAYOUT_WINDOW_MS)) {
      const window =
        `inside the ${PAYOUT_WINDOW_MS / 3_600_000} hours in which the nightly payout sends an order's proceeds ` +
        `to its vendor, and no payout for it exists yet`
      reasons.push(
        settledLater
          ? `the order's proceeds reached the vendor's earnings ${describeAge(age)} before this check ` +
              `(the order was placed ${describeAge(checkedAt - placedAt)} before it), ${window}`
          : `the order was placed ${describeAge(age)} before this check, ${window}`
      )
    }
  }
  if (!reasons.length) return null

  const from = creditable.reduce((sum, r) => sum + r.commission.from, 0)
  const to = creditable.reduce((sum, r) => sum + r.commission.to, 0)
  return (
    `${reasons.join("; ")}. Correcting would raise what the approve-held job debits from ` +
    `${vendors.join(", ")}'s current earnings for this order from ${from} to ${to} once commission ` +
    `crediting works. Operator decision, not changed here`
  )
}
