/**
 * The card-processing leg of a fee-first order settlement (Black Mask F6,
 * `FF_FEE_FIRST_SPLIT_V1`; operator decision 2026-10-05 6d / 6e).
 *
 * With the fee-first split on, the card-processing ESTIMATE comes off FBM's
 * charge before the platform fee. The ledger records it as its own leg,
 * ESCROW -> a dedicated system account, so escrow still nets to zero and the
 * amount is visible as what it is:
 *
 *   - account_type PLATFORM_FEE, owner_type SYSTEM, owner_id `processing`.
 *     Never SETTLEMENT (the vendor-payout settlement account) and never the
 *     shared PLATFORM_FEE balance owned by `system`: the plugin and referral
 *     disbursers draw on that one under balance guards, and processing money
 *     there would read as commission they may pay out. The singleton lookup
 *     (`getOrCreateSystemAccount`) pins owner_id, so the two never mix.
 *   - entry_type FEE (existing vocabulary), keyed `<order key>-processing`
 *     from the record, stamped `metadata.leg = CARD_PROCESSING_LEG`.
 *
 * USD only, record-only: the leg moves a ledger figure inside FBM's own
 * books, mirroring money Stripe keeps from FBM's own charge. No balance is
 * held for anyone, nothing is paid out of it, and the Posture A guard treats
 * USD as passthrough (`posture-a-guard.ts`). No new reference type.
 *
 * On a refund the leg is NOT reversed (6e): Stripe keeps its fee on a
 * refunded charge, and the vendor bears it. `processRefund` leaves the leg
 * COMPLETED and the seller balancing leg absorbs it, so escrow still nets to
 * zero.
 *
 * The vendor-shortfall leg. A vendor whose only unpaid earnings are this
 * order's (the commonest shape: one order since the last payout) holds less
 * than the balancing leg, because the order credited them sale - processing
 * - fee while the refund takes back sale - fee. The ledger refuses a negative
 * balance, so the refund cannot simply overdraw them; refusing the refund
 * instead would leave earnings for a refunded order payable by ACH. So the
 * refund ALWAYS posts: the vendor's leg takes everything they hold up to the
 * planned amount, and the gap (never more than the retained processing) is
 * funded card-processing account -> ESCROW as its own leg, entry_type
 * ADJUSTMENT, `metadata.leg = CARD_PROCESSING_SHORTFALL_LEG`, naming the
 * seller account it is owed by. That leg is the record of a receivable from
 * the vendor: the processing leg itself stays COMPLETED (Stripe did keep the
 * fee), and the processing account's balance reads as processing actually
 * borne by vendors.
 *
 * The vendor-recovery leg (operator answer 2026-10-06, item 20: "recover from
 * the vendor's next earnings automatically, shown on their statement"; item
 * 22: consignors share processing pro rata, so a consignor's shortfall is
 * the consignor's own). The receivable is recovered automatically, with no
 * per-vendor opt-out, as the mirror image of the shortfall: entry_type
 * ADJUSTMENT, the vendor's SELLER_EARNINGS account -> the card-processing
 * account, `metadata.leg = CARD_PROCESSING_RECOVERY_LEG`, naming the
 * shortfall it repays (`recovers_entry_id`) and where the money came from
 * (`source`). It puts back the processing balance the shortfall used up.
 *
 *   - Next earnings: 100% of each later seller credit (the plain seller leg
 *     and each consignment -consignor / -vendor leg, against that leg's own
 *     account) goes to the oldest open shortfall first, partial recovery
 *     allowed, never more than the credit and never below zero.
 *   - Outflow backstop: `requestPayout` and `createVendorToVendorPayment`
 *     recover what is owed from the available balance BEFORE their balance
 *     check, then re-read, so a vendor can never cash out while owing,
 *     directly or by paying the balance to a second seller account first;
 *     `getPayoutOptions` reports the net payable.
 *   - The receivable is computed from entries (shortfalls minus recoveries,
 *     `computeCardProcessingReceivable`), never stored.
 *   - No `order_id` on a recovery leg: a later refund of the order whose
 *     earnings paid it marks every COMPLETED entry with that order_id
 *     REVERSED, which would silently reopen the receivable with no money
 *     moving. A refund of such an order is not refused either: its cap is
 *     raised by what that order's earnings repaid, and the excess is
 *     recorded as a fresh shortfall (`processRefund`).
 *   - Not gated on FF_FEE_FIRST_SPLIT_V1: recovery runs whenever a shortfall
 *     is outstanding, so rolling the flag back cannot strand a receivable.
 *     With no shortfall the money path does one read while no processing
 *     account exists (two once it does), never a write, and never creates
 *     the processing account.
 *
 * Write-off by age (operator answer 2026-10-06: "by age", 180 days, the
 * clock running from the refund that recorded the shortfall). Once a
 * shortfall is CARD_PROCESSING_WRITE_OFF_DAYS old, whatever is still
 * outstanding on it is forgiven: it leaves the receivable, so no recovery
 * leg, payout backstop or vendor-payment backstop collects it again, and it
 * is reported in `written_off` so the vendor's statement can say it was
 * forgiven. No money moves and nothing is written — the processing account
 * already funded the shortfall when it was recorded, so it simply keeps
 * having borne it (the platform absorbs it). Like the rest of the
 * receivable it is computed from the ledger's rows at read time, from the
 * shortfall leg's own `created_at`; a shortfall with no `created_at` is never
 * written off. A fresh shortfall a later refund re-records (`processRefund`)
 * starts its own clock. The age is a code constant, not configuration:
 * changing it re-reads every shortfall, so it is a reviewed change.
 */

