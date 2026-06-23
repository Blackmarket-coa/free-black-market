import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createStellarSettlementService } from "../../../../modules/hawala-ledger/stellar-settlement"

/**
 * GET /admin/hawala/settlements
 * List settlement batches
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    status,
    limit = "50",
    offset = "0",
  } = req.query

  const queryFilters: Record<string, unknown> = {}
  if (status) queryFilters.status = status

  const batches = await hawalaService.listSettlementBatches(queryFilters)

  res.json({
    batches,
    count: batches.length,
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
  })
}

/**
 * POST /admin/hawala/settlements
 * Create a new settlement batch and submit to Stellar
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const { period_start, period_end } = req.body as {
    period_start?: string
    period_end?: string
  }

  try {
    // Get unsettled entries
    const entries = await hawalaService.listLedgerEntries({
      status: "COMPLETED",
      settlement_batch_id: null,
    })

    if (entries.length === 0) {
      return res.json({ message: "No unsettled entries found" })
    }

    // Calculate totals
    const totalVolume = entries.reduce((sum, e) => sum + Number(e.amount), 0)

    // Generate batch number
    const existingBatches = await hawalaService.listSettlementBatches({})
    const batchNumber = existingBatches.length + 1

    // Create batch record
    const batch = await hawalaService.createSettlementBatches({
      batch_number: batchNumber,
      period_start: period_start ? new Date(period_start) : new Date(Date.now() - 24 * 60 * 60 * 1000),
      period_end: period_end ? new Date(period_end) : new Date(),
      total_entries: entries.length,
      total_volume: totalVolume,
      status: "PENDING",
    })

    // Submit to Stellar
    let stellarResult: { txHash: string; ledgerSequence: number; feePaid: number; merkleRoot: string } | null = null
    try {
      const stellarService = createStellarSettlementService()
      stellarResult = await stellarService.submitSettlementBatch({
        batchId: batch.id,
        entries: entries.map(e => ({
          id: e.id,
          amount: Number(e.amount),
          debit_account_id: e.debit_account_id,
          credit_account_id: e.credit_account_id,
          created_at: new Date(e.created_at),
        })),
        periodStart: new Date(batch.period_start),
        periodEnd: new Date(batch.period_end),
      })

      // Update batch with Stellar info
      await hawalaService.updateSettlementBatches({
        id: batch.id,
        merkle_root: stellarResult!.merkleRoot,
        stellar_tx_hash: stellarResult!.txHash,
        stellar_ledger_sequence: stellarResult!.ledgerSequence,
        stellar_fee_paid: stellarResult!.feePaid,
        status: "CONFIRMED",
        confirmed_at: new Date(),
      })

      // Update entries with batch reference
      for (const entry of entries) {
        await hawalaService.updateLedgerEntries({
          id: entry.id,
          settlement_batch_id: batch.id,
          status: "SETTLED",
          settled_at: new Date(),
        })
      }
    } catch (stellarError) {
      // Mark batch as failed if Stellar submission fails
      await hawalaService.updateSettlementBatches({
        id: batch.id,
        status: "FAILED",
        metadata: { error: (stellarError as Error).message },
      })
    }

    res.status(201).json({
      batch: await hawalaService.retrieveSettlementBatch(batch.id),
      stellar: stellarResult,
      entries_count: entries.length,
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}
