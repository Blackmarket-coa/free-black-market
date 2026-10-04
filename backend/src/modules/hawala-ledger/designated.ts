/**
 * Designated legacy pool funds (Posture A, Phase 1b slice S15).
 *
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 8 (operator, 2026-10-04): "Ledger
 * money should be in designated accounts." Legal checkpoints L26 (gates
 * go-live), L3 (securities; already gated) — surfaced, not resolved.
 *
 * THE READING (an assumption, recorded for the operator to correct): ledger
 * dollars already inside an UNCARRIED pool when FF_NONPROFIT_PARITY_V1 turns
 * on stay segregated in that pool's existing PRODUCER_POOL account — already
 * one account per pool, already apart from PLATFORM / RESERVE — which becomes
 * a DESIGNATED account:
 *
 *   - money IN is refused (`no_carrier`, S12's rule, unchanged);
 *   - money OUT is allowed only back to the contributors — the wallet of an
 *     investor holding a LEDGER investment in THAT pool
 *     (`returnDesignatedFunds`, dividends) or the system order escrow (the
 *     order refund reversal in `processRefund`) — and, once such a leg has
 *     COMPLETED, stamps `legacy_funds_designated_at` on the pool the first
 *     time;
 *   - money OUT to SELLER_EARNINGS (the producer cashing out investors'
 *     money through the vendor withdraw route), to a stranger's wallet, to a
 *     per-entity escrow (subcontract / campaign / sponsorship — each releases
 *     into SELLER_EARNINGS, a two-hop route) or to any other account is
 *     refused `designated_outbound_only`;
 *   - a ZERO-balance uncarried pool account has no legacy funds to designate
 *     and stays refused both ways (`no_carrier`);
 *   - a CARRIED pool is untouched (`carried_pool` everywhere), and with the
 *     flag off every path is byte-identical to before.
 *
 * "Designated" is a STATE of the pool (`legacy_funds_designated_at`, plus a
 * positive balance), not a new ledger vocabulary: no account_type, entry_type,
 * reference_type or owner_type is added, so entry-type-parity and
 * reference-type-parity are untouched. If the operator meant something else
 * (e.g. sweeping the dollars into a single RESERVE-like holding account), the
 * change is confined to `assertPoolLegAllowed_`'s direction rule and
 * `returnDesignatedFunds` in service.ts.
 *
 * The wind-down primitive is `returnDesignatedFunds(pool_id, investment_id)`:
 * one CONFIRMED LEDGER investment back to its investor's wallet, idempotent by
 * investment id. No automatic sweep; no payout to Stripe here (the investor's
 * wallet exit is the existing payout path).
 */

/**
 * The account types a designated pool account may pay OUT to: the
 * contributors. The type is necessary, not sufficient — the service narrows
 * it (`isDesignatedContributorAccount_` in service.ts): a USER_WALLET only
 * when it belongs to an investor with a LEDGER investment in that pool, an
 * ESCROW only when it is the system order escrow (`isSystemEscrowAccount`).
 */
export const DESIGNATED_RETURN_ACCOUNT_TYPES = ["USER_WALLET", "ESCROW"] as const

const RETURN_TYPES: ReadonlySet<string> = new Set<string>(DESIGNATED_RETURN_ACCOUNT_TYPES)

export function isDesignatedReturnAccountType(accountType: string | null | undefined): boolean {
  return typeof accountType === "string" && RETURN_TYPES.has(accountType)
}

/**
 * The singleton system ESCROW (`getOrCreateSystemAccount("ESCROW")`: owner
 * SYSTEM / "system"), where order payments sit and where `processRefund`
 * reverses an auto-invest leg. NOT the per-entity escrows that share the
 * type and owner_type but carry a subject id as owner_id (subcontract,
 * campaign, sponsorship, demand pool): those release into SELLER_EARNINGS,
 * so allowing them would be a two-hop route around `designated_outbound_only`.
 */
export function isSystemEscrowAccount(account: { account_type?: string | null; owner_type?: string | null; owner_id?: string | null }): boolean {
  return account.account_type === "ESCROW" && account.owner_type === "SYSTEM" && account.owner_id === "system"
}

