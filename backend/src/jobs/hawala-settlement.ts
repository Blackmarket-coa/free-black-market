import { createLogger } from "../shared/logger"
const log = createLogger("jobs/hawala-settlement")
import { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import {
  createStellarSettlementService,
  stellarMetrics,
} from "../modules/hawala-ledger/stellar-settlement"
import { selectSettlementRail } from "../modules/hawala-ledger/dual-rail-selector"
import { getBridgeHealth } from "../modules/hawala-ledger/health"
import { runQueueConsumer } from "../shared/queue-runtime"
import { requeueWithBackoff } from "../shared/queue-requeue-adapter"
import { emitLedgerUsdcConverted } from "../lib/blackout-stub-emitters"
import { buildUsdcConvertedArgs } from "../lib/blackout-wire-helpers"

/**
 * Scheduled job that creates settlement batches and anchors to Stellar
 * Runs daily at midnight UTC
 */
export default async function hawalaSettlementJob(container: MedusaContainer) {
  const hawalaService = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  log.info("[Hawala Settlement] Starting daily settlement batch...")

  const publishToDlq = async (message: any) => {
    log.error("[Hawala Settlement][DLQ]", JSON.stringify(message))
  }
  const requeue = async (message: any, delaySeconds: number) => {
    await requeueWithBackoff(message, delaySeconds)
  }


  try {
    // Get unsettled entries from the last 24 hours
    const entries = await hawalaService.listLedgerEntries({
      status: "COMPLETED",
    })

    // Filter to only unsettled entries
    const unsettledEntries = entries.filter(e => !e.settlement_batch_id)

    if (unsettledEntries.length === 0) {
      log.info("[Hawala Settlement] No unsettled entries found")
      return
    }

    log.info(`[Hawala Settlement] Found ${unsettledEntries.length} unsettled entries`)

    // Calculate totals
    const totalVolume = unsettledEntries.reduce((sum, e) => sum + Number(e.amount), 0)

    // Generate batch number
    const existingBatches = await hawalaService.listSettlementBatches({})
    const batchNumber = existingBatches.length + 1

    // Create batch record
    const periodEnd = new Date()
    const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000)

    const batch = await hawalaService.createSettlementBatches({
      batch_number: batchNumber,
      period_start: periodStart,
      period_end: periodEnd,
      total_entries: unsettledEntries.length,
      total_volume: totalVolume,
      status: "PENDING",
    })

    log.info(`[Hawala Settlement] Created batch #${batchNumber}`)

    const invoiceEvent = {
      invoice_id: `settlement-${batch.id}`,
      order_id: batch.id,
      status: "issued" as const,
      total: Math.round(totalVolume * 100),
      currency_code: "USD",
      issued_at: new Date().toISOString(),
    }

    const result = await runQueueConsumer({
      topicKey: "invoice_issuance",
      payload: invoiceEvent,
      idempotencyKey: invoiceEvent.invoice_id,
      handler: async () => {
        // Dual-rail selection: pick Stripe-ACH vs Stellar-USDC based on
        // bridge health and amount. Stripe-ACH leg is intentionally
        // out of scope here; the selector logs the decision so ops can
        // see why Stellar was (or was not) chosen.
        const stellarService = createStellarSettlementService()
        const lastBatch = existingBatches[existingBatches.length - 1]
        const lastBatchStatus = lastBatch
          ? lastBatch.status === "FAILED"
            ? "failed" as const
            : lastBatch.status === "PENDING"
              ? "pending" as const
              : "succeeded" as const
          : "unknown" as const
        const health = await getBridgeHealth({
          service: stellarService,
          lastBatchStatus,
        })
        const decision = selectSettlementRail({
          amount: totalVolume,
          currency: "USDC",
          health,
        })
        stellarMetrics.inc("stellar.dual_rail_decision", {
          rail: decision.rail,
          batch_id: batch.id,
        })
        log.info(
          `[Hawala Settlement] Dual-rail decision: ${decision.rail} (` +
            decision.reasons.map((r) => `${r.check}=${r.outcome}`).join(", ") +
            `)`
        )

        if (decision.rail === "stripe_ach") {
          // This batch is left PENDING for manual Stripe-ACH action. Emit an
          // alert so ops don't silently let it sit unsettled.
          stellarMetrics.inc("hawala.settlement_pending_manual", {
            batch_id: batch.id,
          })
          log.warn(
            "[Hawala Settlement] Batch left PENDING for manual Stripe-ACH action",
            JSON.stringify({
              batch_id: batch.id,
              batch_number: batchNumber,
              total_volume: totalVolume,
              total_entries: unsettledEntries.length,
              dual_rail_reasons: decision.reasons,
            })
          )
          await hawalaService.updateSettlementBatches({
            id: batch.id,
            status: "PENDING",
            metadata: {
              dual_rail_decision: "stripe_ach",
              dual_rail_reasons: decision.reasons,
              note: "Stripe-ACH leg pending operator action; Stellar bridge skipped",
            },
          })
          return
        }

        let stellarResult
        try {
          stellarResult = await stellarService.submitSettlementBatch({
            batchId: batch.id,
            entries: unsettledEntries.map(e => ({
              id: e.id,
              amount: Number(e.amount),
              debit_account_id: e.debit_account_id,
              credit_account_id: e.credit_account_id,
              created_at: new Date(e.created_at),
            })),
            periodStart,
            periodEnd,
          })
        } catch (submitError) {
          // Move the batch to a terminal FAILED state with the error recorded
          // before rethrowing, so it never lingers in PENDING after a Stellar
          // submission failure.
          const errorMessage =
            submitError instanceof Error ? submitError.message : String(submitError)
          stellarMetrics.inc("hawala.settlement_failed", { batch_id: batch.id })
          log.error(
            `[Hawala Settlement] Stellar submission failed for batch #${batchNumber}:`,
            errorMessage
          )
          await hawalaService.updateSettlementBatches({
            id: batch.id,
            status: "FAILED" as const,
            error_message: errorMessage,
            metadata: {
              error: errorMessage,
              failed_stage: "stellar_submit",
              // failed_at lives in metadata (no dedicated model column,
              // symmetric with confirmed_at conceptually).
              failed_at: new Date().toISOString(),
            },
          })
          throw submitError
        }

        // Update batch with Stellar info
        await hawalaService.updateSettlementBatches({
          id: batch.id,
          merkle_root: stellarResult.merkleRoot,
          stellar_tx_hash: stellarResult.txHash,
          stellar_ledger_sequence: stellarResult.ledgerSequence,
          stellar_fee_paid: stellarResult.feePaid,
          status: "CONFIRMED" as const,
          confirmed_at: new Date(),
        })

        // Update all entries with batch reference
        for (const entry of unsettledEntries) {
          await hawalaService.updateLedgerEntries({
            id: entry.id,
            settlement_batch_id: batch.id,
            status: "SETTLED" as const,
            settled_at: new Date(),
          })
        }

        // §3 Blackout `ledger.usdc_converted` — for each settled entry that
        // represents a vendor's per-order proceeds now anchored as USDC on
        // Stellar, notify the vendor's Blackout identity. Non-vendor legs
        // (platform/system/customer) and entries without order context are
        // skipped by the arg-builder. Fire-and-forget: a webhook hiccup must
        // never fail the settlement batch.
        try {
          const creditAccountIds = Array.from(
            new Set(unsettledEntries.map((e) => e.credit_account_id).filter(Boolean))
          )
          const creditAccounts = creditAccountIds.length
            ? await hawalaService.listLedgerAccounts({ id: creditAccountIds })
            : []
          const accountById = new Map<
            string,
            { id: string; owner_type?: string | null; owner_id?: string | null }
          >(
            creditAccounts.map(
              (a: { id: string; owner_type?: string | null; owner_id?: string | null }) => [
                a.id,
                a,
              ]
            )
          )
          for (const entry of unsettledEntries) {
            const emitArgs = buildUsdcConvertedArgs({
              entry: {
                id: entry.id,
                order_id: entry.order_id,
                amount: Number(entry.amount),
                currency_code: entry.currency_code,
              },
              creditAccount: accountById.get(entry.credit_account_id),
              ledgerTxId: stellarResult.txHash,
            })
            if (emitArgs) {
              await emitLedgerUsdcConverted(container, emitArgs)
            }
          }
        } catch (emitErr) {
          log.error(
            "[Hawala Settlement] ledger.usdc_converted emit failed",
            emitErr instanceof Error ? emitErr.message : emitErr
          )
        }

        log.info(`[Hawala Settlement] Batch #${batchNumber} anchored to Stellar:`)
        log.info(`  - TX Hash: ${stellarResult.txHash}`)
        log.info(`  - Merkle Root: ${stellarResult.merkleRoot}`)
        log.info(`  - Entries: ${unsettledEntries.length}`)
        log.info(`  - Volume: $${totalVolume.toFixed(2)}`)
      },
      publishToDlq,
      requeue,
    })

    if (result.status !== "processed") {
      await hawalaService.updateSettlementBatches({
        id: batch.id,
        status: "FAILED",
        metadata: {
          queue_status: result.status,
          retries: result.retries,
          error: result.error,
        },
      })
    }
  } catch (error) {
    log.error("[Hawala Settlement] Settlement job failed:", error)
  }
}

export const config = {
  name: "hawala-daily-settlement",
  schedule: "0 0 * * *", // Daily at midnight UTC
}
