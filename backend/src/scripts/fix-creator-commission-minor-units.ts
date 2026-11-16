import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { readCardSettlementOrder } from "../lib/card-order-settlement"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"
import {
  planCommissionMinorUnitCorrection,
  reviewVendorDebit,
  vendorsDebitedOnApproval,
  type MajorUnitOrderTotals,
  type OrderPaymentSide,
  type StoredAttributionAmounts,
  type VendorDebitContext,
} from "../modules/creator-attribution/minor-unit-correction"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { APPLY_OR_DRY_RUN, parseScriptArgs } from "../shared/exec-args"

/**
 * Put stored creator-commission amounts into minor units (SD-95).
 *
 *     npx medusa exec ./src/scripts/fix-creator-commission-minor-units.ts
 *     npx medusa exec ./src/scripts/fix-creator-commission-minor-units.ts apply
 *
 * The first is a dry run: it writes nothing and lists what it would do.
 * Writing needs the word `apply`; `dry-run` says the default out loud. Any
 * other word, or `apply` with `dry-run`, is refused before anything is read
 * (`parseScriptArgs`), so a typo can only ever stop the run, never make it
 * write. Bare words, not `--apply`: `medusa exec` refuses unknown `--`
 * options and drops everything after a `--` separator.
 *
 * Why a script and not a migration script: some rows cannot be corrected by
 * a rule. The subscriber stored Medusa's major-unit subtotal as cents, so
 * every attributed order recorded 1/100 of its commission. A row the hourly
 * approve-held job already credited to the creator's ledger at the old
 * figure is only listed, because what to do about money already moved is
 * the operator's decision, and changing the column alone would make a later
 * refund reverse more than was credited. A one-shot migration would also run
 * before a rolling deploy finished, while an old instance could still be
 * writing old-unit rows; this can be run again afterwards and skips what it
 * already did. `planCommissionMinorUnitCorrection` decides each order's
 * figures and says why.
 *
 * WHAT CORRECTING A HELD ROW SETS UP. A `pending` or `held` row has, by its
 * own record, moved no money to the creator (whether the ledger agrees is
 * one of the checks below), and its commission was never taken from the
 * vendor either: settlement credits the vendor's SELLER_EARNINGS the sale
 * less the platform fee and processing, and approve-held is what later
 * debits the vendor for the commission, at whatever the column says when it
 * runs. So
 * correcting a held row raises that future debit from 1/100 to the full
 * commission, out of the vendor's balance at the time. Today approve-held's
 * credit is refused for every row (a separate defect, SD-99 in
 * docs/AUDIT_DEBT.md: "no creator commission is ever credited"); once that
 * is fixed, every held row this script corrected is debited at the full
 * figure in the next run.
 * `reviewVendorDebit` therefore lists, instead of correcting, any order
 * where what can be read now already argues against that debit:
 *
 * - the attributed vendor is not the order's seller;
 * - the order's proceeds are not in the vendor's SELLER_EARNINGS (no
 *   `order-payment-<order>-seller`, `-vendor` or `-consignor` leg that moved
 *   money credits them: settlement with FF_CARD_ORDER_LEDGER_V1 off, a
 *   charge on a partner's connected account, a non-USD card order; or a
 *   refund reversed the leg);
 * - the order was refunded, in part or in full. A refund does not reverse a
 *   held attribution: nothing emits the `order.refund_created` the reversal
 *   listens for, only `order.canceled` reaches it. Two reads, because the
 *   ledger does not post every refund:
 *   - the ledger: a REFUND leg of the order moved money; and
 *   - the order's payment records, read as the ledger's own settlement reads
 *     them (`readCardSettlementOrder`: the order's split payment row, its
 *     payment collection, Stripe's figures for the charge): an amount
 *     refunded for the order; an amount refunded on its payment collection
 *     that is recorded on no order; or a card dispute still open on it. A
 *     storefront order shares its cart's payment collection, and a refund
 *     made with Medusa's own refund (the admin panel's Refund button) is
 *     recorded on the collection and on no order: the ledger posts nothing
 *     for it until an admin assigns it. Nor is a refund in the ledger when
 *     it was made on the split row and the reconciler job has not run
 *     since, or when the order's legs were already anchored SETTLED, which
 *     the reconciler does not post (SD-109). Reading the ledger alone
 *     corrected all three;
 * - the order's payment records cannot answer that: they could not be read,
 *   the order was not paid through FBM's own card account (no payment
 *   collection, another provider, a partner's connected account), they put
 *   no amount on this one order, or they were not read from every payment
 *   collection linked to the order. A storefront order's are read from the
 *   collection its split payment row names; a further collection (an order
 *   change that raised the total takes its payment on a new one) is not
 *   read, and a refund made there was corrected. Listed, not assumed
 *   unrefunded;
 * - the vendor has been paid out since the order was placed (a payout
 *   request that moved money, or a withdrawal or a payment to another vendor
 *   off their earnings);
 * - the vendor's earnings were debited since the order was placed by any
 *   other ledger leg, whatever its entry type and whatever its status: the
 *   ledger's recovery of what they owed (ADJUSTMENT), an advance repayment,
 *   a creator reward pool funded from their earnings
 *   (`fundCreatorRewardPool`, a TRANSFER leg), a transfer an admin made by
 *   hand (`POST /admin/hawala/transfers` posts whatever entry type it is
 *   given), a hub's cut, a refund of another order of theirs, another
 *   order's creator commission. The read asks for no entry type and no
 *   status. A leg that is COMPLETED or SETTLED is listed as money taken; a
 *   leg in any other status (PENDING, REVERSED, FAILED) is listed as a debit
 *   the ledger cannot say moved no money. The only legs left out, by id, are
 *   ones the order is already listed for: its own refund legs that moved
 *   money (above) and the entries under its own commission keys (next);
 * - a commission credit for the order is already in the ledger: an entry
 *   exists, in any status, under the key approve-held credits one of the
 *   order's rows with (`creator-commission-<row id>`), while the row says
 *   no money has moved. approve-held credits first and updates the row
 *   second, so a row update that failed leaves a held row whose commission
 *   was taken at the old figure. The job would then be handed that entry
 *   back (`createTransfer` returns whatever exists under a key), move
 *   nothing more, and approve the row at whatever the column says:
 *   corrected first, the row would say 100 times what the ledger moved;
 * - Mercur already paid the order's proceeds out (`order.payouts`); or
 * - the order was placed, or settled to the vendor's earnings, in the last
 *   2 days and Mercur has not paid it yet: the nightly payout
 *   (`jobs/daily-payouts.ts`) sends each order's proceeds in full within
 *   about a day of its money being captured. Capture normally follows
 *   placement at once (Mercur's `order-set-placed-payment-capture`), but
 *   Stripe intents here are manual-capture, and an order whose capture
 *   failed then and was made today is paid tonight, however old it is.
 *
 * What is corrected is an order placed and settled at least 2 days ago whose
 * seller is the vendor debited, whose proceeds entered that vendor's
 * earnings, which was paid by card, whose payment records were read from
 * every payment collection linked to it and show nothing refunded for it,
 * nothing refunded on its collection that no order accounts for and no open
 * dispute, which has no refund leg in the ledger and no entry under any of
 * its rows' commission keys, and whose vendor's earnings no payout request
 * that moved money and no ledger leg of any entry type or status has debited
 * since. That is all "not refunded" and "not drawn on" mean here. NOT SEEN:
 * a refund made in Stripe's dashboard before Stripe's webhook has recorded
 * it; a refund that is owed but not yet made (a return received, an order
 * dispute decided for the buyer: the decision moves no money, the refund
 * follows); money of the vendor's that is not in SELLER_EARNINGS; and
 * anything after this run. With FF_CARD_ORDER_LEDGER_V1 off (the default)
 * no order settles to the ledger (the legacy settlement throws before any
 * leg, SD-39), so no held or pending row that names a vendor is corrected:
 * every one is listed.
 *
 * WHEN TO RUN IT: IMMEDIATELY BEFORE THE REPAIR THAT MAKES COMMISSION
 * CREDITING WORK DEPLOYS, NOT EARLIER. Those checks are made once, when
 * this runs. The debit they are about happens later, at approve-held (the
 * first hourly run after a row's hold, 7 days by default, has ended and
 * crediting works), and nothing checks again then. A vendor paid out in
 * between (a payout request the next night, a seller whose payout account
 * only then becomes active), or whose order is refunded in between, is still
 * debited the full commission for every row corrected here, out of whatever
 * they hold by then. Every day between this run and that deploy adds such
 * vendors, so the gap should be minutes, not weeks; a row still inside its
 * hold stays exposed until the hold ends, whenever this runs. Nor should it
 * run after the deploy: approve-held would by then be crediting old rows at
 * 1/100, and those can only be listed. Commission is not reserved from the
 * vendor at settlement, for these rows or for any new attributed order; that
 * is open as SD-99 (2) and blocks that repair.
 *
 * Each order's rows are written in one transaction, each row by one UPDATE
 * conditional on the status and figures it was planned from
 * (`correctAttributionAmountsIfUnchanged`): a row approve-held approved or a
 * refund reversed in between is not written, the order's other rows roll
 * back with it, and the order is listed.
 *
 * Run it outside the approve-held job's minute (it runs hourly at :00). That
 * job takes its list of due rows, amounts included, when it starts; a row
 * this script corrects while such a run is iterating is credited the old
 * figure from that list while the column says the new one, and a later
 * refund would reverse the new one. That cannot happen while every credit is
 * refused (above), which is the other reason to run this before the repair
 * and not after.
 *
 * Each corrected row keeps its own record: the old and new figures go on its
 * `metadata.amount_units_corrected`, and it is marked
 * `metadata.amount_unit = "minor"` like rows the subscriber writes, which
 * also makes a second run skip it.
 */

