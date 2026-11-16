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
 * out of the vendor's balance at the time. {@link reviewVendorDebit} decides
 * whether that debit can be justified without a person; the script asks it
 * for every order this planner would correct.
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

/** What the script reads about who approve-held would debit for an order, and whether they were paid since. */
export type VendorDebitContext = {
  /** The order's seller (Mercur's seller link), or null when it has none. */
  order_seller_id: string | null
  /** When the order was placed (ISO), or null when unknown. */
  order_placed_at: string | null
  /** Mercur payouts that paid this order's proceeds to the vendor (`order.payouts`). */
  order_payout_ids: readonly string[]
  /**
   * Per vendor id: money that left that vendor's earnings after the order was
   * placed (payout requests PROCESSING, IN_TRANSIT or COMPLETED; completed
   * WITHDRAWAL legs off their SELLER_EARNINGS).
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

/**
 * Whether correcting this order would set up a vendor debit nobody can
 * justify without a person. Returns the reason to list it for review, or
 * null when the correction can go ahead.
 *
 * The correction raises what approve-held will debit from `vendor_id`'s
 * SELLER_EARNINGS to the full commission (today every credit is refused, a
 * separate defect, so this lands when that is fixed). That is right only if
 * the vendor debited is the one who sold the order and the order's proceeds
 * are still in their balance. So an order is listed when any row
 * approve-held will still credit:
 *
 * - names a vendor that is not the order's seller (the vendor comes from the
 *   creator's link or promo code, never from the order; under Mercur's split
 *   a cart's other sellers' orders carry the link's vendor too), or the order
 *   has no seller to compare with;
 * - names a vendor who has been paid out since the order was placed: a
 *   payout request that moved money, or a withdrawal off their earnings. The
 *   commission was never carved out of that money, so the debit would come
 *   out of later sales' proceeds;
 * - is on an order whose proceeds a Mercur payout already sent; or
 * - the order's placement time is unknown, so the above cannot be checked.
 *
 * Rows approve-held will not credit (reversed, disqualified) and rows with no
 * vendor (approve-held disqualifies those) set up no debit and pass.
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
    const paid = ctx.vendor_withdrawals[vendor] ?? []
    if (paid.length) {
      const shown = paid.slice(0, 3).map((w) => `${w.kind} ${w.id} ${w.status}`)
      reasons.push(
        `vendor ${vendor} has been paid out since the order was placed (${shown.join(", ")}${paid.length > 3 ? ", …" : ""}), ` +
          `and the commission was never carved out of what they were paid`
      )
    }
  }
  if (ctx.order_payout_ids.length) {
    reasons.push(`the order's proceeds were already sent to the vendor by Mercur payout ${ctx.order_payout_ids.join(", ")}`)
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
