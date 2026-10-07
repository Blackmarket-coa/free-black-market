import { createLogger } from "../shared/logger"
const log = createLogger("lib/ledger-connect-payouts")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PAYOUT_MODULE } from "@mercurjs/b2c-core/modules/payout"
import { PayoutAccountStatus } from "@mercurjs/framework"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { toCents } from "./card-order-settlement"

/**
 * Vendors paid from the hawala ledger through Stripe Connect (SD-41; operator
 * decision 2026-10-06 "FBM ledger drives Connect"; FF_LEDGER_CONNECT_PAYOUTS_V1).
 *
 * Before this, the only code that sent a vendor money was @mercurjs/b2c-core's
 * nightly `daily-payouts` job: per order, `captured - refunded - Mercur
 * commission` to the seller's Connect account, reading nothing FBM records —
 * no payout hold, no refund or card-processing receivable, no FBM fee split.
 * FBM's own `requestPayout` recorded a request that nothing ever sent.
 * `jobs/daily-payouts.ts` replaces Mercur's job under the same name; with the
 * flag on it runs this, once a night:
 *
 *   1. Who can be paid: every seller with an ACTIVE Mercur payout account
 *      (onboarded from the vendor panel's Stripe Connect page) whose Stripe
 *      account, as Mercur last synced it, is a US account paying out in USD.
 *      Vendor payout terminates at a US bank account
 *      (docs/POSTURE_A_COMPLIANCE.md rule 4); anything else is not paid and
 *      is reported.
 *   2. Cut-over: an order Mercur already paid out (its `order_payout` link)
 *      whose credit is still in the seller's ledger earnings is booked out of
 *      them — SELLER_EARNINGS -> SETTLEMENT, `leg: mercur_paid_order`, keyed
 *      on the order — for the smaller of what Mercur paid and what the ledger
 *      credited, so it is not paid a second time. A seller whose earnings
 *      cannot cover that is not paid this run (needs a person).
 *   3. Schedule: a held seller (SD-40) is skipped. Otherwise what
 *      `getPayoutOptions` says is payable — the balance after card
 *      processing and refunds owed — at or above CONNECT_PAYOUT_MIN_CENTS is
 *      requested through `requestPayout` (which recovers what is owed first,
 *      refuses a held seller again, and moves SELLER_EARNINGS -> SETTLEMENT).
 *   4. Send: every PROCESSING payout request — this run's and any a vendor
 *      requested from the panel — whose seller can be paid and is not held
 *      is claimed (PROCESSING -> IN_TRANSIT, exactly one sender wins), sent as
 *      one Connect transfer through Mercur's payout module (`createPayout`:
 *      Mercur's Stripe client, idempotency key `fbm-payout-<request id>`,
 *      recorded in Mercur's `payout` table), and marked COMPLETED with the
 *      transfer id. A refused transfer moved nothing: the request is FAILED
 *      and its legs are put back on the ledger. A request left IN_TRANSIT (a
 *      sender that died after the claim) may have moved money and is never
 *      re-sent automatically; it is reported for a person.
 *
 * Never throws; every seller and request is independent, and the summary
 * says what happened to each.
 */

export const CONNECT_PAYOUT_MIN_CENTS = 100
/** Stamped on every payout request this sends (`metadata.rail`). */
export const CONNECT_PAYOUT_RAIL = "stripe_connect"
export const MERCUR_PAID_ORDER_LEG = "mercur_paid_order"

type Container = { resolve: (key: string) => unknown }

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters?: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}

export type PayableAccount = {
  seller_id: string
  payout_account_id: string
  /** Why the seller cannot be paid; null when they can. */
  refusal: null | "not_active" | "not_us_usd"
}

export type ConnectTransfer = (args: {
  payout_account_id: string
  amount: number
  currency_code: string
  transaction_id: string
}) => Promise<{ payout_id: string | null; transfer_id: string | null }>

export type LedgerConnectPayoutSummary = {
  /** Another run held the lock; nothing was done. */
  skipped: boolean
  sellers: number
  refused_accounts: Array<{ seller_id: string; refusal: string }>
  held: string[]
  booked_mercur_paid: number
  cutover_blocked: string[]
  requested: Array<{ seller_id: string; payout_request_id: string; amount: number }>
  sent: Array<{ payout_request_id: string; transfer_id: string | null }>
  failed: Array<{ payout_request_id: string; reason: string }>
  waiting: Array<{ payout_request_id: string; why: string }>
  stuck_in_transit: string[]
}