const ACTOR_ID = "script:fix-creator-commission-minor-units"
const PAGE = 200

type Row = StoredAttributionAmounts & { created_at?: Date | string }

/**
 * Payout request statuses whose legs have taken the money off the vendor's
 * earnings. Read to name the payout in the review line. A request's legs
 * (`requestPayout`: a WITHDRAWAL and, with a fee, a FEE leg off the vendor's
 * earnings) are read with every other debit, whatever the request's own
 * status says, so a request left PENDING after its legs posted is listed by
 * its legs.
 */
const PAID_OUT_STATUSES = ["PROCESSING", "IN_TRANSIT", "COMPLETED"] as const

/**
 * Ledger entry statuses under which the money has moved. A COMPLETED entry
 * becomes SETTLED when the daily settlement batch anchors it
 * (`jobs/hawala-settlement.ts`); it moved the same money either way.
 */
const MOVED_ENTRY_STATUSES = ["COMPLETED", "SETTLED"] as const

/**
 * The statuses a settlement leg is read in: those under which it moved money,
 * and REVERSED, which a refund sets on a leg that had (`processRefund`: every
 * leg of a wallet order, a card order's once it is refunded in full). A
 * REVERSED leg does not count as the order's proceeds being with the vendor;
 * it is read so the review line can say a refund took them back.
 */
