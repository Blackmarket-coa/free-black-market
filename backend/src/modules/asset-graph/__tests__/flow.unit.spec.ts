/**
 * End-to-end flow wiring test.
 *
 * Per-layer unit tests already cover each step in isolation. This
 * test stitches them together to catch drift between the layers —
 * the kind of bug where one method produces a payload shape that the
 * next consumer happens to mis-parse, but neither test catches it
 * because each layer's contract is satisfied locally.
 *
 * Scenario walked through:
 *
 *   1. Two members declare assets (via `createDeclarationFor`):
 *        - mem_op declares skill.horticulture + recurring time +
 *          truck + land + the operator-produced output capacities
 *        - mem_household declares yard-scrap output capacity
 *      Manifest: yard-scrap-nursery. Both real declarations pass
 *      attribute-schema validation.
 *
 *   2. The matcher runs against the in-memory pool
 *      (`runMatchManifest`) — confirms the nursery manifest is
 *      satisfied and that mem_op is the candidate operator.
 *
 *   3. `proposalsFromReport` builds proposals. The first proposal
 *      (one per candidate operator) is then "accepted" by simulating
 *      the storefront accept-proposal call. The fake service writes
 *      a ProjectInstance with the right manifest_slug, operator,
 *      and member_ids (deduped union of operator + declaration
 *      owners in the proposal).
 *
 *   4. The instance emits a SettlementRecord (`emitSettlementRecord`).
 *      Rail validation runs against the manifest's `settlement_rails`.
 *      The record is written with `ledger_entry_id: null` and the
 *      caller's idempotency_key.
 *
 *   5. The reconciler (`reconcileSettlementRecord`) consumes the
 *      unsettled record. The fake hawala layer's `listLedgerAccounts`
 *      finds the from/to accounts; `createTransfer` writes a ledger
 *      entry with the right `idempotency_key` (`settlement-${sr_id}`).
 *      The reconciler stamps `ledger_entry_id` on the SettlementRecord.
 *
 *   6. Re-running the reconciler is idempotent — the second call
 *      short-circuits via `metadata.reconciled_at`.
 *
 * If any layer's input/output contract drifts, this test catches it.
 */

import AssetGraphService from "../service"
import { matchManifest, proposalsFromReport } from "../matcher"
import {
  reconcileSettlementRecord,
  type ReconcilerSettlementRecord,
  type ReconcilerHawalaSurface,
  type ReconcilerAssetGraphSurface,
} from "../reconciler"
import { YARD_SCRAP_NURSERY_MANIFEST as NURSERY } from "../manifests/yard-scrap-nursery"

type FakeDecl = {
  id: string
  member_id: string
  kind_slug: string
  attributes: Record<string, unknown>
  sensitivity_tier: string
  lifecycle: string
  governance_model: string
  availability: Record<string, unknown> | null
  geography: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  revoked_at: Date | null
}

type FakeInstance = {
  id: string
  manifest_slug: string
  operator_member_id: string
  member_ids: string[]
  state: string
}

type FakeSettlementRecord = ReconcilerSettlementRecord

const buildFakeAssetGraph = () => {
  const declarations: Record<string, FakeDecl> = {}
  const instances: Record<string, FakeInstance> = {}
  const settlementRecords: Record<string, FakeSettlementRecord> = {}

  const inst = Object.create(AssetGraphService.prototype)

  inst.createAssetDeclarations = jest.fn(async (payload: any) => {
    const id = `decl_${Object.keys(declarations).length + 1}`
    const row: FakeDecl = {
      id,
      member_id: payload.member_id,
      kind_slug: payload.kind_slug,
      attributes: payload.attributes,
      sensitivity_tier: payload.sensitivity_tier,
      lifecycle: payload.lifecycle,
      governance_model: payload.governance_model,
      availability: payload.availability,
      geography: payload.geography,
      metadata: payload.metadata,
      revoked_at: null,
    }
    declarations[id] = row
    return row
  })
  inst.listAssetDeclarations = jest.fn(async (filter: any) => {
    const all = Object.values(declarations)
    if (!filter) return all
    return all.filter((d) => {
      if (filter.member_id && d.member_id !== filter.member_id) return false
      if (filter.revoked_at === null && d.revoked_at !== null) return false
      if (Array.isArray(filter.id) && !filter.id.includes(d.id)) return false
      return true
    })
  })
  inst.createProjectInstances = jest.fn(async (payload: any) => {
    const id = `pi_${Object.keys(instances).length + 1}`
    const row: FakeInstance = { id, ...payload }
    instances[id] = row
    return row
  })
  inst.createSettlementRecords = jest.fn(async (payload: any) => {
    const id = `sr_${Object.keys(settlementRecords).length + 1}`
    const row: FakeSettlementRecord = { id, ...payload }
    settlementRecords[id] = row
    return row
  })
  inst.listSettlementRecords = jest.fn(async (filter: any) => {
    const all = Object.values(settlementRecords)
    if (!filter) return all
    return all.filter((r) => {
      if (filter.idempotency_key !== undefined) {
        return (r as any).idempotency_key === filter.idempotency_key
      }
      if (filter.ledger_entry_id === null) {
        return r.ledger_entry_id === null
      }
      return true
    })
  })
  inst.updateSettlementRecords = jest.fn(async (payload: any) => {
    if (!settlementRecords[payload.id]) {
      throw new Error(`No record ${payload.id}`)
    }
    settlementRecords[payload.id] = {
      ...settlementRecords[payload.id],
      ...payload,
    }
    return settlementRecords[payload.id]
  })

  return {
    service: inst as AssetGraphService,
    declarations,
    instances,
    settlementRecords,
  }
}

