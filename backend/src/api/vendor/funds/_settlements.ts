import type { MedusaRequest } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../modules/hawala-ledger/service"
import type {
  SettlementVerifier,
  VerifiedSettlement,
} from "../../../modules/fund-accounting/service"
import { resolveVendorSellerId } from "../hawala/seller-context"

/**
 * The hawala side of "a fund spend must cite a settlement".
 *
 * A settlement, for a fund, is a `hawala_ledger_entry` debited from one of the
 * seller's own accounts whose money has actually moved. Composed here at the
 * route layer, not inside fund-accounting, so that module never resolves the
 * ledger and the two stay independently adoptable.
 *
 * Two things this file has to get right that are easy to get wrong:
 *
 * - Hawala accounts are keyed by the `sel_*` seller id, but the vendor guard
 *   rewrites `auth_context.actor_id` to `mem_*` (see `hawala/seller-context.ts`
 *   for the routes that broke on this). The lookup therefore goes through
 *   `resolveVendorSellerId`, never `getSellerId`.
 * - Hawala stores `amount` in major units (its own callers pass `amountCents /
 *   100`); fund-accounting is integer cents. The conversion happens once, here.
 */

/** Statuses under which the money has actually left the account. */
const MOVED_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "SETTLED"])

export interface SellerSettlement extends VerifiedSettlement {
  entry_type: string
  status: string
  description: string | null
  occurred_at: Date | null
  reference_type: string | null
  reference_id: string | null
}

/** The fields of a hawala ledger entry this file reads. */
interface LedgerEntryLike {
  id: string
  amount: unknown
  currency_code?: string | null
  status: string
  entry_type: string
  description?: string | null
  settled_at?: Date | null
  created_at?: Date | null
  reference_type?: string | null
  reference_id?: string | null
  debit_account_id: string
}

function toCents(majorUnits: unknown): number {
  const n = Number(majorUnits)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function toSettlement(entry: LedgerEntryLike): SellerSettlement {
  return {
    id: entry.id,
    amount_cents: toCents(entry.amount),
    currency_code: entry.currency_code ?? "USD",
    settled: MOVED_STATUSES.has(entry.status),
    entry_type: entry.entry_type,
    status: entry.status,
    description: entry.description ?? null,
    occurred_at: entry.settled_at ?? entry.created_at ?? null,
    reference_type: entry.reference_type ?? null,
    reference_id: entry.reference_id ?? null,
  }
}

/** Ids of every ledger account the seller owns. Empty when none exist yet. */
async function sellerAccountIds(
  req: MedusaRequest
): Promise<{ sellerId: string | null; ids: string[] }> {
  const sellerId = (await resolveVendorSellerId(req)) ?? null
  if (!sellerId) return { sellerId: null, ids: [] }

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const accounts = await hawala.listLedgerAccounts({
    owner_type: "SELLER",
    owner_id: sellerId,
  })
  return { sellerId, ids: accounts.map((a: { id: string }) => a.id) }
}

/**
 * Builds the verifier `recordEntry` needs. Null for an unknown id and for an
 * entry debited from someone else's account alike, so an expenditure can never
 * confirm the existence of another seller's ledger rows.
 */
export async function makeSettlementVerifier(
  req: MedusaRequest
): Promise<SettlementVerifier> {
  const { ids } = await sellerAccountIds(req)
  const owned = new Set(ids)
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  return async (referenceId: string) => {
    if (owned.size === 0) return null
    const entry = (await hawala
      .retrieveLedgerEntry(referenceId)
      .catch(() => null)) as LedgerEntryLike | null
    if (!entry || !owned.has(entry.debit_account_id)) return null
    return toSettlement(entry)
  }
}

/** The seller's settlements — outflows whose money has moved — newest first. */
export async function listSellerSettlements(
  req: MedusaRequest
): Promise<SellerSettlement[]> {
  const { ids } = await sellerAccountIds(req)
  if (ids.length === 0) return []

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const entries = (await hawala.listLedgerEntries(
    { debit_account_id: ids, status: [...MOVED_STATUSES] },
    { order: { created_at: "DESC" } }
  )) as LedgerEntryLike[]
  return entries.map(toSettlement)
}