const SETTLEMENT_LEG_STATUSES = [...MOVED_ENTRY_STATUSES, "REVERSED"] as const

/**
 * Ledger legs by which money leaves a vendor's earnings at the vendor's own
 * hand: a withdrawal (a payout request's leg, a Mercur-paid order booked out,
 * an ACH withdrawal) or a payment to another vendor. Used ONLY to word the
 * review line ("paid out"); which legs count is not decided by entry type.
 */
const OUTFLOW_ENTRY_TYPES = ["WITHDRAWAL", "VENDOR_PAYMENT"] as const

/**
 * WHICH DEBITS OF A VENDOR'S EARNINGS COUNT: every one written since the
 * order was placed. The read asks for no entry type and no status.
 *
 * No entry type, because the column is plain text and `createTransfer` posts
 * whatever it is given: the ledger's recoveries of what a vendor owes are
 * ADJUSTMENT (`recoverCardProcessingShortfall`), `processAdvanceRepayment`
 * posts ADVANCE_REPAYMENT, a creator reward pool funded from a vendor's
 * earnings is a TRANSFER (`fundCreatorRewardPool`, which `POST
 * /v1/seller/programs/:id/reward-pools` calls once it has stored the pool),
 * a hub's cut of a grower's sale is COMMISSION
 * (`payout-breakdown/grower-payout.ts`), and `POST /admin/hawala/transfers`
 * passes the admin's own `entry_type` straight through. A list of types to
 * look for was twice found one short, and the one type this read then left
 * out, CREATOR_COMMISSION, was a third: it was meant as "another order's
 * commission, the debit approve-held makes", and it let through an admin's
 * transfer under that label and this order's own commission leg.
 *
 * Another order's commission is not left out in a narrower form either.
 * `creditCreatorCommission` posts it as CREATOR_COMMISSION with reference
 * type CREATOR_ATTRIBUTION, the attribution row's id as the reference, the
 * order's id and the key `creator-commission-<row id>`, off the vendor's
 * SELLER_EARNINGS into the creator's CREATOR_EARNINGS. Every one of those is
 * a label `createTransfer` takes from its caller, and the admin route
 * forwards all of them but the order id today. And a leg that IS another
 * order's commission takes nothing of this order's only if that order's own
 * proceeds were in the same earnings, which would need this whole gate run
 * on that order. What the gate is for is to list an order when money has
 * left the earnings its commission would be debited from; such a leg is
 * money that left them, so the order is listed and the line names the other
 * order. It should cost nothing where this script is meant to run: no
 * commission is credited today (SD-99), so there should be no such leg (not
 * checked against a production copy); where there is one, crediting already
 * works for that vendor, and the operator should hear it.
 *
 * No status, for the same reason and one more. `createTransfer` writes a leg
 * PENDING, moves both balances in one database transaction, then marks the
 * leg COMPLETED in a separate statement. A process that stops, or a
 * statement that fails, between the two leaves a PENDING leg whose money
 * moved; one that stops before the transaction leaves a PENDING leg whose
 * money did not; and any transfer in flight while this runs is PENDING for
 * that moment. The ledger cannot tell these apart, so a PENDING leg lists
 * the order. REVERSED is a leg that moved money and that a refund
 * relabelled (`processRefund`); it posts the refund as legs of its own and
 * returns nothing to the vendor by the label. FAILED is set when the balance
 * move threw: rolled back whole when it ran in a database transaction, but
 * the ledger's fallback path can leave the debit applied
 * (`applyBalancePairWithCompensation`, which logs it for manual
 * reconciliation), so it is counted too, and the line says FAILED. Only
 * legs that DEBIT the earnings are read, so an ADJUSTMENT that returns a
 * failed payout to them is not one.
 */