import {
  VENDOR_REFUND_RECOVERY_LEG,
  VENDOR_REFUND_SHORTFALL_LEG,
} from "./vendor-receivable"

export const CARD_PROCESSING_ACCOUNT_TYPE = "PLATFORM_FEE"
export const CARD_PROCESSING_OWNER_ID = "processing"
export const CARD_PROCESSING_LEG = "card_processing_estimate"
export const CARD_PROCESSING_SHORTFALL_LEG = "card_processing_vendor_shortfall"
export const CARD_PROCESSING_RECOVERY_LEG = "card_processing_vendor_recovery"

/** Operator answer 2026-10-06: forgive an unrepaid shortfall after 180 days. */
export const CARD_PROCESSING_WRITE_OFF_DAYS = 180
const WRITE_OFF_MS = CARD_PROCESSING_WRITE_OFF_DAYS * 24 * 60 * 60 * 1000

/**
 * Where a recovery leg's money came from: a later seller credit, or the
 * balance at an outflow the vendor asked for (a payout, a vendor-to-vendor
 * payment).
 */
export type CardProcessingRecoverySource = "seller_credit" | "payout" | "vendor_payment"

/** True for the fee-first processing leg of an order settlement. */
export function isCardProcessingLeg(entry: {
  entry_type?: string | null
  metadata?: unknown
}): boolean {
  return (
    entry.entry_type === "FEE" &&
    (entry.metadata as { leg?: unknown } | null | undefined)?.leg === CARD_PROCESSING_LEG
  )
}

/**
 * True for the refund leg that records a vendor's processing shortfall: the
 * part of the retained processing their earnings could not absorb, owed by
 * `metadata.owed_by_account_id` (a receivable, recovered by
 * CARD_PROCESSING_RECOVERY_LEG legs).
 */
export function isCardProcessingShortfallLeg(entry: {
  entry_type?: string | null
  metadata?: unknown
}): boolean {
  return (
    entry.entry_type === "ADJUSTMENT" &&
    (entry.metadata as { leg?: unknown } | null | undefined)?.leg === CARD_PROCESSING_SHORTFALL_LEG
  )
}

/**
 * True for a leg that repays (part of) a vendor-shortfall receivable: the
 * vendor's SELLER_EARNINGS -> the card-processing account, naming the
 * shortfall in `metadata.recovers_entry_id`.
 */
export function isCardProcessingRecoveryLeg(entry: {
  entry_type?: string | null
  metadata?: unknown
}): boolean {
  return (
    entry.entry_type === "ADJUSTMENT" &&
    (entry.metadata as { leg?: unknown } | null | undefined)?.leg === CARD_PROCESSING_RECOVERY_LEG
  )
}

