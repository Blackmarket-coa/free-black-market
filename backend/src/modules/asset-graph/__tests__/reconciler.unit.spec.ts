/**
 * Settlement reconciler tests.
 *
 * The reconciler is pure-ish: per-record dispatch by rail, calling
 * out to hawala-ledger via a parameterized service surface. Tests use
 * fake hawala + asset-graph services to verify:
 *
 *   - Each rail's correct write path: CCR/USDC/USD/HRS → createTransfer,
 *     KARMA → createKarmaEvents, GIFT → metadata-only mark.
 *
 *   - Idempotency: re-running on the same record short-circuits.
 *     `createTransfer` uses `settlement-${id}` as its idempotency key;
 *     KARMA paths check existing events by source_id; GIFT paths
 *     short-circuit on `metadata.reconciled_at`.
 *
 *   - Error paths: missing accounts return a structured failure
 *     (don't throw); KARMA missing `karma_reason` in metadata fails
 *     cleanly; the batch loop continues past failures.
 *
 *   - Metadata threading: `reference_type` / `reference_id` /
 *     `order_id` from settlement metadata land on the ledger entry.
 */

import {
  reconcileSettlementRecord,
  reconcileAllUnsettled,
  type ReconcilerSettlementRecord,
  type ReconcilerHawalaSurface,
  type ReconcilerAssetGraphSurface,
} from "../reconciler"

// ── fake service builders ───────────────────────────────────────────

type FakeAccount = {
  id: string
  owner_id: string
  owner_type: string
  account_type: string
  currency_code: string
}

const buildFakeHawala = (
  fixtures: {
    accounts?: FakeAccount[]
    existingKarmaEvents?: Array<{ id: string; source_id: string }>
  } = {}
): ReconcilerHawalaSurface & { calls: Array<{ method: string; args: any }> } => {
  const accounts = fixtures.accounts ?? []
  const karmaEvents = fixtures.existingKarmaEvents ?? []
  const calls: Array<{ method: string; args: any }> = []
  const transfers: Array<{ id: string; idempotency_key?: string }> = []

  return {
    calls,
    listLedgerAccounts: jest.fn(async (filter: any) => {
      calls.push({ method: "listLedgerAccounts", args: filter })
      return accounts.filter(
        (a) =>
          (filter.owner_id === undefined || a.owner_id === filter.owner_id) &&
          (filter.owner_type === undefined ||
            a.owner_type === filter.owner_type) &&
          (filter.account_type === undefined ||
            a.account_type === filter.account_type) &&
          (filter.currency_code === undefined ||
            a.currency_code === filter.currency_code)
      )
    }),
    createTransfer: jest.fn(async (data: any) => {
      calls.push({ method: "createTransfer", args: data })
      // Idempotency: return existing if key matches.
      if (data.idempotency_key) {
        const existing = transfers.find(
          (t) => t.idempotency_key === data.idempotency_key
        )
        if (existing) return existing
      }
      const entry = {
        id: `le_${transfers.length + 1}`,
        idempotency_key: data.idempotency_key,
      }
      transfers.push(entry)
      return entry
    }),
    listKarmaEvents: jest.fn(async (filter: any) => {
      calls.push({ method: "listKarmaEvents", args: filter })
      return karmaEvents.filter(
        (e) =>
          filter.source_id === undefined || e.source_id === filter.source_id
      )
    }),
    createKarmaEvents: jest.fn(async (data: any) => {
      calls.push({ method: "createKarmaEvents", args: data })
      const event = { id: `ke_${karmaEvents.length + 1}` }
      karmaEvents.push({ id: event.id, source_id: data.source_id })
      return event
    }),
  } as any
}

