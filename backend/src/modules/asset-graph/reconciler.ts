/**
 * Settlement reconciler.
 *
 * Reads `SettlementRecord` rows with `ledger_entry_id: null` (the
 * "unsettled" marker emitted by `settlement.ts`) and routes each one
 * to its rail's terminal write:
 *
 *   CCR / USDC / USD   → hawala-ledger `createTransfer` between the
 *                        from/to members' ledger accounts. Stamps
 *                        `ledger_entry_id` on the SettlementRecord.
 *
 *   HRS                → hawala-ledger `createTransfer` between the
 *                        members' TIME_BANK accounts with the time-
 *                        bank reference vocabulary already carried in
 *                        the record's metadata. Stamps
 *                        `ledger_entry_id`.
 *
 *   KARMA              → hawala-ledger `recordKarmaEvent` (no double-
 *                        entry; karma is unilateral). The settlement
 *                        record's `metadata.karma_event_id` carries
 *                        the produced event id.
 *
 *   GIFT               → audit-only. The reconciler marks
 *                        `metadata.reconciled_at` (and
 *                        `metadata.reconciler_result: "gift_audit_only"`)
 *                        without writing to hawala-ledger.
 *
 * Idempotency:
 *
 *   - `createTransfer` accepts an `idempotency_key`; the reconciler
 *     uses `settlement-${settlement_record_id}`. A second
 *     reconciliation of the same record returns the existing entry
 *     instead of double-writing.
 *
 *   - Karma idempotency is owned by the canonical write path (W4):
 *     `recordKarmaEvent` re-reads by
 *     `source_module: "asset_graph", source_id: settlement_record_id`
 *     and the partial unique index backstops the race.
 *
 *   - GIFT records are detected by the presence of
 *     `metadata.reconciled_at` and skipped on re-run.
 *
 * Member → ledger-account mapping is via
 * `listLedgerAccounts({ owner_id, account_type, currency_code })`.
 * For v0.1, `owner_type` defaults to `"CUSTOMER"` — the BMC-member-
 * to-ledger-owner mapping is a v0.2 question the entitlement
 * workstream will own.
 *
 * The reconciler is structured for testability: the per-record
 * function `reconcileSettlementRecord` takes the services as
 * parameters, returns a typed result, and never throws on
 * per-record failures (it captures the error in the result so the
 * batch can continue). The scheduled job
 * (`backend/src/jobs/asset-graph-settlement-reconciler.ts`) is the
 * thin wrapper that resolves services and iterates.
 */

import type { SettlementRailT } from "./manifests/types"
import {
  RAIL_CODE_BY_MANIFEST_RAIL,
  RAIL_REGISTRY,
  type RailCode,
} from "../hawala-ledger/rails"

/**
 * Minimal SettlementRecord shape the reconciler reads. The DB model
 * has more fields; this names only what the reconciler touches so the
 * function is testable with fixtures.
 */
export type ReconcilerSettlementRecord = {
  id: string
  manifest_slug: string
  project_instance_id: string | null
  ledger_entry_id: string | null
  rail: SettlementRailT
  from_member_id: string
  to_member_id: string
  amount_minor: number
  asset_code: string
  occurred_at: Date
  metadata: Record<string, unknown> | null
}

/** Hawala-ledger surface the reconciler depends on. */
export type ReconcilerHawalaSurface = {
  listLedgerAccounts: (filter: {
    owner_id?: string
    owner_type?: string
    account_type?: string
    currency_code?: string
  }) => Promise<Array<{ id: string; currency_code: string; account_type: string }>>
  createTransfer: (data: {
    debit_account_id: string
    credit_account_id: string
    amount: number
    entry_type: string
    description?: string
    reference_type?: string
    reference_id?: string
    order_id?: string
    idempotency_key?: string
    metadata?: Record<string, unknown>
  }) => Promise<{ id: string }>
  /**
   * The canonical karma write path (W4): validated against the source
   * registry, idempotent per (source_module, source_id), attested at write.
   */
  recordKarmaEvent: (input: {
    member_id: string
    delta: number
    reason: string
    source_module?: string | null
    source_id?: string | null
    occurred_at?: Date | string
    metadata?: Record<string, unknown> | null
  }) => Promise<{ event: { id: string }; created: boolean }>
}

