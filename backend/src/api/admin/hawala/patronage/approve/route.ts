import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import { auditFinancialTransaction } from "../../../../../modules/hawala-ledger/audit-logger"
import {
  PatronageApprovalError,
  planApproval,
  summarisePeriod,
  type PatronageAllocationStore,
} from "../../../../../modules/hawala-ledger/patronage-review"

/**
 * POST /admin/hawala/patronage/approve
 *
 * The operator's explicit approval of one period's allocation table:
 * `computed → queued`. This is the review step `jobs/patronage-refund.ts`
 * already assumed existed.
 *
 * **Approving moves no money.** `queued` means "the operator has signed off on
 * these numbers"; `queued → paid` belongs to a disbursement rail that is not
 * built, and whose shape is a Posture A question — USD payout goes through the
 * payment processor, not through Stellar. Deliberately not automated here:
 * building an auto-disbursement into a review endpoint would remove the review.
 *
 * Idempotent by design. Re-approving a period queues whatever is still
 * `computed` and leaves the rest alone, so a retry after a partial failure
 * finishes the job. A period with nothing left to approve is a 409, not a
 * silent success.
 *
 * docs/TRANSMUTATION_STRATEGY.md §5.5, docs/POSTURE_A_COMPLIANCE.md.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PatronageAllocationStore>(HAWALA_LEDGER_MODULE)
  const { period_key } = (req.body ?? {}) as { period_key?: string }

  if (!period_key || typeof period_key !== "string") {
    return res.status(400).json({
      message: "period_key is required, e.g. \"2026-Q2\"",
      type: "invalid_data",
    })
  }

  const rows = (await service.listPatronageAllocations({ period_key })) ?? []

  let plan: ReturnType<typeof planApproval>
  try {
    plan = planApproval(period_key, rows)
  } catch (error) {
    if (error instanceof PatronageApprovalError) {
      return res.status(409).json({ message: error.message, type: "not_allowed" })
    }
    throw error
  }

  const approved: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const row of plan.toQueue) {
    try {
      await service.updatePatronageAllocations({
        id: row.id,
        status: "queued",
      })
      approved.push(row.id)

      auditFinancialTransaction(
        "PAYOUT_REQUESTED",
        row.seller_id,
        "VENDOR",
        `patronage-${period_key}`,
        row.allocation_amount,
        { period_key, status: "queued", approved_by_operator: true }
      )
    } catch (error) {
      // Per-row isolation: one bad row must not strand the rest of a period
      // in `computed` with no record of what happened.
      failed.push({ id: row.id, error: (error as Error).message })
    }
  }

  const after = (await service.listPatronageAllocations({ period_key })) ?? []

  res.json({
    period: summarisePeriod(period_key, after),
    approved_count: approved.length,
    already_queued: plan.alreadyQueued,
    already_paid: plan.paid,
    failed,
    note: "Approved allocations are queued, not paid. No money has moved: disbursement is a separate, manual step.",
  })
}