const buildFakeAssetGraph = (
  fixtures: { records?: ReconcilerSettlementRecord[] } = {}
): ReconcilerAssetGraphSurface & {
  records: Record<string, ReconcilerSettlementRecord>
  calls: Array<{ method: string; args: any }>
} => {
  const recordsById: Record<string, ReconcilerSettlementRecord> = {}
  for (const r of fixtures.records ?? []) recordsById[r.id] = r
  const calls: Array<{ method: string; args: any }> = []

  return {
    records: recordsById,
    calls,
    listSettlementRecords: jest.fn(async (filter: any) => {
      calls.push({ method: "listSettlementRecords", args: filter })
      return Object.values(recordsById).filter((r) =>
        filter.ledger_entry_id === null ? r.ledger_entry_id === null : true
      )
    }),
    updateSettlementRecords: jest.fn(async (payload: any) => {
      calls.push({ method: "updateSettlementRecords", args: payload })
      const existing = recordsById[payload.id]
      if (!existing) throw new Error(`No record ${payload.id}`)
      const updated: ReconcilerSettlementRecord = {
        ...existing,
        ledger_entry_id:
          payload.ledger_entry_id !== undefined
            ? payload.ledger_entry_id
            : existing.ledger_entry_id,
        metadata: payload.metadata ?? existing.metadata,
      }
      recordsById[payload.id] = updated
      return updated
    }),
  } as any
}

// ── fixture builders ────────────────────────────────────────────────

const baseRecord = (
  overrides: Partial<ReconcilerSettlementRecord> = {}
): ReconcilerSettlementRecord => ({
  id: "sr_1",
  manifest_slug: "yard-scrap-nursery",
  project_instance_id: "pi_1",
  ledger_entry_id: null,
  rail: "ccr",
  from_member_id: "mem_a",
  to_member_id: "mem_b",
  amount_minor: 100,
  asset_code: "CCR",
  occurred_at: new Date("2026-05-13T00:00:00Z"),
  metadata: { order_id: "order_1" },
  ...overrides,
})

const accountsFor = (
  members: string[],
  account_type: string,
  currency_code: string
): FakeAccount[] =>
  members.map((m, i) => ({
    id: `acct_${currency_code}_${m}`,
    owner_id: m,
    owner_type: "CUSTOMER",
    account_type,
    currency_code,
  }))

// ── CCR / cash-rail tests ──────────────────────────────────────────

