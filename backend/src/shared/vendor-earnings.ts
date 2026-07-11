import type { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"

/**
 * Read-side helpers over a seller's hawala-ledger earnings account, shared by
 * the vendor-portal dashboard/payout aggregates.
 *
 * Ledger amounts are stored in DOLLARS (see `centsToDollars` in
 * `subscribers/hawala-order-payment.ts`); portal contracts are in cents, so
 * conversion happens here in one place.
 *
 * Everything is best-effort and read-only: a seller with no sales has no
 * SELLER_EARNINGS account yet, and these endpoints must not create one (or
 * 500) just because someone opened a dashboard — absent data returns [].
 */

export interface SellerLedgerEntry {
  id: string
  /** Signed amount in dollars: positive = credit to the seller. */
  signed_amount: number
  direction: "DEBIT" | "CREDIT"
  entry_type: string
  description?: string | null
  created_at: string | Date
}

export async function getSellerLedgerEntries(
  container: MedusaContainer,
  sellerId: string,
  limit = 1000
): Promise<SellerLedgerEntry[]> {
  try {
    const hawala = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    const accounts = await hawala.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })
    if (!accounts.length) return []
    return (await hawala.getTransactionHistory(accounts[0].id, {
      limit,
    })) as SellerLedgerEntry[]
  } catch {
    return []
  }
}

/** Dollars → integer cents. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/**
 * Gross sale revenue (PURCHASE credits) in cents within [since, until).
 * Omit bounds for all-time.
 */
export function purchaseRevenueCents(
  entries: SellerLedgerEntry[],
  since?: Date,
  until?: Date
): number {
  let dollars = 0
  for (const e of entries) {
    if (e.direction !== "CREDIT" || e.entry_type !== "PURCHASE") continue
    const at = new Date(e.created_at).getTime()
    if (since && at < since.getTime()) continue
    if (until && at >= until.getTime()) continue
    dollars += Number(e.signed_amount)
  }
  return toCents(dollars)
}

/** First day of the current calendar month (local server time). */
export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/** First day of the current calendar year (local server time). */
export function startOfYear(now = new Date()): Date {
  return new Date(now.getFullYear(), 0, 1)
}
