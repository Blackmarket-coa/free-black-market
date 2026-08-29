import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { HAWALA_LEDGER_MODULE } from ".."
import HawalaLedgerModuleService from "../service"
import {
  LedgerAccount,
  LedgerEntry,
  SettlementBatch,
  InvestmentPool,
  Investment,
  BankAccount,
  AchTransaction,
  VendorAdvance,
  AdvanceRepayment,
  PayoutConfig,
  PayoutSplitRule,
  PayoutRequest,
  ChargebackProtection,
  ChargebackClaim,
  VendorPayment,
  VendorCreditLine,
  CreditLineTransaction,
  EscrowAgreement,
  PatronageAllocation,
  KarmaEvent,
  ExternalRecord,
  MatchingRule,
  ReconciliationRun,
  ReconciliationMatch,
  IngestCursor,
  BalanceMonitor,
  MonitorBreach,
} from "../models"

/**
 * Money-path concurrency soak — the residual LAUNCH_READINESS §2 gate.
 *
 * This is the verification the unit tests structurally CANNOT provide: it
 * spins up a real Postgres (via moduleIntegrationTestRunner), wires the
 * module container with a real PG_CONNECTION so `createTransfer` and the
 * pool-total updates take their atomic-by-default paths, and then fires
 * genuinely concurrent operations at a single account/pool to prove the
 * atomic CAS holds the financial invariants under contention.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules yarn test:integration:modules \
 *     src/modules/hawala-ledger/__tests__/concurrency-soak.integration.spec.ts
 *
 * It is intentionally NOT a *.unit.spec.ts, so the unit suite (which has no
 * DB) does not pick it up. If the legacy read-modify-write path were active,
 * or the atomic UPDATE targeted the wrong table, these assertions would fail
 * with overdrafts, lost updates, or conservation violations.
 *
 * The model list mirrors exactly what HawalaLedgerModuleService registers, so
 * the generated schema matches the service's expectations.
 */