/** Mercur's payout module: the Connect transfer, recorded in its own table. */
export function mercurConnectTransfer(container: Container): ConnectTransfer {
  return async (args) => {
    const payouts = container.resolve(PAYOUT_MODULE) as {
      createPayout: (input: {
        amount: number
        currency_code: string
        account_id: string
        transaction_id: string
      }) => Promise<{ id?: string; data?: { id?: string } | null }>
    }
    const payout = await payouts.createPayout({
      amount: args.amount,
      currency_code: args.currency_code,
      account_id: args.payout_account_id,
      transaction_id: args.transaction_id,
    })
    return { payout_id: payout?.id ?? null, transfer_id: payout?.data?.id ?? null }
  }
}

/** Every seller with a Mercur payout account, and whether they can be paid. */
export async function payableAccounts(container: Container): Promise<Map<string, PayableAccount>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const { data } = await query.graph({
    entity: "seller",
    fields: ["id", "payout_account.id", "payout_account.status", "payout_account.data"],
  })
  const out = new Map<string, PayableAccount>()
  for (const row of data as Array<Record<string, unknown>>) {
    const account = row.payout_account as
      | { id?: string; status?: string; data?: { country?: unknown; default_currency?: unknown } | null }
      | null
      | undefined
    if (!account?.id) continue
    const stripe = account.data ?? {}
    const us =
      String(stripe.country ?? "").toUpperCase() === "US" &&
      String(stripe.default_currency ?? "").toLowerCase() === "usd"
    out.set(String(row.id), {
      seller_id: String(row.id),
      payout_account_id: account.id,
      refusal: account.status !== PayoutAccountStatus.ACTIVE ? "not_active" : us ? null : "not_us_usd",
    })
  }
  return out
}

/**
 * Book out of a seller's earnings every order Mercur already paid (step 2).
 * Returns false when the earnings cannot cover it: the seller is then not
 * paid this run, so nothing is paid twice.
 */
export async function bookMercurPaidOrders(
  container: Container,
  hawala: HawalaLedgerModuleService,
  sellerId: string
): Promise<{ ok: boolean; booked: number }> {
  const [earnings] = await hawala.listLedgerAccounts({
    owner_type: "SELLER",
    owner_id: sellerId,
    account_type: "SELLER_EARNINGS",
  })
  if (!earnings) return { ok: true, booked: 0 }
  const credits = (
    await hawala.listLedgerEntries({ credit_account_id: earnings.id, entry_type: "TRANSFER", status: "COMPLETED" })
  ).filter((e) => typeof e.order_id === "string" && e.order_id.length > 0)
  if (credits.length === 0) return { ok: true, booked: 0 }
  const creditCentsByOrder = new Map<string, number>()
  for (const c of credits) {
    const id = c.order_id as string
    creditCentsByOrder.set(id, (creditCentsByOrder.get(id) ?? 0) + toCents(Number(c.amount)))
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "payouts.id", "payouts.amount"],
    filters: { id: [...creditCentsByOrder.keys()] },
  })
  const settlement = await hawala.getOrCreateSystemAccount("SETTLEMENT")
  let booked = 0
  for (const row of data as Array<{ id: string; payouts?: Array<{ id?: string; amount?: unknown } | null> | null }>) {
    const payouts = (row.payouts ?? []).filter((p): p is { id?: string; amount?: unknown } => !!p)
    if (payouts.length === 0) continue
    const key = `mercur-paid-${row.id}`
    const [already] = await hawala.listLedgerEntries({ idempotency_key: key })
    if (already && already.status === "COMPLETED") continue
    const paidCents = payouts.reduce((sum, p) => sum + toCents(Number(p.amount ?? 0)), 0)
    const cents = Math.min(paidCents, creditCentsByOrder.get(row.id) ?? 0)
    if (cents <= 0) continue
    try {
      await hawala.createTransfer({
        debit_account_id: earnings.id,
        credit_account_id: settlement.id,
        amount: cents / 100,
        entry_type: "WITHDRAWAL",
        reference_type: "PAYOUT",
        reference_id: payouts[0].id,
        idempotency_key: key,
        description: `Order ${row.id} was already paid out to your Stripe account`,
        metadata: {
          leg: MERCUR_PAID_ORDER_LEG,
          paid_order_id: row.id,
          mercur_payout_ids: payouts.map((p) => p.id ?? null),
          mercur_paid_cents: paidCents,
        },
      })
      booked++
    } catch (error) {
      log.error(
        `[ledger-connect-payouts] Seller ${sellerId}: order ${row.id} was paid by Mercur's payout but ` +
          `${cents / 100} cannot be booked out of their earnings (${(error as Error)?.message ?? error}); ` +
          `not paid this run — needs a person`
      )
      return { ok: false, booked }
    }
  }
  return { ok: true, booked }
}

