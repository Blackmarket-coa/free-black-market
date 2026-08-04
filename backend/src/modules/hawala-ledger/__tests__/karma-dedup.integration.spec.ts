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
} from "../models"

/**
 * Karma dedup under true concurrency — the second of the two integration-level
 * follow-ups `ECONOMIC_REVIEW.md` left open.
 *
 * H6's fix was `Migration20260601AddKarmaDedup`: a PARTIAL UNIQUE index on
 * `(source_module, source_id)`, scoped `WHERE source_id IS NOT NULL AND
 * deleted_at IS NULL`, so a retried system event cannot double-count karma
 * while operator-granted events (null `source_id`) stay free to repeat.
 *
 * A unit test can assert that the migration file contains that SQL. It cannot
 * assert that Postgres *enforces* it — that the predicate is right, that the
 * partial scope actually excludes nulls, or that two genuinely concurrent
 * inserts resolve to one row rather than two. Those are properties of the
 * index, not of the code, and only a live database can demonstrate them. The
 * review flagged exactly this: "the H6 unique constraint requires a live
 * Postgres harness; tracked as follow-ups rather than claimed under unit
 * coverage."
 *
 * The assertions run against raw SQL rather than a service method on purpose:
 * the subject under test is the constraint itself, and going through an
 * application-level guard would prove only that the guard works — leaving the
 * index, the thing that holds when the guard is bypassed or raced, unproven.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules yarn test:integration:modules \
 *     src/modules/hawala-ledger/__tests__/karma-dedup.integration.spec.ts
 */
moduleIntegrationTestRunner<HawalaLedgerModuleService>({
  moduleName: HAWALA_LEDGER_MODULE,
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
  ],
  testSuite: ({ service }) => {
    function pg(): { raw: (sql: string, bindings?: unknown[]) => Promise<any> } {
      const conn = (service as any).resolvePgConnection()
      if (!conn) throw new Error("karma-dedup: no pg connection reachable")
      return conn
    }
    function rows(result: any): any[] {
      return result?.rows ?? result ?? []
    }

    /**
     * The generated schema comes from the model definitions, which carry no
     * partial-unique index — that lives in the migration. Recreate it here so
     * the constraint under test is present exactly as production has it.
     *
     * `beforeEach`, not `beforeAll`: the runner initialises the module (and
     * therefore the connection) in its own `beforeEach`, so nothing is
     * reachable earlier.
     */
    beforeEach(async () => {
      await pg().raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_karma_event_source"
           ON "karma_event" ("source_module", "source_id")
         WHERE "source_id" IS NOT NULL AND "deleted_at" IS NULL;`
      )
    })

    const uniqueSource = () => `src-${Math.random().toString(36).slice(2)}`

    async function insertKarma(
      sourceModule: string,
      sourceId: string | null,
      delta = 10
    ) {
      return pg().raw(
        `INSERT INTO karma_event
           (id, member_id, delta, reason, source_module, source_id,
            occurred_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
        [
          `ke_${Math.random().toString(36).slice(2)}`,
          "member_1",
          delta,
          "test",
          sourceModule,
          sourceId,
        ]
      )
    }

    async function countFor(sourceId: string): Promise<number> {
      const r = await pg().raw(
        `SELECT COUNT(*)::int AS n FROM karma_event
          WHERE source_id = ? AND deleted_at IS NULL`,
        [sourceId]
      )
      return Number(rows(r)[0]?.n ?? 0)
    }

    describe("karma_event dedup (partial unique index under contention)", () => {
      it("admits the first event for a source and rejects the retry", async () => {
        const sourceId = uniqueSource()
        await insertKarma("orders", sourceId)

        await expect(insertKarma("orders", sourceId)).rejects.toThrow()
        expect(await countFor(sourceId)).toBe(1)
      })

      it("collapses genuinely concurrent duplicates to exactly one row", async () => {
        // The case the index exists for: a system event fanned out or retried
        // in parallel, where an application-level check-then-insert would let
        // several through the window between the check and the write.
        const sourceId = uniqueSource()

        const settled = await Promise.allSettled(
          Array.from({ length: 8 }, () => insertKarma("orders", sourceId))
        )

        expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1)
        expect(settled.filter((s) => s.status === "rejected")).toHaveLength(7)
        expect(await countFor(sourceId)).toBe(1)
      })

      it("scopes uniqueness per module, so the same source id in two modules is not a clash", async () => {
        const sourceId = uniqueSource()
        await insertKarma("orders", sourceId)
        await expect(insertKarma("wellness", sourceId)).resolves.toBeDefined()
        expect(await countFor(sourceId)).toBe(2)
      })

      it("leaves operator-granted events (null source_id) free to repeat", async () => {
        // The partial predicate's whole purpose: manual grants have no source
        // to dedup on and must not collapse into a single lifetime award.
        const before = await pg().raw(
          `SELECT COUNT(*)::int AS n FROM karma_event
            WHERE source_id IS NULL AND source_module = 'manual'`
        )
        const start = Number(rows(before)[0]?.n ?? 0)

        await insertKarma("manual", null)
        await insertKarma("manual", null)
        await insertKarma("manual", null)

        const after = await pg().raw(
          `SELECT COUNT(*)::int AS n FROM karma_event
            WHERE source_id IS NULL AND source_module = 'manual'`
        )
        expect(Number(rows(after)[0]?.n ?? 0)).toBe(start + 3)
      })

      it("releases the key when a row is soft-deleted", async () => {
        // `WHERE deleted_at IS NULL` — a reversed award must not reserve its
        // source id forever, or the same event could never be re-awarded.
        const sourceId = uniqueSource()
        await insertKarma("orders", sourceId)
        await expect(insertKarma("orders", sourceId)).rejects.toThrow()

        await pg().raw(
          `UPDATE karma_event SET deleted_at = NOW() WHERE source_id = ?`,
          [sourceId]
        )

        await expect(insertKarma("orders", sourceId)).resolves.toBeDefined()
        expect(await countFor(sourceId)).toBe(1)
      })
    })
  },
})