moduleIntegrationTestRunner<HawalaLedgerModuleService>({
  moduleName: HAWALA_LEDGER_MODULE,
  // hawalaLedger is a custom (non-builtin) module, so the runner can't infer its
  // location from ModulesDefinition; point it at the module dir explicitly or
  // bootstrap fails with "Cannot resolve module ''".
  resolve: "./src/modules/hawala-ledger",
  moduleModels: [
    LedgerAccount,
    LedgerEntry,
    SettlementBatch,
    InvestmentPool,
    Investment,
    BankAccount,
    AchTransaction,
    VendorAdvance,
    AdvanceRepayment,
    PayoutConfig,
    PayoutSplitRule,
    PayoutRequest,
    ChargebackProtection,
    ChargebackClaim,
    VendorPayment,
    VendorCreditLine,
    CreditLineTransaction,
    EscrowAgreement,
    PatronageAllocation,
    KarmaEvent,
    ExternalRecord,
    MatchingRule,
    ReconciliationRun,
    ReconciliationMatch,
    IngestCursor,
    BalanceMonitor,
    MonitorBreach,
  ],
  testSuite: ({ service }) => {
    /**
     * Create an account and seed its balance/available_balance directly
     * (bypassing the transfer rails, which is fine for test setup).
     */
    async function seedAccount(accountType: string, balance: number) {
      const account = await service.createAccount({
        account_type: accountType,
        owner_type: "SELLER",
        owner_id: `owner-${Math.random().toString(36).slice(2)}`,
      })
      if (balance > 0) {
        await (service as any).updateLedgerAccounts({
          id: account.id,
          balance,
          available_balance: balance,
        })
      }
      return account.id
    }

    // Read post-state straight from Postgres. The money mutations run as raw
    // atomic SQL UPDATEs, so the service's MikroORM identity map would return
    // stale cached rows here; raw reads reflect the committed truth.
    function pg(): { raw: (sql: string, bindings?: unknown[]) => Promise<any> } {
      const conn = (service as any).resolvePgConnection()
      if (!conn) throw new Error("soak: no pg connection reachable")
      return conn
    }
    function firstRow(result: any): any {
      return result?.rows?.[0] ?? result?.[0]
    }

    async function balanceOf(accountId: string): Promise<number> {
      const r = await pg().raw(
        "SELECT balance FROM hawala_ledger_account WHERE id = ?",
        [accountId]
      )
      return Number(firstRow(r)?.balance)
    }

    describe("hawala money-path concurrency soak (atomic by default)", () => {
      it("never overdraws a single account under concurrent debits", async () => {
        const FUNDING = 100
        const ATTEMPTS = 150 // 50 more than can succeed
        const source = await seedAccount("SELLER_EARNINGS", FUNDING)
        const sink = await seedAccount("SELLER_EARNINGS", 0)

        const results = await Promise.allSettled(
          Array.from({ length: ATTEMPTS }, () =>
            service.createTransfer({
              debit_account_id: source,
              credit_account_id: sink,
              amount: 1,
              entry_type: "TRANSFER",
            })
          )
        )

        const ok = results.filter((r) => r.status === "fulfilled").length
        const failed = results.filter((r) => r.status === "rejected").length

        // Exactly the funded amount of debits may succeed; the rest must be
        // rejected by the atomic CAS — not silently allowed to overdraw.
        expect(ok).toBe(FUNDING)
        expect(failed).toBe(ATTEMPTS - FUNDING)

        // The account is drained to exactly zero and never went negative.
        expect(await balanceOf(source)).toBe(0)
        // Every successful debit landed on the sink (no lost credits).
        expect(await balanceOf(sink)).toBe(FUNDING)
      })

      it("conserves total value across concurrent bidirectional transfers", async () => {
        const SEED = 1000
        const N = 100
        const a = await seedAccount("SELLER_EARNINGS", SEED)
        const b = await seedAccount("SELLER_EARNINGS", SEED)

        const transfers = [
          ...Array.from({ length: N }, () =>
            service.createTransfer({
              debit_account_id: a,
              credit_account_id: b,
              amount: 1,
              entry_type: "TRANSFER",
            })
          ),
          ...Array.from({ length: N }, () =>
            service.createTransfer({
              debit_account_id: b,
              credit_account_id: a,
              amount: 1,
              entry_type: "TRANSFER",
            })
          ),
        ]

        await Promise.allSettled(transfers)

        const finalA = await balanceOf(a)
        const finalB = await balanceOf(b)

        // No money created or destroyed — the sum is conserved exactly even
        // under interleaved read-modify-write pressure. A lost update would
        // make this drift off 2*SEED.
        expect(finalA + finalB).toBe(2 * SEED)
        expect(finalA).toBeGreaterThanOrEqual(0)
        expect(finalB).toBeGreaterThanOrEqual(0)
      })

      it("keeps investment-pool totals exact under concurrent investments", async () => {
        const M = 50
        const X = 2
        const pool = await service.getOrCreateProducerPool(
          `producer-${Math.random().toString(36).slice(2)}`
        )
        const investor = await seedAccount("USER_WALLET", M * X)

        const results = await Promise.allSettled(
          Array.from({ length: M }, () =>
            service.createInvestment({
              pool_id: pool!.id,
              investor_account_id: investor,
              amount: X,
            })
          )
        )

        const ok = results.filter((r) => r.status === "fulfilled").length
        expect(ok).toBe(M)

        const totals = firstRow(
          await pg().raw(
            "SELECT total_raised, total_investors FROM hawala_investment_pool WHERE id = ?",
            [pool!.id]
          )
        )
        // Atomic col = col + ? increments: no lost updates under concurrency.
        expect(Number(totals.total_raised)).toBe(M * X)
        expect(Number(totals.total_investors)).toBe(M)

        // Funds fully moved investor -> pool ledger account.
        expect(await balanceOf(investor)).toBe(0)
        expect(await balanceOf(pool!.ledger_account_id)).toBe(M * X)
      })
    })
  },
})
