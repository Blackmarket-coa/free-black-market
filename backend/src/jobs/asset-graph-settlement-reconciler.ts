import { createLogger } from "../shared/logger"
const log = createLogger("jobs/asset-graph-settlement-reconciler")
import { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import { ASSET_GRAPH_MODULE } from "../modules/asset-graph"
import { reconcileAllUnsettled } from "../modules/asset-graph/reconciler"

/**
 * Cross-module reconciler: reads unsettled `SettlementRecord` rows
 * (those with `ledger_entry_id: null` and no `metadata.reconciled_at`)
 * and routes each to its rail's terminal write in hawala-ledger.
 *
 *   CCR / USDC / USD / HRS → `hawala-ledger.createTransfer` between
 *                            the from/to members' ledger accounts.
 *                            The SettlementRecord gets `ledger_entry_id`
 *                            stamped.
 *
 *   KARMA                  → `hawala-ledger.createKarmaEvents` (no
 *                            counterparty; karma is unilateral). The
 *                            record's `metadata.karma_event_id`
 *                            carries the produced event id.
 *
 *   GIFT                   → audit-only; the record's
 *                            `metadata.reconciled_at` is stamped.
 *
 * The per-record logic lives in
 * `backend/src/modules/asset-graph/reconciler.ts` so it's testable
 * with fake services; this job is the thin scheduled wrapper.
 *
 * Idempotency: `createTransfer` uses `settlement-${record.id}` as
 * its idempotency_key, so re-runs return the existing entry. KARMA
 * paths check for an existing event keyed by source_id before
 * creating. GIFT paths short-circuit on `metadata.reconciled_at`.
 *
 * Failures are recorded per-record (returned in the result list)
 * and surfaced via console log; the job never throws on individual
 * record failure so a single bad record can't block the batch.
 */
export default async function assetGraphSettlementReconcilerJob(
  container: MedusaContainer
): Promise<void> {
  const hawala: any = container.resolve(HAWALA_LEDGER_MODULE)
  const assetGraph: any = container.resolve(ASSET_GRAPH_MODULE)

  log.info("[asset-graph-reconciler] Starting unsettled-record sweep")

  const results = await reconcileAllUnsettled(hawala, assetGraph)

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  log.info(
    `[asset-graph-reconciler] Processed ${results.length} records: ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
  )

  const failures = results.filter((r) => r.status === "failed")
  for (const f of failures) {
    log.error(
      `[asset-graph-reconciler] FAILED ${f.record_id}: ${
        (f as { error: string }).error
      }`
    )
  }
}

export const config = {
  name: "asset-graph-settlement-reconciler",
  // Run every 15 minutes. Cheap enough to be near-real-time but
  // batch-friendly. Operators can tune later if record volume grows.
  schedule: "*/15 * * * *",
}
