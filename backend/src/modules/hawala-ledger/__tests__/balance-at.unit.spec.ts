import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for point-in-time balance replay (getBalanceAt):
 *
 *  1. The replay SQL uses the reconciler's status set
 *     (COMPLETED/SETTLED/REVERSED), an inclusive created_at bound, and
 *     counts both legs of a self-transfer via independent CASEs.
 *  2. Historical queries return no drift check; "now" queries compare
 *     against the cached balance.
 *  3. Bad timestamps and a missing pg connection fail loudly.
 */

type RawCall = { sql: string; bindings: any[] }

function buildService(row: Record<string, unknown>, opts?: { cachedBalance?: number }) {
  const svc: any = Object.create(HawalaLedgerModuleService.prototype)
  const calls: RawCall[] = []
  svc.__container__ = {
    resolve: jest.fn(() => ({
      raw: async (sql: string, bindings: any[]) => {
        calls.push({ sql, bindings })
        return { rows: [row] }
      },
    })),
  }
  svc.retrieveLedgerAccount = jest.fn(async () => ({
    id: "acc-1",
    balance: opts?.cachedBalance ?? 0,
  }))
  return { svc, calls }
}

describe("getBalanceAt", () => {
  it("replays with the reconciler status set and inclusive bound", async () => {
    const { svc, calls } = buildService({ credits: "150.00", debits: "50.00", entries_considered: "7" })

    const result = await svc.getBalanceAt("acc-1", "2026-01-01T00:00:00Z")

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain(`"status" IN ('COMPLETED', 'SETTLED', 'REVERSED')`)
    expect(calls[0].sql).toContain(`"created_at" <= ?`)
    expect(calls[0].sql).toContain(`CASE WHEN "credit_account_id" = ?`)
    expect(calls[0].sql).toContain(`CASE WHEN "debit_account_id" = ?`)
    expect(calls[0].bindings).toEqual([
      "acc-1",
      "acc-1",
      "acc-1",
      "acc-1",
      "2026-01-01T00:00:00.000Z",
    ])
    expect(result.balance).toBe(100)
    expect(result.credits).toBe(150)
    expect(result.debits).toBe(50)
    expect(result.entries_considered).toBe(7)
    // A historical as-of has no meaningful cached comparison.
    expect(result.drift_vs_cached).toBeNull()
  })

  it("cross-checks against the cached balance when asked for now", async () => {
    const { svc } = buildService(
      { credits: "150.00", debits: "50.00", entries_considered: "7" },
      { cachedBalance: 100.5 }
    )

    const result = await svc.getBalanceAt("acc-1", new Date())
    expect(result.drift_vs_cached).toBeCloseTo(0.5)
  })

  it("rejects invalid timestamps and a missing pg connection", async () => {
    const { svc } = buildService({})
    await expect(svc.getBalanceAt("acc-1", "yesterday-ish")).rejects.toThrow(/Invalid timestamp/)

    const noPg: any = Object.create(HawalaLedgerModuleService.prototype)
    noPg.__container__ = {
      resolve: jest.fn(() => {
        throw new Error("AwilixResolutionError: not registered")
      }),
    }
    await expect(noPg.getBalanceAt("acc-1", new Date())).rejects.toThrow(/database connection/)
  })
})