/**
 * The idempotency key approve-held's ledger call credits an attribution row
 * under (`creditCreatorCommission` in `modules/hawala-ledger/service.ts`).
 * `createTransfer` looks an entry up by its key before anything else and
 * returns the one it finds, in whatever status, so an entry under this key
 * is what approve-held gets back for the row instead of a new credit.
 */
function commissionCreditKey(attributionId: string): string {
  return `creator-commission-${attributionId}`
}

/** How many of a vendor's debits are read for the review line; one is enough to list the order. */
const DEBITS_READ = 10

/** What to call a debit of a vendor's earnings in the review line, by its entry type. */
const DEBIT_KINDS: Readonly<Record<string, string>> = {
  WITHDRAWAL: "withdrawal",
  // Not in the model's entry_type enum: createTransfer takes any string and
  // createVendorToVendorPayment posts this one.
  VENDOR_PAYMENT: "vendor payment",
  ADJUSTMENT: "adjustment",
  // Not in the enum either (`processAdvanceRepayment`).
  ADVANCE_REPAYMENT: "advance repayment",
}

/**
 * A debit of a vendor's earnings, named for the review line: the four kinds
 * with a name of their own, otherwise the leg's raw entry type with the
 * order or the reference type it carries, so an operator can tell a funded
 * reward pool and a refund of another order apart.
 */
function debitKind(leg: { entry_type?: unknown; reference_type?: unknown; order_id?: unknown }): string {
  const type = String(leg.entry_type)
  const known = DEBIT_KINDS[type]
  if (known) return known
  if (typeof leg.order_id === "string" && leg.order_id) return `${type} leg of order ${leg.order_id}`
  if (typeof leg.reference_type === "string" && leg.reference_type) return `${type} leg for ${leg.reference_type}`
  return `${type} leg`
}

/**
 * The idempotency keys of the legs by which settlement credits an order's
 * proceeds to a seller's SELLER_EARNINGS: `-seller` on the plain path
 * (`processOrderPayment`), `-vendor` and `-consignor` on a consignment split
 * (`processConsignmentSplit`). `lib/card-order-reconcile.ts` recognises a
 * settled order by the same three.
 */
function orderSettlementLegKeys(orderId: string): string[] {
  return ["seller", "vendor", "consignor"].map((leg) => `order-payment-${orderId}-${leg}`)
}

function movedMoney(status: unknown): boolean {
  return (MOVED_ENTRY_STATUSES as readonly string[]).includes(String(status))
}