/** Asset-graph surface the reconciler depends on. */
export type ReconcilerAssetGraphSurface = {
  listSettlementRecords: (filter: {
    ledger_entry_id?: null
  }) => Promise<ReconcilerSettlementRecord[]>
  updateSettlementRecords: (
    payload: {
      id: string
      ledger_entry_id?: string | null
      metadata?: Record<string, unknown>
    }
  ) => Promise<ReconcilerSettlementRecord>
}

export type ReconcileResult =
  | { status: "settled_ledger"; record_id: string; ledger_entry_id: string }
  | { status: "settled_karma"; record_id: string; karma_event_id: string }
  | { status: "settled_gift"; record_id: string }
  | { status: "skipped_already_reconciled"; record_id: string }
  | { status: "failed"; record_id: string; error: string }

/**
 * Owner-type used when looking up a ledger account for a member.
 * BMC members aren't a first-class owner_type today — CUSTOMER is
 * the closest analog. The entitlement workstream (HANDOFF item 7)
 * owns the proper mapping; until then this constant is the bridge.
 */
const MEMBER_OWNER_TYPE = "CUSTOMER"

/**
 * Resolve the ledger entry_type label for a rail. Used as the
 * `entry_type` field on the hawala-ledger entry. Conventional names;
 * downstream reporting groups by this.
 */
const entryTypeForRail = (rail: RailCode, refType: string | null): string => {
  switch (rail) {
    case "CCR":
      // CCR keeps the reference_type as the entry_type for symmetry with
      // the existing CCR flows (ORDER, REFUND, ESCROW_FUND, ...).
      return refType || "TRANSFER"
    case "HRS":
      return refType || "TIMEBANK_LOAN"
    case "USDC":
    case "USD":
      return refType || "TRANSFER"
    default:
      return "TRANSFER"
  }
}

/**
 * Reconcile one settlement record. Returns a typed result; never
 * throws on per-record failure so the job loop can continue.
 */