describe("reconcileSettlementRecord — CCR", () => {
  const ccrRecord = (overrides: Partial<ReconcilerSettlementRecord> = {}) =>
    baseRecord({
      rail: "ccr",
      asset_code: "CCR",
      metadata: { order_id: "order_42" },
      ...overrides,
    })

  it("creates a transfer between the from/to USER_WALLET-CCR accounts", async () => {
    const hawala = buildFakeHawala({
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [ccrRecord({ id: "sr_ccr_1" })],
    })

    const result = await reconcileSettlementRecord(
      ccrRecord({ id: "sr_ccr_1" }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("settled_ledger")
    if (result.status !== "settled_ledger") return

    expect(hawala.createTransfer).toHaveBeenCalledTimes(1)
    const transferArgs = (hawala.createTransfer as jest.Mock).mock.calls[0][0]
    expect(transferArgs.debit_account_id).toBe("acct_CCR_mem_a")
    expect(transferArgs.credit_account_id).toBe("acct_CCR_mem_b")
    expect(transferArgs.amount).toBe(100)
    expect(transferArgs.order_id).toBe("order_42")
    expect(transferArgs.idempotency_key).toBe("settlement-sr_ccr_1")
  })

  it("stamps ledger_entry_id and reconciled_at on the SettlementRecord", async () => {
    const hawala = buildFakeHawala({
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [ccrRecord({ id: "sr_ccr_1" })],
    })

    await reconcileSettlementRecord(
      ccrRecord({ id: "sr_ccr_1" }),
      hawala,
      assetGraph
    )

    expect(assetGraph.records.sr_ccr_1.ledger_entry_id).toBe("le_1")
    expect(assetGraph.records.sr_ccr_1.metadata?.reconciled_at).toBeDefined()
    expect(assetGraph.records.sr_ccr_1.metadata?.reconciler_result).toBe(
      "settled_ledger"
    )
  })

  it("returns failure (does not throw) when from account is missing", async () => {
    const hawala = buildFakeHawala({
      // Only the destination has an account.
      accounts: accountsFor(["mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [ccrRecord({ id: "sr_x" })],
    })

    const result = await reconcileSettlementRecord(
      ccrRecord({ id: "sr_x" }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("failed")
    if (result.status !== "failed") return
    expect(result.error).toMatch(/Missing ledger account/)
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })

  it("idempotency: second reconciliation returns the same ledger entry id", async () => {
    const hawala = buildFakeHawala({
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [ccrRecord({ id: "sr_idem" })],
    })

    const first = await reconcileSettlementRecord(
      ccrRecord({ id: "sr_idem" }),
      hawala,
      assetGraph
    )
    // Reset the record so reconciler thinks it's unsettled again
    // (simulates a partial failure where update never landed).
    assetGraph.records.sr_idem = ccrRecord({ id: "sr_idem" })

    const second = await reconcileSettlementRecord(
      assetGraph.records.sr_idem,
      hawala,
      assetGraph
    )

    expect(first.status).toBe("settled_ledger")
    expect(second.status).toBe("settled_ledger")
    if (first.status !== "settled_ledger") return
    if (second.status !== "settled_ledger") return
    // Same entry returned via the idempotency key.
    expect(first.ledger_entry_id).toBe(second.ledger_entry_id)
    expect(hawala.createTransfer).toHaveBeenCalledTimes(2)
  })
})

describe("reconcileSettlementRecord — HRS (time-bank)", () => {
  const hrsRecord = (overrides: Partial<ReconcilerSettlementRecord> = {}) =>
    baseRecord({
      manifest_slug: "tool-library",
      rail: "hours",
      asset_code: "HRS",
      amount_minor: 250,
      metadata: {
        reference_type: "TIMEBANK_LOAN",
        reference_id: "loan_1",
      },
      ...overrides,
    })

  it("creates a transfer between TIME_BANK-HRS accounts with the timebank reference", async () => {
    const hawala = buildFakeHawala({
      accounts: accountsFor(["mem_a", "mem_b"], "TIME_BANK", "HRS"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [hrsRecord({ id: "sr_hrs" })],
    })

    const result = await reconcileSettlementRecord(
      hrsRecord({ id: "sr_hrs" }),
      hawala,
      assetGraph
    )

    expect(result.status).toBe("settled_ledger")
    const transferArgs = (hawala.createTransfer as jest.Mock).mock.calls[0][0]
    expect(transferArgs.debit_account_id).toBe("acct_HRS_mem_a")
    expect(transferArgs.credit_account_id).toBe("acct_HRS_mem_b")
    expect(transferArgs.reference_type).toBe("TIMEBANK_LOAN")
    expect(transferArgs.reference_id).toBe("loan_1")
    expect(transferArgs.entry_type).toBe("TIMEBANK_LOAN")
  })

  it("fails cleanly when TIME_BANK accounts haven't been provisioned", async () => {
    const hawala = buildFakeHawala({
      // Members exist but only as USER_WALLET (CCR/USDC); no TIME_BANK accounts yet.
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [hrsRecord({ id: "sr_hrs_no_acct" })],
    })

    const result = await reconcileSettlementRecord(
      hrsRecord({ id: "sr_hrs_no_acct" }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("failed")
    if (result.status !== "failed") return
    expect(result.error).toMatch(/TIME_BANK/)
  })
})

// ── KARMA tests ─────────────────────────────────────────────────────

describe("reconcileSettlementRecord — KARMA", () => {
  const karmaRecord = (overrides: Partial<ReconcilerSettlementRecord> = {}) =>
    baseRecord({
      manifest_slug: "repair-cafe",
      rail: "karma",
      asset_code: "KARMA",
      amount_minor: 1,
      from_member_id: "SYSTEM",
      to_member_id: "mem_fixer",
      metadata: { karma_reason: "repair-completed" },
      ...overrides,
    })

  it("creates a karma_event on the to_member with the delta and reason", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [karmaRecord({ id: "sr_karma" })],
    })

    const result = await reconcileSettlementRecord(
      karmaRecord({ id: "sr_karma" }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("settled_karma")
    if (result.status !== "settled_karma") return

    expect(hawala.createKarmaEvents).toHaveBeenCalledTimes(1)
    const args = (hawala.createKarmaEvents as jest.Mock).mock.calls[0][0]
    expect(args.member_id).toBe("mem_fixer")
    expect(args.delta).toBe(1)
    expect(args.reason).toBe("repair-completed")
    expect(args.source_module).toBe("asset_graph")
    expect(args.source_id).toBe("sr_karma")
  })

  it("does NOT call createTransfer for KARMA", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [karmaRecord({ id: "sr_karma" })],
    })
    await reconcileSettlementRecord(
      karmaRecord({ id: "sr_karma" }),
      hawala,
      assetGraph
    )
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })

  it("stamps karma_event_id and reconciler_result on the settlement record", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [karmaRecord({ id: "sr_karma" })],
    })
    await reconcileSettlementRecord(
      karmaRecord({ id: "sr_karma" }),
      hawala,
      assetGraph
    )
    expect(assetGraph.records.sr_karma.metadata?.karma_event_id).toBe("ke_1")
    expect(assetGraph.records.sr_karma.metadata?.reconciler_result).toBe(
      "settled_karma"
    )
  })

  it("idempotency: skips event creation when one with the same source_id already exists", async () => {
    const hawala = buildFakeHawala({
      existingKarmaEvents: [{ id: "ke_existing", source_id: "sr_karma" }],
    })
    const assetGraph = buildFakeAssetGraph({
      records: [karmaRecord({ id: "sr_karma" })],
    })

    const result = await reconcileSettlementRecord(
      karmaRecord({ id: "sr_karma" }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("settled_karma")
    if (result.status !== "settled_karma") return
    expect(result.karma_event_id).toBe("ke_existing")
    expect(hawala.createKarmaEvents).not.toHaveBeenCalled()
  })

  it("fails cleanly when karma_reason is missing from metadata", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [karmaRecord({ id: "sr_karma_no_reason", metadata: {} })],
    })
    const result = await reconcileSettlementRecord(
      karmaRecord({ id: "sr_karma_no_reason", metadata: {} }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("failed")
    if (result.status !== "failed") return
    expect(result.error).toMatch(/karma_reason/)
  })
})

// ── GIFT tests ──────────────────────────────────────────────────────

describe("reconcileSettlementRecord — GIFT (audit-only)", () => {
  const giftRecord = (overrides: Partial<ReconcilerSettlementRecord> = {}) =>
    baseRecord({
      manifest_slug: "yard-scrap-nursery",
      rail: "gift",
      asset_code: "GIFT",
      amount_minor: 0,
      metadata: { note: "member-rate donation" },
      ...overrides,
    })

  it("does not call hawala-ledger at all", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [giftRecord({ id: "sr_gift" })],
    })

    const result = await reconcileSettlementRecord(
      giftRecord({ id: "sr_gift" }),
      hawala,
      assetGraph
    )
    expect(result.status).toBe("settled_gift")
    expect(hawala.createTransfer).not.toHaveBeenCalled()
    expect(hawala.createKarmaEvents).not.toHaveBeenCalled()
    expect(hawala.listLedgerAccounts).not.toHaveBeenCalled()
  })

  it("stamps reconciled_at and reconciler_result=gift_audit_only", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [giftRecord({ id: "sr_gift" })],
    })
    await reconcileSettlementRecord(
      giftRecord({ id: "sr_gift" }),
      hawala,
      assetGraph
    )
    expect(assetGraph.records.sr_gift.metadata?.reconciled_at).toBeDefined()
    expect(assetGraph.records.sr_gift.metadata?.reconciler_result).toBe(
      "gift_audit_only"
    )
  })

  it("preserves caller metadata when stamping reconciled_at", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph({
      records: [giftRecord({ id: "sr_gift" })],
    })
    await reconcileSettlementRecord(
      giftRecord({ id: "sr_gift" }),
      hawala,
      assetGraph
    )
    expect(assetGraph.records.sr_gift.metadata?.note).toBe("member-rate donation")
  })
})