/**
 * When the latest of these legs was written (ISO), or null when there are
 * none or any of them has no readable time: a settlement at an unknown time
 * cannot be shown to be outside the payout window.
 */
function latestCreatedAt(legs: ReadonlyArray<{ created_at?: unknown }>): string | null {
  let latest: number | null = null
  for (const leg of legs) {
    const at = leg.created_at ? new Date(leg.created_at as Date | string).getTime() : NaN
    if (Number.isNaN(at)) return null
    if (latest === null || at > latest) latest = at
  }
  return latest === null ? null : new Date(latest).toISOString()
}

export type CommissionMinorUnitFixSummary = {
  /** Orders corrected, or on a dry run would be, with their figures. */
  corrected: Array<{
    order_id: string
    subtotal: { from: number; to: number }
    commission_total: { from: number; to: number }
    rows: string[]
  }>
  skipped: Array<{ order_id: string; reason: string }>
  /**
   * Left alone for a person: unclear figures, commission already credited, or
   * a vendor debit the correction would set up that needs a decision.
   */
  review: Array<{ order_id: string; reason: string }>
  /**
   * The orders among `review` listed because no settlement leg ever credited
   * the attributed vendor's earnings. With FF_CARD_ORDER_LEDGER_V1 off that
   * is every order, which the log says once instead of once per order.
   */
  never_settled: string[]
}

async function readOrderTotals(
  container: MedusaContainer,
  orderId: string
): Promise<MajorUnitOrderTotals | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // The same fields the subscriber reads; asking for a total makes Medusa's
  // order module load what it needs to compute it.
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "subtotal", "total", "currency_code"],
    filters: { id: orderId },
  })
  const row = (data as Array<Record<string, unknown>>)[0]
  if (!row) return null
  return { subtotal: row.subtotal, total: row.total, currency_code: (row.currency_code as string) ?? null }
}

/**
 * What the order's payment records say was refunded for it, read the way the
 * ledger's own settlement reads them, so the gate and the ledger cannot
 * disagree about which order a collection's money belongs to. Null with the
 * reason when the read returns nothing (no such order, or no totals) or
 * throws: the gate lists an order it could not read.
 */