export const reconcileSettlementRecord = async (
  record: ReconcilerSettlementRecord,
  hawala: ReconcilerHawalaSurface,
  assetGraph: ReconcilerAssetGraphSurface
): Promise<ReconcileResult> => {
  // Already settled? Skip.
  if (record.ledger_entry_id) {
    return { status: "skipped_already_reconciled", record_id: record.id }
  }
  if (record.metadata?.reconciled_at) {
    return { status: "skipped_already_reconciled", record_id: record.id }
  }

  try {
    const code: RailCode = RAIL_CODE_BY_MANIFEST_RAIL(record.rail)
    const def = RAIL_REGISTRY[code]
    const meta = record.metadata ?? {}

    if (code === "GIFT") {
      const updated = await assetGraph.updateSettlementRecords({
        id: record.id,
        metadata: {
          ...meta,
          reconciled_at: new Date().toISOString(),
          reconciler_result: "gift_audit_only",
        },
      })
      void updated
      return { status: "settled_gift", record_id: record.id }
    }

    if (code === "KARMA") {
      const reason = (meta as { karma_reason?: string }).karma_reason
      if (!reason) {
        return {
          status: "failed",
          record_id: record.id,
          error:
            "KARMA settlement missing karma_reason in metadata; cannot reconcile.",
        }
      }
      // The canonical write path (W4) owns idempotency (source-pair
      // pre-read + the partial unique index under the race) and stamps the
      // attestation; validation failures map to a failed record, same as
      // the missing-reason guard above.
      let event: { id: string }
      try {
        const recorded = await hawala.recordKarmaEvent({
          member_id: record.to_member_id,
          delta: record.amount_minor,
          reason,
          source_module: "asset_graph",
          source_id: record.id,
          occurred_at: record.occurred_at,
          metadata: {
            settlement_record_id: record.id,
            project_instance_id: record.project_instance_id,
          },
        })
        event = recorded.event
      } catch (error) {
        return {
          status: "failed",
          record_id: record.id,
          error: error instanceof Error ? error.message : String(error),
        }
      }

      await assetGraph.updateSettlementRecords({
        id: record.id,
        metadata: {
          ...meta,
          karma_event_id: event.id,
          reconciled_at: new Date().toISOString(),
          reconciler_result: "settled_karma",
        },
      })
      return {
        status: "settled_karma",
        record_id: record.id,
        karma_event_id: event.id,
      }
    }

    // Ledger-entry rails: CCR, USDC, USD, HRS.
    if (!def.account_type) {
      return {
        status: "failed",
        record_id: record.id,
        error: `Rail ${code} has no account_type in the registry but reached the ledger-entry branch — registry drift.`,
      }
    }

    const [fromAccts, toAccts] = await Promise.all([
      hawala.listLedgerAccounts({
        owner_id: record.from_member_id,
        owner_type: MEMBER_OWNER_TYPE,
        account_type: def.account_type,
        currency_code: def.unit,
      }),
      hawala.listLedgerAccounts({
        owner_id: record.to_member_id,
        owner_type: MEMBER_OWNER_TYPE,
        account_type: def.account_type,
        currency_code: def.unit,
      }),
    ])

    if (fromAccts.length === 0 || toAccts.length === 0) {
      return {
        status: "failed",
        record_id: record.id,
        error:
          `Missing ledger account for ${code}: from=${fromAccts.length}, to=${toAccts.length}. ` +
          `Provision a ${def.account_type} account with currency ${def.unit} for both members ` +
          `before reconciliation.`,
      }
    }

    const refType = (meta as { reference_type?: string }).reference_type ?? null
    const entry = await hawala.createTransfer({
      debit_account_id: fromAccts[0].id,
      credit_account_id: toAccts[0].id,
      amount: record.amount_minor,
      entry_type: entryTypeForRail(code, refType),
      description: `Asset-graph settlement ${record.id} for manifest ${record.manifest_slug}`,
      reference_type: refType ?? undefined,
      reference_id:
        (meta as { reference_id?: string }).reference_id ?? undefined,
      order_id: (meta as { order_id?: string }).order_id ?? undefined,
      idempotency_key: `settlement-${record.id}`,
      metadata: {
        settlement_record_id: record.id,
        manifest_slug: record.manifest_slug,
        project_instance_id: record.project_instance_id,
        rail: record.rail,
      },
    })

    await assetGraph.updateSettlementRecords({
      id: record.id,
      ledger_entry_id: entry.id,
      metadata: {
        ...meta,
        reconciled_at: new Date().toISOString(),
        reconciler_result: "settled_ledger",
      },
    })

    return {
      status: "settled_ledger",
      record_id: record.id,
      ledger_entry_id: entry.id,
    }
  } catch (err) {
    return {
      status: "failed",
      record_id: record.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Reconcile every unsettled SettlementRecord. Returns a per-record
 * result list so the job can log a summary; the function itself
 * never throws.
 */
export const reconcileAllUnsettled = async (
  hawala: ReconcilerHawalaSurface,
  assetGraph: ReconcilerAssetGraphSurface
): Promise<ReconcileResult[]> => {
  const unsettled = await assetGraph.listSettlementRecords({
    ledger_entry_id: null,
  })
  const results: ReconcileResult[] = []
  for (const record of unsettled) {
    results.push(await reconcileSettlementRecord(record, hawala, assetGraph))
  }
  return results
}