// ── already-reconciled tests ────────────────────────────────────────

describe("reconcileSettlementRecord — already-reconciled short-circuit", () => {
  it("skips when ledger_entry_id is already set", async () => {
    const hawala = buildFakeHawala({
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph()
    const record = baseRecord({ ledger_entry_id: "le_existing" })

    const result = await reconcileSettlementRecord(record, hawala, assetGraph)
    expect(result.status).toBe("skipped_already_reconciled")
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })

  it("skips when metadata.reconciled_at is set (GIFT or stale partial)", async () => {
    const hawala = buildFakeHawala()
    const assetGraph = buildFakeAssetGraph()
    const record = baseRecord({
      rail: "gift",
      metadata: { reconciled_at: "2026-05-13T00:00:00Z" },
    })

    const result = await reconcileSettlementRecord(record, hawala, assetGraph)
    expect(result.status).toBe("skipped_already_reconciled")
  })
})

// ── reconcileAllUnsettled batch loop ────────────────────────────────

describe("reconcileAllUnsettled", () => {
  it("processes every unsettled record and returns one result per record", async () => {
    const hawala = buildFakeHawala({
      accounts: [
        ...accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
        ...accountsFor(["mem_c", "mem_d"], "TIME_BANK", "HRS"),
      ],
    })
    const assetGraph = buildFakeAssetGraph({
      records: [
        baseRecord({
          id: "sr_ccr",
          rail: "ccr",
          asset_code: "CCR",
          metadata: { order_id: "o1" },
        }),
        baseRecord({
          id: "sr_hrs",
          rail: "hours",
          asset_code: "HRS",
          from_member_id: "mem_c",
          to_member_id: "mem_d",
          amount_minor: 250,
          metadata: {
            reference_type: "TIMEBANK_LOAN",
            reference_id: "loan_1",
          },
        }),
        baseRecord({
          id: "sr_gift",
          rail: "gift",
          asset_code: "GIFT",
          amount_minor: 0,
        }),
      ],
    })

    const results = await reconcileAllUnsettled(hawala, assetGraph)
    expect(results).toHaveLength(3)
    const byId = Object.fromEntries(results.map((r) => [r.record_id, r.status]))
    expect(byId.sr_ccr).toBe("settled_ledger")
    expect(byId.sr_hrs).toBe("settled_ledger")
    expect(byId.sr_gift).toBe("settled_gift")
  })

  it("continues past a failed record", async () => {
    const hawala = buildFakeHawala({
      // Only CCR accounts; HRS reconciliation will fail.
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [
        baseRecord({
          id: "sr_hrs_fail",
          rail: "hours",
          asset_code: "HRS",
          metadata: {
            reference_type: "TIMEBANK_LOAN",
            reference_id: "loan_1",
          },
        }),
        baseRecord({
          id: "sr_ccr_ok",
          rail: "ccr",
          asset_code: "CCR",
          metadata: { order_id: "o1" },
        }),
      ],
    })

    const results = await reconcileAllUnsettled(hawala, assetGraph)
    expect(results).toHaveLength(2)
    const byId = Object.fromEntries(results.map((r) => [r.record_id, r.status]))
    expect(byId.sr_hrs_fail).toBe("failed")
    expect(byId.sr_ccr_ok).toBe("settled_ledger")
  })

  it("filters to ledger_entry_id: null when listing", async () => {
    const hawala = buildFakeHawala({
      accounts: accountsFor(["mem_a", "mem_b"], "USER_WALLET", "CCR"),
    })
    const assetGraph = buildFakeAssetGraph({
      records: [baseRecord({ metadata: { order_id: "o1" } })],
    })

    await reconcileAllUnsettled(hawala, assetGraph)
    expect(assetGraph.listSettlementRecords).toHaveBeenCalledWith({
      ledger_entry_id: null,
    })
  })
})
