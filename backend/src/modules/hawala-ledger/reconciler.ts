/**
 * Ledger balance reconciler.
 *
 * Recomputes the "ledger truth" for every account from the immutable
 * `ledger_entry` rows (sum of credits minus sum of debits over terminal
 * COMPLETED/SETTLED entries) and compares it to the cached
 * `ledger_account.balance`. Any drift above a small epsilon is reported
 * and logged.
 *
 * This is intentionally READ-ONLY: it never auto-corrects balances. A
 * detected drift is an operational signal that the cached balance and the
 * entry log have diverged (e.g. a lost read-modify-write update) and needs
 * human/operator investigation.
 *
 * Pure-ish and unit-testable: the `hawala` service and `pgConnection` are
 * injected, so tests can pass fakes.
 */

const DRIFT_EPSILON = 0.01

export interface LedgerDrift {
  account_id: string
  cached: number
  computed: number
  drift: number
}

export interface ReconcileOptions {
  /** Minimum absolute drift to report. Defaults to 0.01. */
  epsilon?: number
  /** Logger; defaults to console. */
  logger?: { warn: (msg: string) => void; info?: (msg: string) => void }
}

/**
 * @param hawala  HawalaLedgerModuleService (or a fake exposing
 *                listLedgerAccounts).
 * @param pgConnection  knex/pg raw connection exposing `.raw(sql, bindings)`
 *                returning `{ rows: [...] }`.
 */
export async function reconcileLedgerBalances(
  hawala: { listLedgerAccounts: (filter?: any) => Promise<any[]> },
  pgConnection: { raw: (sql: string, bindings?: any[]) => Promise<{ rows: any[] }> },
  opts?: ReconcileOptions
): Promise<LedgerDrift[]> {
  const epsilon = opts?.epsilon ?? DRIFT_EPSILON
  const logger = opts?.logger ?? console

  const accounts = await hawala.listLedgerAccounts({})

  // Sum of credit amounts grouped by credit_account_id (money in) and sum
  // of debit amounts grouped by debit_account_id (money out), over terminal
  // entries only. Two grouped scans, combined in memory.
  const creditResult = await pgConnection.raw(
    `SELECT credit_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
       FROM ledger_entry
      WHERE deleted_at IS NULL
        AND status IN ('COMPLETED', 'SETTLED')
        AND credit_account_id IS NOT NULL
      GROUP BY credit_account_id`,
    []
  )
  const debitResult = await pgConnection.raw(
    `SELECT debit_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
       FROM ledger_entry
      WHERE deleted_at IS NULL
        AND status IN ('COMPLETED', 'SETTLED')
        AND debit_account_id IS NOT NULL
      GROUP BY debit_account_id`,
    []
  )

  const credits = new Map<string, number>()
  for (const row of creditResult?.rows ?? []) {
    credits.set(row.account_id, Number(row.total))
  }
  const debits = new Map<string, number>()
  for (const row of debitResult?.rows ?? []) {
    debits.set(row.account_id, Number(row.total))
  }

  const drifts: LedgerDrift[] = []

  for (const account of accounts) {
    const cached = Number(account.balance)
    const computed = (credits.get(account.id) ?? 0) - (debits.get(account.id) ?? 0)
    const drift = cached - computed

    if (Math.abs(drift) > epsilon) {
      const entry: LedgerDrift = {
        account_id: account.id,
        cached,
        computed,
        drift,
      }
      drifts.push(entry)
      logger.warn(
        `[hawala-balance-reconciler] DRIFT account=${entry.account_id} ` +
          `cached=${cached} computed=${computed} drift=${drift}`
      )
    }
  }

  return drifts
}