type PgLike = {
  transaction?: <T>(work: (trx: { raw: (sql: string, b?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
}

/**
 * Run one night's ledger-driven payouts, one run at a time: a run that finds
 * another already in progress (a second instance, an overlapping retry)
 * returns `skipped: true` and touches nothing. Transaction-scoped advisory
 * try-lock, held for the run on its own connection and released at commit
 * or rollback; nothing is written through that transaction.
 */
export async function runLedgerConnectPayouts(
  container: Container,
  opts: { sendTransfer?: ConnectTransfer } = {}
): Promise<LedgerConnectPayoutSummary> {
  let pg: PgLike | undefined
  try {
    pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgLike
  } catch {
    pg = undefined
  }
  if (!pg || typeof pg.transaction !== "function") return runLocked(container, opts)
  return pg.transaction(async (trx) => {
    const result = (await trx.raw("SELECT pg_try_advisory_xact_lock(hashtext(?)) AS locked", [
      "hawala-ledger-connect-payouts",
    ])) as { rows?: Array<{ locked?: boolean }> }
    if (!result?.rows?.[0]?.locked) {
      log.info("[ledger-connect-payouts] another run is in progress; this one does nothing")
      return { ...emptySummary(), skipped: true }
    }
    return runLocked(container, opts)
  })
}

function emptySummary(): LedgerConnectPayoutSummary {
  return {
    skipped: false,
    sellers: 0,
    refused_accounts: [],
    held: [],
    booked_mercur_paid: 0,
    cutover_blocked: [],
    requested: [],
    sent: [],
    failed: [],
    waiting: [],
    stuck_in_transit: [],
  }
}

async function runLocked(
  container: Container,
  opts: { sendTransfer?: ConnectTransfer }
): Promise<LedgerConnectPayoutSummary> {
  const summary = emptySummary()
  const hawala = container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService
  const send = opts.sendTransfer ?? mercurConnectTransfer(container)

  let accounts: Map<string, PayableAccount>
  try {
    accounts = await payableAccounts(container)
  } catch (error) {
    log.error("[ledger-connect-payouts] Could not read payout accounts; nothing paid:", error)
    return summary
  }
  summary.sellers = accounts.size
  const blocked = new Set<string>()

  // Steps 1-3, per seller.
  for (const account of accounts.values()) {
    if (account.refusal) {
      summary.refused_accounts.push({ seller_id: account.seller_id, refusal: account.refusal })
      continue
    }
    try {
      const [earnings] = await hawala.listLedgerAccounts({
        owner_type: "SELLER",
        owner_id: account.seller_id,
        account_type: "SELLER_EARNINGS",
      })
      if (!earnings) continue // nothing ever credited: nothing to pay
      const cutover = await bookMercurPaidOrders(container, hawala, account.seller_id)
      summary.booked_mercur_paid += cutover.booked
      if (!cutover.ok) {
        summary.cutover_blocked.push(account.seller_id)
        blocked.add(account.seller_id)
        continue
      }
      if ((await hawala.listActivePayoutHolds(account.seller_id)).length > 0) {
        summary.held.push(account.seller_id)
        continue
      }
      const options = await hawala.getPayoutOptions(account.seller_id)
      const payableCents = Math.floor(Number(options.payable_balance ?? 0) * 100 + 1e-6)
      if (payableCents < CONNECT_PAYOUT_MIN_CENTS) continue
      const request = await hawala.requestPayout({
        vendor_id: account.seller_id,
        amount: payableCents / 100,
        payout_tier: "WEEKLY",
        metadata: { rail: CONNECT_PAYOUT_RAIL, scheduled_by: "daily-payouts", payout_account_id: account.payout_account_id },
      })
      summary.requested.push({ seller_id: account.seller_id, payout_request_id: request.id, amount: payableCents / 100 })
    } catch (error) {
      log.error(`[ledger-connect-payouts] Seller ${account.seller_id}: payout not requested:`, error)
    }
  }

  // Step 4: send what is PROCESSING; report what is stuck IN_TRANSIT.
  const pending = await hawala.listPayoutRequests({ status: "PROCESSING" }, { order: { requested_at: "ASC" } })
  for (const request of pending) {
    const account = accounts.get(request.vendor_id)
    if (!account || account.refusal) {
      summary.waiting.push({ payout_request_id: request.id, why: account?.refusal ?? "no_payout_account" })
      continue
    }
    if (blocked.has(request.vendor_id)) {
      summary.waiting.push({ payout_request_id: request.id, why: "cutover_blocked" })
      continue
    }
    if ((await hawala.listActivePayoutHolds(request.vendor_id)).length > 0) {
      summary.waiting.push({ payout_request_id: request.id, why: "held" })
      continue
    }
    if (!(await hawala.claimPayoutRequestForSending(request.id))) continue
    let sent: { payout_id: string | null; transfer_id: string | null }
    try {
      sent = await send({
        payout_account_id: account.payout_account_id,
        amount: Number(request.net_amount),
        currency_code: "usd",
        transaction_id: `fbm-payout-${request.id}`,
      })
    } catch (error) {
      const reason = (error as Error)?.message ?? String(error)
      try {
        await hawala.failPayoutRequest(request.id, `Stripe refused the transfer: ${reason}`)
        summary.failed.push({ payout_request_id: request.id, reason })
      } catch (reverseError) {
        // Left IN_TRANSIT: reported below as stuck, for a person.
        log.error(
          `[ledger-connect-payouts] Payout request ${request.id}: transfer refused (${reason}) and the ledger legs ` +
            `could not be put back:`,
          reverseError
        )
      }
      continue
    }
    try {
      await hawala.completePayoutRequest(request.id, {
        stripe_transfer_id: sent.transfer_id,
        metadata: { rail: CONNECT_PAYOUT_RAIL, mercur_payout_id: sent.payout_id },
      })
      summary.sent.push({ payout_request_id: request.id, transfer_id: sent.transfer_id })
    } catch (error) {
      // The money moved; only the record did not. Left IN_TRANSIT, reported.
      log.error(
        `[ledger-connect-payouts] Payout request ${request.id}: transfer ${sent.transfer_id} went out but the ` +
          `request could not be marked COMPLETED:`,
        error
      )
    }
  }
  const inTransit = await hawala.listPayoutRequests({ status: "IN_TRANSIT" })
  summary.stuck_in_transit = inTransit.map((r) => r.id)
  if (summary.stuck_in_transit.length > 0) {
    log.error(
      `[ledger-connect-payouts] ${summary.stuck_in_transit.length} payout request(s) IN_TRANSIT ` +
        `(${summary.stuck_in_transit.join(", ")}): a transfer may have gone out; check Stripe for transfers whose ` +
        `metadata.transaction_id is fbm-payout-<id> before doing anything — never re-sent automatically`
    )
  }
  return summary
}

/**
 * True once the ledger rail has sent (or claimed for sending) any payout:
 * Mercur's job would then pay orders the ledger already paid, so
 * `jobs/daily-payouts.ts` refuses to hand back to it. Only this rail ever
 * moves a request to IN_TRANSIT, and it stamps `rail` on every request it
 * completes.
 */
export async function ledgerRailHasSent(hawala: HawalaLedgerModuleService): Promise<boolean> {
  const rows = await hawala.listPayoutRequests({ status: ["IN_TRANSIT", "COMPLETED"] }, { take: 500 })
  return rows.some(
    (r) => r.status === "IN_TRANSIT" || (r.metadata as { rail?: unknown } | null)?.rail === CONNECT_PAYOUT_RAIL
  )
}