/** Integer cents of a major-unit amount (the ledger stores dollars as NUMERIC). */
export function toCents(amount: unknown): number {
  const n = Number(amount ?? 0)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromCents(cents: number): number {
  return cents / 100
}

/** A pool account holds legacy funds to designate only while its balance is positive. */
export function hasDesignatedBalance(account: { balance?: unknown } | null | undefined): boolean {
  return toCents(account?.balance) > 0
}

/** The idempotency key of one investment's return: derived from the record, never the attempt. */
export function designatedReturnKey(investmentId: string): string {
  return `designated-return-${investmentId}`
}

/** Investment statuses whose principal has left the pool (returned or never counted). */
export const SETTLED_INVESTMENT_STATUSES = ["WITHDRAWN", "CANCELLED"] as const

const SETTLED: ReadonlySet<string> = new Set<string>(SETTLED_INVESTMENT_STATUSES)

/** The pool column no generated create/update may set. */
export const POOL_DESIGNATION_FIELDS = ["legacy_funds_designated_at"] as const

/**
 * Drop the designation column from any create/update input, whatever its
 * shape (one row, a list, or the `{ selector, data }` update form) — the same
 * shapes `stripPoolCarrierFields` handles. A copy; the caller's object is
 * untouched.
 */
export function stripPoolDesignationFields<T>(input: T): T {
  if (Array.isArray(input)) return input.map((row) => stripPoolDesignationFields(row)) as unknown as T
  if (!input || typeof input !== "object") return input
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  for (const field of POOL_DESIGNATION_FIELDS) delete copy[field]
  if ("data" in copy && "selector" in copy) copy.data = stripPoolDesignationFields(copy.data)
  return copy as T
}

export type DesignatedPoolFunds = {
  pool_id: string
  name: string | null
  producer_id: string | null
  status: string | null
  ledger_account_id: string | null
  legacy_funds_designated_at: string | null
  /** The pool account's cached balance, major units. */
  account_balance: number
  /** LEDGER-settled investments whose principal is still in the pool (not WITHDRAWN / CANCELLED). */
  outstanding_ledger_investments: { count: number; total: number }
  /** CONFIRMED LEDGER investments `returnDesignatedFunds` can send back. */
  returnable_investments: number
  /**
   * account_balance − outstanding total. Non-zero in general: auto-invest
   * legs credit the account with no Investment row, and the withdraw route and
   * refund reversals move the balance without touching any row (pre-existing
   * counter drift). Surfaced, not hidden.
   */
  delta: number
}

export type DesignatedPoolFundsReport = {
  pools: DesignatedPoolFunds[]
  totals: { pools: number; account_balance: number; outstanding_ledger_investments: number; delta: number }
}

type PoolShape = {
  id: string
  name?: string | null
  producer_id?: string | null
  status?: string | null
  ledger_account_id?: string | null
  legacy_funds_designated_at?: Date | string | null
}

type InvestmentShape = { amount?: unknown; status?: unknown }

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** One designated pool's line in the report, in integer cents underneath. */
export function summariseDesignatedPool(
  pool: PoolShape,
  account: { balance?: unknown } | null | undefined,
  ledgerInvestments: InvestmentShape[]
): DesignatedPoolFunds {
  const outstanding = ledgerInvestments.filter((i) => !SETTLED.has(String(i.status ?? "")))
  const balanceCents = toCents(account?.balance)
  const outstandingCents = outstanding.reduce((sum, i) => sum + toCents(i.amount), 0)
  return {
    pool_id: pool.id,
    name: pool.name ?? null,
    producer_id: pool.producer_id ?? null,
    status: pool.status ?? null,
    ledger_account_id: pool.ledger_account_id ?? null,
    legacy_funds_designated_at: isoOrNull(pool.legacy_funds_designated_at),
    account_balance: fromCents(balanceCents),
    outstanding_ledger_investments: { count: outstanding.length, total: fromCents(outstandingCents) },
    returnable_investments: ledgerInvestments.filter((i) => i.status === "CONFIRMED").length,
    delta: fromCents(balanceCents - outstandingCents),
  }
}

export function totalDesignatedPoolFunds(pools: DesignatedPoolFunds[]): DesignatedPoolFundsReport["totals"] {
  const sum = (pick: (p: DesignatedPoolFunds) => number) => fromCents(pools.reduce((s, p) => s + toCents(pick(p)), 0))
  return {
    pools: pools.length,
    account_balance: sum((p) => p.account_balance),
    outstanding_ledger_investments: sum((p) => p.outstanding_ledger_investments.total),
    delta: sum((p) => p.delta),
  }
}
