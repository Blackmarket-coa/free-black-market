/**
 * Verifiable ledger trail for a demand pool's pooled funds.
 *
 * Phase 7's premise: deal aggregators run on opaque affiliate commissions and
 * mutual aid tools have no ledger at all, so "you can check the money yourself"
 * is a claim neither can make. This assembles that record for one pool.
 *
 * ## Two constraints shape the shape of it
 *
 * **Privacy.** A ledger entry names the accounts on both sides and, via
 * `debit_balance_after` / `credit_balance_after`, the running balance of a
 * private wallet. None of that belongs in a trail shown to a pool's
 * participants: what happened to the *pool's* money is collective, what any one
 * member holds is not. So account ids, balances-after and idempotency keys are
 * dropped rather than passed through — this projects a view, it does not
 * serialize the row.
 *
 * **Not overstating verification.** An entry is only independently checkable
 * once it has been anchored on Stellar: settled into a batch whose
 * `merkle_root` is committed in a transaction anyone can look up. Until then it
 * is FBM's word for it, which is exactly the trust position this feature
 * exists to improve on. So every entry reports its own `verification` state and
 * the summary counts them separately. Presenting an unsettled entry as
 * "verified" would be the same overclaim the spec warns against when it says
 * not to surface a verifiable ledger built on unfixed foundations.
 */

export type SettlementRef = {
  batch_number: number | null
  status: string | null
  /** Committed on-chain; anyone can look this up on a Stellar explorer. */
  stellar_tx_hash: string | null
  stellar_ledger_sequence: number | null
  /** SHA-256 root the batch's entries hash into. */
  merkle_root: string | null
  settled_at: string | null
}

export type TrailEntry = {
  id: string
  entry_type: string
  amount: number
  currency_code: string
  description: string | null
  status: string
  occurred_at: string | null
  /** Which artifact this entry belongs to — the pool itself, or one bounty. */
  scope: "POOL" | "BOUNTY"
  reference_id: string | null
  verification: "ANCHORED" | "SETTLED_PENDING_ANCHOR" | "UNSETTLED"
  settlement: SettlementRef | null
}

export type PoolLedgerTrail = {
  demand_post_id: string
  entries: TrailEntry[]
  summary: {
    entry_count: number
    /** Money that entered the pool's escrow. */
    total_in: number
    /** Money that left it — releases, refunds, bounty payouts. */
    total_out: number
    /** total_in - total_out. Should match the escrow account's balance. */
    net: number
    anchored_count: number
    settled_pending_anchor_count: number
    unsettled_count: number
    currency_code: string
  }
}

type RawEntry = {
  id: string
  entry_type?: string | null
  amount?: unknown
  currency_code?: string | null
  description?: string | null
  status?: string | null
  created_at?: unknown
  reference_id?: string | null
  debit_account_id?: string | null
  credit_account_id?: string | null
  settlement_batch_id?: string | null
  settled_at?: unknown
}

type RawBatch = {
  id: string
  batch_number?: number | null
  status?: string | null
  stellar_tx_hash?: string | null
  stellar_ledger_sequence?: number | null
  merkle_root?: string | null
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  if (v instanceof Date) return v.toISOString()
  return typeof v === "string" ? v : null
}

/**
 * A batch only proves anything once its Merkle root is actually on-chain.
 * `CONFIRMED`/`COMPLETED` with a tx hash is the anchored case; a batch that
 * exists but has not landed yet is explicitly not.
 */
function classify(
  entry: RawEntry,
  batch: RawBatch | undefined
): TrailEntry["verification"] {
  if (!entry.settlement_batch_id) return "UNSETTLED"
  if (batch?.stellar_tx_hash) return "ANCHORED"
  return "SETTLED_PENDING_ANCHOR"
}

/**
 * Build the trail.
 *
 * `escrowAccountId` decides direction: an entry crediting the escrow is money
 * in, one debiting it is money out. Without it every amount would be a
 * magnitude with no sign, and the summary could not be checked against the
 * escrow balance — which is the arithmetic a reader is meant to be able to
 * redo.
 */
export function buildPoolLedgerTrail(input: {
  demandPostId: string
  escrowAccountId: string | null
  entries: RawEntry[]
  batchesById: Map<string, RawBatch>
  bountyIds: Set<string>
}): PoolLedgerTrail {
  const { demandPostId, escrowAccountId, entries, batchesById, bountyIds } = input

  let totalIn = 0
  let totalOut = 0
  let anchored = 0
  let pending = 0
  let unsettled = 0
  let currency = "USD"

  const projected: TrailEntry[] = entries.map((e) => {
    const amount = Number(e.amount ?? 0)
    if (e.currency_code) currency = e.currency_code

    if (escrowAccountId) {
      if (e.credit_account_id === escrowAccountId) totalIn += amount
      else if (e.debit_account_id === escrowAccountId) totalOut += amount
    }

    const batch = e.settlement_batch_id
      ? batchesById.get(e.settlement_batch_id)
      : undefined
    const verification = classify(e, batch)
    if (verification === "ANCHORED") anchored++
    else if (verification === "SETTLED_PENDING_ANCHOR") pending++
    else unsettled++

    return {
      id: e.id,
      entry_type: e.entry_type ?? "TRANSFER",
      amount,
      currency_code: e.currency_code ?? "USD",
      description: e.description ?? null,
      status: e.status ?? "COMPLETED",
      occurred_at: iso(e.created_at),
      scope:
        e.reference_id && bountyIds.has(e.reference_id) ? "BOUNTY" : "POOL",
      reference_id: e.reference_id ?? null,
      verification,
      settlement: batch
        ? {
            batch_number: batch.batch_number ?? null,
            status: batch.status ?? null,
            stellar_tx_hash: batch.stellar_tx_hash ?? null,
            stellar_ledger_sequence: batch.stellar_ledger_sequence ?? null,
            merkle_root: batch.merkle_root ?? null,
            settled_at: iso(e.settled_at),
          }
        : null,
      // Deliberately absent: debit_account_id, credit_account_id,
      // debit_balance_after, credit_balance_after, idempotency_key. What the
      // pool did with its money is collective; what a member holds is not.
    }
  })

  return {
    demand_post_id: demandPostId,
    entries: projected,
    summary: {
      entry_count: projected.length,
      total_in: totalIn,
      total_out: totalOut,
      net: totalIn - totalOut,
      anchored_count: anchored,
      settled_pending_anchor_count: pending,
      unsettled_count: unsettled,
      currency_code: currency,
    },
  }
}