async function readOrderPayment(
  container: MedusaContainer,
  orderId: string
): Promise<{ payment: OrderPaymentSide | null; unread: string | null }> {
  try {
    const paid = await readCardSettlementOrder(container, orderId)
    if (!paid) return { payment: null, unread: "no order, or no order totals, were found" }
    return {
      payment: {
        funding: paid.funding,
        payment_collection_ids: paid.payment_collection_ids,
        captured: paid.captured,
        refunded: paid.refunded,
        unattributed_refund: paid.unattributed_refund,
        dispute_open: paid.dispute_open,
      },
      unread: null,
    }
  } catch (error) {
    return { payment: null, unread: `the read failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Who approve-held would debit for this order, whether and when the order's
 * proceeds reached them, whether the order was refunded (by the ledger and
 * by its payment records, and which payment collections of the order's
 * those records were read from), whether a commission credit for any of its
 * rows (`attributionIds`) is already in the ledger, and whether they have
 * been paid, or their earnings debited by any other leg, since it was
 * placed (`reviewVendorDebit`).
 * `placedAtFallback` is the L1 row's `created_at`: the subscriber writes it
 * at `order.placed`. `now` is when this is read; the answer speaks for that
 * moment only.
 */
async function readVendorDebitContext(
  container: MedusaContainer,
  orderId: string,
  vendorIds: readonly string[],
  attributionIds: readonly string[],
  placedAtFallback: Date | string | undefined,
  now: Date
): Promise<VendorDebitContext> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    // `payment_collections.id`: every collection linked to the order, to set
    // against the ones its payment records were read from.
    fields: ["id", "created_at", "seller.id", "payouts.id", "payment_collections.id"],
    filters: { id: orderId },
  })
  const row = (data as Array<{
    created_at?: Date | string | null
    seller?: { id?: string | null } | null
    payouts?: Array<{ id?: string | null } | null> | null
    payment_collections?: Array<{ id?: string | null } | null> | null
  }>)[0]
  const placed = row?.created_at ?? placedAtFallback ?? null
  const since = placed ? new Date(placed) : null
  const placedAt = since && !Number.isNaN(since.getTime()) ? since : null

  const hawala = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  // The order's settlement legs that moved money or were reversed after
  // they had, whoever they credited.
  const settlementLegs = await hawala.listLedgerEntries({
    idempotency_key: orderSettlementLegKeys(orderId),
    status: [...SETTLEMENT_LEG_STATUSES],
  })
  // Every refund leg of the order that moved money, whoever it debited: a
  // card refund posts them through `payment.refunded` and leaves the
  // attribution held. Only the refunds the ledger has posted; the payment
  // records below are what say whether the order was refunded.
  const refundLegs = await hawala.listLedgerEntries({
    order_id: orderId,
    entry_type: "REFUND",
    status: [...MOVED_ENTRY_STATUSES],
  })
  // Whatever already sits under the key approve-held credits each of the
  // order's rows with. No status is asked for and no account: the key alone
  // decides what the job is handed back.
  const rowByCommissionKey = new Map(attributionIds.map((id) => [commissionCreditKey(id), id]))
  const commissionEntries = rowByCommissionKey.size
    ? await hawala.listLedgerEntries({ idempotency_key: [...rowByCommissionKey.keys()] })
    : []
  // The legs the order is listed for under a reason of their own. Left out
  // of the read of every debit BY ID, so nothing is left out by a label.
  const listedByOwnReason = [...refundLegs, ...commissionEntries].map((e) => e.id)
  const paymentSide = await readOrderPayment(container, orderId)

  const order_settled_to_vendor: Record<string, boolean> = {}
  const order_settled_at: Record<string, string | null> = {}
  const order_settlement_reversed: Record<string, boolean> = {}
  const vendorByEarningsAccount = new Map<string, string>()
  const vendor_withdrawals: Record<string, Array<{ id: string; kind: string; status: string }>> = {}
  const vendor_other_debits: Record<string, Array<{ id: string; kind: string; status: string }>> = {}
  const vendor_unconfirmed_debits: Record<string, Array<{ id: string; kind: string; status: string }>> = {}
  for (const vendorId of vendorIds) {
    const accounts = await hawala.listLedgerAccounts({ owner_id: vendorId, account_type: "SELLER_EARNINGS" })
    for (const account of accounts) vendorByEarningsAccount.set(account.id, vendorId)
    const credited = settlementLegs.filter((e) => accounts.some((a) => a.id === e.credit_account_id))
    const moved = credited.filter((e) => movedMoney(e.status))
    order_settled_to_vendor[vendorId] = moved.length > 0
    order_settled_at[vendorId] = latestCreatedAt(moved)
    order_settlement_reversed[vendorId] = moved.length === 0 && credited.length > 0
    if (!placedAt) continue

    const requests = await hawala.listPayoutRequests(
      { vendor_id: vendorId, status: [...PAID_OUT_STATUSES], created_at: { $gte: placedAt } },
      { take: 5, order: { created_at: "ASC" } }
    )
    // Every leg that debits the vendor's earnings, written since the order
    // was placed. No entry type and no status is asked for (see WHICH DEBITS
    // OF A VENDOR'S EARNINGS COUNT above).
    const debits = accounts.length
      ? await hawala.listLedgerEntries(
          {
            debit_account_id: accounts.map((a) => a.id),
            ...(listedByOwnReason.length ? { id: { $nin: listedByOwnReason } } : {}),
            created_at: { $gte: placedAt },
          },
          { take: DEBITS_READ, order: { created_at: "ASC" } }
        )
      : []
    const named = debits.map((e) => ({
      moved: movedMoney(e.status),
      paidOut: (OUTFLOW_ENTRY_TYPES as readonly string[]).includes(String(e.entry_type)),
      leg: { id: e.id, kind: debitKind(e), status: String(e.status) },
    }))
    vendor_withdrawals[vendorId] = [
      ...requests.map((r) => ({ id: r.id, kind: "payout request", status: String(r.status) })),
      ...named.filter((d) => d.moved && d.paidOut).map((d) => d.leg),
    ]
    vendor_other_debits[vendorId] = named.filter((d) => d.moved && !d.paidOut).map((d) => d.leg)
    // Not COMPLETED and not SETTLED: the ledger does not say this money
    // stayed where it was.
    vendor_unconfirmed_debits[vendorId] = named.filter((d) => !d.moved).map((d) => d.leg)
  }

  // Every payment collection linked to the order. Null (which lists the
  // order) when the order was not found or the read answered with something
  // that is not a list; a found order with nothing there has none linked.
  const linked: unknown = row ? (row.payment_collections ?? []) : null
  const linkedCollections = Array.isArray(linked)
    ? [...new Set(linked.map((c: { id?: unknown } | null) => c?.id).filter((id): id is string => typeof id === "string" && !!id))]
    : null

  return {
    order_seller_id: row?.seller?.id ?? null,
    order_placed_at: placedAt ? placedAt.toISOString() : null,
    checked_at: now.toISOString(),
    order_payout_ids: (row?.payouts ?? []).map((p) => p?.id).filter((id): id is string => !!id),
    order_settled_to_vendor,
    order_settled_at,
    order_settlement_reversed,
    order_refunds: refundLegs.map((e) => ({
      id: e.id,
      status: String(e.status),
      amount: Number(e.amount),
      from_vendor_id: vendorByEarningsAccount.get(e.debit_account_id) ?? null,
    })),
    order_payment: paymentSide.payment,
    order_payment_unread: paymentSide.unread,
    order_payment_collection_ids: linkedCollections,
    order_commission_entries: commissionEntries.map((e) => ({
      id: e.id,
      attribution_id: rowByCommissionKey.get(String(e.idempotency_key)) ?? String(e.idempotency_key),
      status: String(e.status),
      amount: Number(e.amount),
      moved: movedMoney(e.status),
      from_vendor_id: vendorByEarningsAccount.get(e.debit_account_id) ?? null,
    })),
    vendor_withdrawals,
    vendor_other_debits,
    vendor_unconfirmed_debits,
  }
}

/**
 * The correction itself. Writes only with `apply: true`, like the CLI: left
 * out, it reports what it would do and writes nothing. `now` is the moment
 * the vendor checks are made at (an order's age is measured from it); the
 * CLI never passes it, specs do to age an order.
 */
export async function fixCreatorCommissionMinorUnits(
  container: MedusaContainer,
  opts: { apply?: boolean; now?: Date } = {}
): Promise<CommissionMinorUnitFixSummary> {
  const service = container.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const summary: CommissionMinorUnitFixSummary = { corrected: [], skipped: [], review: [], never_settled: [] }

  // One L1 row per order (unique on order_id, level), so paging level-1 rows
  // pages orders; each order's whole chain is then read together. `id` breaks
  // ties so rows sharing a `created_at` are not skipped or repeated at a page
  // edge.
  for (let skip = 0; ; skip += PAGE) {
    const heads = (await service.listOrderAttributions(
      { level: 1 },
      { order: { created_at: "ASC", id: "ASC" }, skip, take: PAGE }
    )) as unknown as Row[]
    if (!heads.length) break

    for (const head of heads) {
      const orderId = head.order_id
      const rows = (await service.listOrderAttributions({ order_id: orderId })) as unknown as Row[]
      const order = await readOrderTotals(container, orderId)
      const plan = planCommissionMinorUnitCorrection(rows, order)

      if (plan.action === "skip") {
        summary.skipped.push({ order_id: orderId, reason: plan.reason })
        continue
      }
      if (plan.action === "review") {
        summary.review.push({ order_id: orderId, reason: plan.reason })
        continue
      }

      // Who approve-held would debit for the rows it will still credit,
      // and whether anything readable now already argues against that debit.
      const debited = vendorsDebitedOnApproval(rows)
      if (debited.length) {
        const ctx = await readVendorDebitContext(
          container,
          orderId,
          debited,
          rows.map((r) => r.id),
          head.created_at,
          opts.now ?? new Date()
        )
        const reason = reviewVendorDebit(plan, rows, ctx)
        if (reason) {
          summary.review.push({ order_id: orderId, reason })
          if (debited.some((v) => ctx.order_settled_to_vendor[v] !== true && ctx.order_settlement_reversed[v] !== true)) {
            summary.never_settled.push(orderId)
          }
          continue
        }
      }

      if (opts.apply === true) {
        const at = new Date().toISOString()
        const result = await service.correctAttributionAmountsIfUnchanged(
          plan.rows.map((fix) => ({
            id: fix.id,
            status: fix.status,
            from: { subtotal_cents: plan.subtotal.from, commission_cents: fix.commission.from },
            to: { subtotal_cents: plan.subtotal.to, commission_cents: fix.commission.to },
            record: {
              at,
              by: ACTOR_ID,
              attributed_subtotal_cents: plan.subtotal,
              commission_basis_cents: plan.subtotal,
              commission_amount_cents: fix.commission,
            },
          }))
        )
        if (!result.written) {
          const planned = plan.rows.find((r) => r.id === result.stale_id)
          summary.review.push({
            order_id: orderId,
            reason:
              `row ${result.stale_id} changed since it was read (planned from ${planned?.status ?? "?"}); ` +
              `none of the order's rows were written`,
          })
          continue
        }
      }

      summary.corrected.push({
        order_id: orderId,
        subtotal: plan.subtotal,
        commission_total: plan.commission_total,
        rows: plan.rows.map((r) => r.id),
      })
    }

    if (heads.length < PAGE) break
  }

  return summary
}