const buildFakeHawalaSurface = (
  fixtures: { fromMember: string; toMember: string }
): ReconcilerHawalaSurface => {
  const accounts = [
    {
      id: `acct_USD_${fixtures.fromMember}`,
      owner_id: fixtures.fromMember,
      owner_type: "CUSTOMER",
      account_type: "USER_WALLET",
      currency_code: "USD",
    },
    {
      id: `acct_USD_${fixtures.toMember}`,
      owner_id: fixtures.toMember,
      owner_type: "CUSTOMER",
      account_type: "USER_WALLET",
      currency_code: "USD",
    },
  ]
  const transfers: Array<{ id: string; idempotency_key?: string }> = []

  return {
    listLedgerAccounts: jest.fn(async (filter: any) => {
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
    listKarmaEvents: jest.fn(async () => []),
    createKarmaEvents: jest.fn(async () => ({ id: "ke_unused" })),
  } as any
}

describe("end-to-end flow: declare → match → accept → emit → reconcile", () => {
  it("walks the full lifecycle through the yard-scrap nursery manifest", async () => {
    const operator = "mem_op"
    const household = "mem_household"
    const fakes = buildFakeAssetGraph()
    const { service } = fakes

    // ── 1. Declarations via createDeclarationFor ─────────────────
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "land.yard.residential",
      attributes: { acreage: 0.5, soil_tested: true },
    })
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "skill.horticulture",
      attributes: { years_experience: 5 },
    })
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "tool.vehicle.truck",
      attributes: { has_hitch: true },
    })
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "time.recurring",
      attributes: { hours_per_week: 25 },
    })
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "output-capacity.compost",
      attributes: { cubic_yards_per_month: 5 },
    })
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "output-capacity.vermicast",
      attributes: { lbs_per_month: 30 },
    })
    await service.createDeclarationFor({
      member_id: operator,
      kind_slug: "output-capacity.plant-plug",
      attributes: { plugs_per_month: 200 },
    })
    await service.createDeclarationFor({
      member_id: household,
      kind_slug: "output-capacity.yard-scrap",
      attributes: { cubic_yards_per_month: 1 },
    })

    expect(Object.keys(fakes.declarations)).toHaveLength(8)

    // ── 2. Matcher runs against the in-memory pool ───────────────
    const declarationPool = Object.values(fakes.declarations).map((d) => ({
      id: d.id,
      member_id: d.member_id,
      kind_slug: d.kind_slug,
      attributes: d.attributes,
      lifecycle: d.lifecycle,
      revoked_at: d.revoked_at,
    }))
    const report = matchManifest(NURSERY, declarationPool)
    expect(report.satisfied).toBe(true)
    const opCandidates = report.candidate_operators.map((o) => o.member_id)
    expect(opCandidates).toContain(operator)
    expect(opCandidates).not.toContain(household)

    // ── 3. Build proposals + simulate accept ──────────────────────
    const proposals = proposalsFromReport(report)
    expect(proposals).toHaveLength(1)
    const proposal = proposals[0]
    expect(proposal.member_id).toBe(operator)
    expect(proposal.manifest_slug).toBe("yard-scrap-nursery")
    expect(proposal.score).toBe(1) // satisfied
    expect(proposal.state).toBe("pending")

    // Accept: write the ProjectInstance directly. (acceptProposal's
    // service path queries listAssetDeclarations({ id: [...] }) for
    // the declaration owners. The fake supports that filter.)
    const linkedDecls = (await service.listAssetDeclarations(
      { id: proposal.declaration_ids } as any,
      { take: null } as any
    )) as Array<{ id: string; member_id: string }>
    expect(linkedDecls.length).toBe(8)

    const memberIds = Array.from(
      new Set([proposal.member_id, ...linkedDecls.map((d) => d.member_id)])
    ).sort()
    const instance = await service.createProjectInstances({
      manifest_slug: proposal.manifest_slug,
      operator_member_id: proposal.member_id,
      member_ids: memberIds,
      state: "active",
    } as any)
    expect(instance.operator_member_id).toBe(operator)
    expect(instance.member_ids).toEqual([household, operator]) // sorted
    expect(instance.state).toBe("active")

    // ── 4. Instance emits a SettlementRecord ──────────────────────
    // Scenario: an FBM retail customer pays the operator for a flat
    // of plants. The nursery manifest allows the `usd` rail.
    const fbmCustomer = "mem_customer"
    const settlementRecord: any = await service.emitSettlementRecord({
      project_instance_id: instance.id,
      manifest: NURSERY,
      rail: "usd",
      amount_minor: 1250, // $12.50
      asset_code: "USD",
      from_member_id: fbmCustomer,
      to_member_id: operator,
      occurred_at: new Date("2026-07-04T12:00:00Z"),
      idempotency_key: "yard-scrap-nursery-order_42",
    })
    expect(settlementRecord.manifest_slug).toBe("yard-scrap-nursery")
    expect(settlementRecord.project_instance_id).toBe(instance.id)
    expect(settlementRecord.ledger_entry_id).toBeNull()
    expect(settlementRecord.idempotency_key).toBe(
      "yard-scrap-nursery-order_42"
    )

    // Idempotent re-emit returns the same row, doesn't write a duplicate.
    const reEmit: any = await service.emitSettlementRecord({
      project_instance_id: instance.id,
      manifest: NURSERY,
      rail: "usd",
      amount_minor: 1250,
      asset_code: "USD",
      from_member_id: fbmCustomer,
      to_member_id: operator,
      occurred_at: new Date("2026-07-04T12:00:00Z"),
      idempotency_key: "yard-scrap-nursery-order_42",
    })
    expect(reEmit.id).toBe(settlementRecord.id)
    expect(Object.keys(fakes.settlementRecords)).toHaveLength(1)

    // ── 5. Reconciler consumes the unsettled record ───────────────
    const hawala = buildFakeHawalaSurface({
      fromMember: fbmCustomer,
      toMember: operator,
    })
    const reconcilerAssetGraph: ReconcilerAssetGraphSurface = {
      listSettlementRecords: async (filter: any) => {
        return (await (service as any).listSettlementRecords(
          filter
        )) as FakeSettlementRecord[]
      },
      updateSettlementRecords: async (payload: any) => {
        return (await (service as any).updateSettlementRecords(
          payload
        )) as FakeSettlementRecord
      },
    }

    const result = await reconcileSettlementRecord(
      fakes.settlementRecords[settlementRecord.id],
      hawala,
      reconcilerAssetGraph
    )
    expect(result.status).toBe("settled_ledger")
    if (result.status !== "settled_ledger") return

    // The settlement record now carries the ledger_entry_id stamped
    // by the reconciler.
    const updated = fakes.settlementRecords[settlementRecord.id]
    expect(updated.ledger_entry_id).toBe(result.ledger_entry_id)
    expect(updated.metadata?.reconciled_at).toBeDefined()
    expect(updated.metadata?.reconciler_result).toBe("settled_ledger")

    // Idempotency keys on both ends — the ledger entry's
    // idempotency_key is derived from the settlement record id, so
    // re-running the reconciler returns the same ledger entry.
    const transferArgs = (hawala.createTransfer as jest.Mock).mock.calls[0][0]
    expect(transferArgs.idempotency_key).toBe(`settlement-${settlementRecord.id}`)

    // ── 6. Re-running the reconciler is a no-op ──────────────────
    const secondPass = await reconcileSettlementRecord(
      fakes.settlementRecords[settlementRecord.id],
      hawala,
      reconcilerAssetGraph
    )
    expect(secondPass.status).toBe("skipped_already_reconciled")
    // No new transfer attempted.
    expect((hawala.createTransfer as jest.Mock).mock.calls).toHaveLength(1)
  })
})