/**
 * What a receivable is for (SD-40). Both kinds are owed by a vendor, recovered
 * by the same machinery oldest first, and forgiven at the same age; they
 * differ only in which account funded them, and so which account a recovery
 * repays (`funding_account_id`).
 *
 *   - card_processing: retained card processing on a refunded order the
 *     vendor's earnings could not absorb (the card-processing account).
 *   - refund: a card refund that landed after the vendor's earnings for it
 *     were paid out (`./vendor-receivable.ts`, the VENDOR_RECEIVABLE account).
 */
export type VendorReceivableKind = "card_processing" | "refund"

/** The shortfall-leg tag and recovery-leg tag for each kind. */
export const RECEIVABLE_LEGS: Record<VendorReceivableKind, { shortfall: string; recovery: string }> = {
  card_processing: { shortfall: CARD_PROCESSING_SHORTFALL_LEG, recovery: CARD_PROCESSING_RECOVERY_LEG },
  refund: { shortfall: VENDOR_REFUND_SHORTFALL_LEG, recovery: VENDOR_REFUND_RECOVERY_LEG },
}

/** The kind of a shortfall leg, or null for any other entry. */
export function receivableShortfallKind(entry: {
  entry_type?: string | null
  metadata?: unknown
}): VendorReceivableKind | null {
  if (entry.entry_type !== "ADJUSTMENT") return null
  const leg = (entry.metadata as { leg?: unknown } | null | undefined)?.leg
  if (leg === CARD_PROCESSING_SHORTFALL_LEG) return "card_processing"
  if (leg === VENDOR_REFUND_SHORTFALL_LEG) return "refund"
  return null
}

/** True for a recovery leg of either kind. */
export function isReceivableRecoveryLeg(entry: { entry_type?: string | null; metadata?: unknown }): boolean {
  if (entry.entry_type !== "ADJUSTMENT") return false
  const leg = (entry.metadata as { leg?: unknown } | null | undefined)?.leg
  return leg === CARD_PROCESSING_RECOVERY_LEG || leg === VENDOR_REFUND_RECOVERY_LEG
}

type ReceivableRow = {
  id: string
  amount?: unknown
  status?: string | null
  entry_type?: string | null
  order_id?: string | null
  created_at?: unknown
  debit_account_id?: string | null
  credit_account_id?: string | null
  metadata?: unknown
}

export type OpenCardProcessingShortfall = {
  shortfall_id: string
  kind: VendorReceivableKind
  /** The account that funded the shortfall: a recovery repays this one. */
  funding_account_id: string
  /** The refunded order the shortfall was recorded on. */
  order_id: string | null
  owed_cents: number
  recovered_cents: number
  outstanding_cents: number
  created_at: unknown
  /**
   * Every recovery row on this shortfall, whatever its status. The next
   * recovery's idempotency key uses it, so a FAILED attempt never hands its
   * row back to a retry and two writers that read the same state collide on
   * the ledger's unique key instead of both posting.
   */
  next_seq: number
}

export type WrittenOffCardProcessingShortfall = {
  shortfall_id: string
  kind: VendorReceivableKind
  order_id: string | null
  owed_cents: number
  recovered_cents: number
  /** Outstanding when it reached the write-off age: absorbed by the platform. */
  forgiven_cents: number
  created_at: unknown
  /** `created_at` + CARD_PROCESSING_WRITE_OFF_DAYS, ISO-8601. */
  written_off_at: string
}

export type CardProcessingReceivable = {
  total_cents: number
  /** `total_cents` split by kind (both kinds sum to it). */
  by_kind_cents: Record<VendorReceivableKind, number>
  /** Open shortfalls, oldest first. Never includes a written-off one. */
  open: OpenCardProcessingShortfall[]
  /** Shortfalls forgiven by age, oldest first (only when `asOfMs` is given). */
  written_off: WrittenOffCardProcessingShortfall[]
  written_off_cents: number
  /** Cents already recovered (COMPLETED or in flight) per `source_entry_id`. */
  recovered_by_source_entry: Record<string, number>
}