export default async function run({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const tag = "[fix-creator-commission-minor-units]"
  const parsed = parseScriptArgs(args, APPLY_OR_DRY_RUN)
  if (!parsed.ok) {
    // Thrown, so `medusa exec` exits non-zero: nothing was looked at.
    logger.error(`${tag} refused: ${parsed.message}`)
    throw new Error(`fix-creator-commission-minor-units refused: ${parsed.message}`)
  }
  const apply = parsed.flags.has("apply")
  const summary = await fixCreatorCommissionMinorUnits(container, { apply })

  logger.info(
    `${tag}${apply ? "" : " (dry run: nothing written; add `apply` to write)"} ` +
      `corrected=${summary.corrected.length} skipped=${summary.skipped.length} review=${summary.review.length}`
  )
  if (summary.corrected.length) {
    logger.warn(
      `${tag} ${apply ? "Corrected" : "Correcting"} held or pending rows raises what the approve-held job will debit ` +
        `from each vendor's current SELLER_EARNINGS to the full commission once commission crediting works ` +
        `(today every credit is refused: SD-99 in docs/AUDIT_DEBT.md). Orders whose vendor is not the order's seller, ` +
        `whose proceeds are not in the vendor's earnings in the ledger, which have a refund leg in the ledger, whose ` +
        `payment records (the order's split payment row, its payment collection, Stripe's figures for the charge) show ` +
        `a refund for the order, a refund on its payment collection recorded on no order, or an open card dispute, ` +
        `whose payment records could not be read, are not a card payment's, or were not read from every payment ` +
        `collection linked to the order, whose vendor was paid out after the order or had their earnings debited by ` +
        `any other ledger leg since (whatever its entry type and whatever its status: a leg labelled as a creator ` +
        `commission and a leg still PENDING count), which already have a ledger entry under the key approve-held credits ` +
        `one of their rows with, whose proceeds Mercur paid out, or which were placed or settled in the last 2 days are ` +
        `listed for review instead.`
    )
    logger.warn(
      `${tag} Those checks were made once, just now. Nothing repeats them when approve-held debits the vendor: ` +
        `a vendor paid out after this run, or whose order is refunded after it, is still debited the full commission. ` +
        `A refund made in Stripe's dashboard is seen only once Stripe's webhook has recorded it here, and a refund ` +
        `that is owed but not yet made (a return received, an order dispute decided for the buyer) is not seen at all. ` +
        `Run this with \`apply\` immediately before the repair that makes commission crediting work deploys, not earlier, ` +
        `and not in the minute approve-held runs (:00).`
    )
  }
  if (summary.never_settled.length) {
    // Said once, whether or not anything was corrected: under the default
    // flags this is every order that names a vendor.
    logger.warn(
      `${tag} ${summary.never_settled.length} of the ${summary.review.length} orders listed for review have proceeds that ` +
        `never reached the attributed vendor's earnings in the ledger. With FF_CARD_ORDER_LEDGER_V1 off (the default) ` +
        `no order settles to the ledger, so that is every held or pending row that names a vendor, and none of them is corrected.`
    )
  }
  for (const c of summary.corrected) {
    logger.info(
      `${tag} ${apply ? "corrected" : "would correct"} order ${c.order_id}: subtotal ${c.subtotal.from} → ${c.subtotal.to}, ` +
        `commission ${c.commission_total.from} → ${c.commission_total.to} (rows ${c.rows.join(", ")})`
    )
  }
  for (const s of summary.skipped) {
    logger.info(`${tag} skipped order ${s.order_id}: ${s.reason}`)
  }
  for (const r of summary.review) {
    logger.warn(`${tag} review order ${r.order_id}: ${r.reason}`)
  }
}