const toCentsInt = (n: unknown) => Math.round(Number(n ?? 0) * 100)
const metaOf = (e: ReceivableRow) => (e.metadata ?? {}) as Record<string, unknown>
const createdMs = (e: ReceivableRow) => {
  const t = e.created_at ? new Date(e.created_at as string).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

/**
 * What a seller account owes, computed from the ledger's own rows (never
 * stored): every COMPLETED shortfall leg of either kind (retained card
 * processing, or a card refund after payout — SD-40) owed by
 * `sellerAccountId`, less the recovery legs that name it. A recovery counts
 * once COMPLETED, and also while PENDING (in flight), so a concurrent writer
 * never collects the same cents twice; FAILED and REVERSED rows count for
 * nothing. Integer cents, each shortfall clamped at zero, oldest first (by
 * `created_at`; rows without one keep their listed order).
 *
 * With `asOfMs`, a shortfall whose `created_at` is at least
 * CARD_PROCESSING_WRITE_OFF_DAYS before it is written off: its outstanding
 * amount moves from `open` / `total_cents` to `written_off`. Without it
 * nothing is written off (the pure function stays clock-free).
 */
export function computeCardProcessingReceivable(
  sellerAccountId: string,
  rows: { shortfalls: ReceivableRow[]; recoveries: ReceivableRow[] },
  options: { asOfMs?: number } = {}
): CardProcessingReceivable {
  const shortfalls = rows.shortfalls
    .filter(
      (e) =>
        receivableShortfallKind(e) !== null &&
        e.status === "COMPLETED" &&
        metaOf(e).owed_by_account_id === sellerAccountId
    )
    .map((e, i) => ({ e, i }))
    .sort((a, b) => createdMs(a.e) - createdMs(b.e) || a.i - b.i)
    .map(({ e }) => e)

  const recoveredByShortfall = new Map<string, number>()
  const rowsByShortfall = new Map<string, number>()
  const recoveredBySource: Record<string, number> = {}
  for (const r of rows.recoveries) {
    if (!isReceivableRecoveryLeg(r) || r.debit_account_id !== sellerAccountId) continue
    const meta = metaOf(r)
    const target = typeof meta.recovers_entry_id === "string" ? meta.recovers_entry_id : null
    if (!target) continue
    rowsByShortfall.set(target, (rowsByShortfall.get(target) ?? 0) + 1)
    if (r.status !== "COMPLETED" && r.status !== "PENDING") continue
    const c = toCentsInt(r.amount)
    recoveredByShortfall.set(target, (recoveredByShortfall.get(target) ?? 0) + c)
    if (typeof meta.source_entry_id === "string") {
      recoveredBySource[meta.source_entry_id] = (recoveredBySource[meta.source_entry_id] ?? 0) + c
    }
  }

  const open: OpenCardProcessingShortfall[] = []
  const writtenOff: WrittenOffCardProcessingShortfall[] = []
  let total = 0
  let writtenOffTotal = 0
  const byKind: Record<VendorReceivableKind, number> = { card_processing: 0, refund: 0 }
  const asOf = options.asOfMs
  for (const s of shortfalls) {
    const owed = toCentsInt(s.amount)
    const recovered = recoveredByShortfall.get(s.id) ?? 0
    const outstanding = Math.max(0, owed - recovered)
    if (outstanding <= 0) continue
    const born = createdMs(s)
    const kind = receivableShortfallKind(s) as VendorReceivableKind
    if (asOf !== undefined && Number.isFinite(asOf) && born > 0 && asOf - born >= WRITE_OFF_MS) {
      writtenOffTotal += outstanding
      writtenOff.push({
        shortfall_id: s.id,
        kind,
        order_id: s.order_id ?? null,
        owed_cents: owed,
        recovered_cents: recovered,
        forgiven_cents: outstanding,
        created_at: s.created_at ?? null,
        written_off_at: new Date(born + WRITE_OFF_MS).toISOString(),
      })
      continue
    }
    total += outstanding
    byKind[kind] += outstanding
    open.push({
      shortfall_id: s.id,
      kind,
      funding_account_id: String(s.debit_account_id ?? ""),
      order_id: s.order_id ?? null,
      owed_cents: owed,
      recovered_cents: recovered,
      outstanding_cents: outstanding,
      created_at: s.created_at ?? null,
      next_seq: rowsByShortfall.get(s.id) ?? 0,
    })
  }
  return {
    total_cents: total,
    by_kind_cents: byKind,
    open,
    written_off: writtenOff,
    written_off_cents: writtenOffTotal,
    recovered_by_source_entry: recoveredBySource,
  }
}
