import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import { auditFinancialTransaction } from "../../../../../modules/hawala-ledger/audit-logger"
import {
  isDisbursementLive,
  planDisbursement,
  PATRONAGE_DISBURSEMENT_FLAG,
  type PatronageDisbursementPort,
  type PayoutAccountRow,
} from "../../../../../modules/hawala-ledger/patronage-disburse"
import {
  summarisePeriod,
  type PatronageAllocationStore,
} from "../../../../../modules/hawala-ledger/patronage-review"

/**
 * POST /admin/hawala/patronage/disburse
 *
 * `queued → paid`, the step `patronage-review.ts` left for "a disbursement rail
 * that does not exist yet". The rail's shape is fixed by Posture A: a patronage
 * refund is a vendor payout, so it terminates at Stripe ACH and never at
 * Stellar, whatever the dual-rail selector would prefer. The reasoning is in
 * `modules/hawala-ledger/patronage-disburse.ts`.
 *
 * ## Dry run is the default
 *
 * With `FBM_PATRONAGE_DISBURSEMENT_LIVE` unset, this endpoint plans and
 * reports: who would be paid, how much in total, and precisely why each
 * unpayable seller cannot be. It moves nothing. That is the useful half while
 * an operator is still connecting accounts, and it means the first live run is
 * against a list already reviewed rather than a surprise.
 *
 * The flag is named as an assertion about the world, not a feature switch,
 * following `FBM_SECURITIES_GATE_CLEARED`: it says a live processor
 * configuration exists and this period is meant to be paid.
 *
 * ## What a refusal means
 *
 * An allocation that cannot be paid stays `queued` — the recoverable state.
 * Fix the account, re-run, and it goes out; nothing has to be undone. `failed`
 * is written only when a payout was actually attempted and the processor
 * rejected it, so the two are distinguishable afterwards, which is the
 * difference between "we could not send this" and "they would not take it".
 *
 * ## Ordering
 *
 * The status write happens *after* the processor confirms. The reverse order
 * would mark a row paid that never went out. This way a crash between the two
 * leaves a row `queued` whose payout already succeeded — and the deterministic
 * idempotency key means the retry is a no-op at the processor rather than a
 * second payment. Of the two possible inconsistencies, that is the one that
 * does not cost anybody money.
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
  const queued = rows.filter((r) => r.status === "queued")

  if (queued.length === 0) {
    return res.status(409).json({
      message:
        `Nothing is queued for ${period_key}. Approve the period first ` +
        `(POST /admin/hawala/patronage/approve), or it has already been paid.`,
      type: "not_allowed",
      period: summarisePeriod(period_key, rows),
    })
  }

  const accountsBySeller = await readPayoutAccounts(
    req,
    queued.map((r) => r.seller_id)
  )
  const plan = planDisbursement(period_key, rows, accountsBySeller)

  const live = isDisbursementLive()
  if (!live) {
    return res.json({
      dry_run: true,
      period: summarisePeriod(period_key, rows),
      would_pay: plan.payable.map((p) => ({
        allocation_id: p.allocation_id,
        seller_id: p.seller_id,
        amount: p.amount,
        currency: p.currency,
      })),
      cannot_pay: plan.unpayable,
      total_payable: plan.total_payable,
      currency: plan.currency,
      note:
        `No money moved. Set ${PATRONAGE_DISBURSEMENT_FLAG}=true to disburse ` +
        `for real; until then this endpoint reports what a run would do.`,
    })
  }

  const port = resolveDisbursementPort(req)
  if (!port) {
    return res.status(503).json({
      message:
        `${PATRONAGE_DISBURSEMENT_FLAG} is true but no disbursement provider ` +
        `is registered. Refusing to mark anything paid.`,
      type: "not_allowed",
    })
  }

  const paid: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const payable of plan.payable) {
    let reference: string
    try {
      // Money first, status second. See the ordering note above.
      const result = await port.send(payable)
      reference = result.reference
    } catch (error) {
      failed.push({
        id: payable.allocation_id,
        error: (error as Error).message,
      })
      // Attempted and rejected — distinguishable from "could not attempt".
      await service
        .updatePatronageAllocations({
          id: payable.allocation_id,
          status: "failed",
        })
        .catch(() => undefined)
      continue
    }

    try {
      await service.updatePatronageAllocations({
        id: payable.allocation_id,
        status: "paid",
      })
      paid.push(payable.allocation_id)

      auditFinancialTransaction(
        "PAYOUT_COMPLETED",
        payable.seller_id,
        "VENDOR",
        `patronage-${period_key}`,
        payable.amount,
        {
          period_key,
          status: "paid",
          rail: "stripe_ach",
          processor_reference: reference,
          idempotency_key: payable.idempotency_key,
        }
      )
    } catch (error) {
      // The payout succeeded and the row did not update. Reported rather than
      // retried here: the idempotency key makes the operator's re-run safe.
      failed.push({
        id: payable.allocation_id,
        error:
          `Payout sent (${reference}) but the allocation could not be marked ` +
          `paid: ${(error as Error).message}. Re-running is safe.`,
      })
    }
  }

  const after = (await service.listPatronageAllocations({ period_key })) ?? []

  res.json({
    dry_run: false,
    period: summarisePeriod(period_key, after),
    paid_count: paid.length,
    cannot_pay: plan.unpayable,
    failed,
    note:
      plan.unpayable.length > 0
        ? "Sellers under cannot_pay remain queued and can be paid by re-running once their payout account is fixed."
        : undefined,
  })
}

/**
 * Read each seller's payout account.
 *
 * Through `query.graph` rather than the marketplace-listing service, so this
 * admin route does not take a dependency on that module's import graph for one
 * lookup. Missing rows are simply absent from the map, and `planDisbursement`
 * refuses those with a reason.
 */
async function readPayoutAccounts(
  req: MedusaRequest,
  sellerIds: string[]
): Promise<Map<string, PayoutAccountRow>> {
  const out = new Map<string, PayoutAccountRow>()
  if (sellerIds.length === 0) return out

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "creator_payout_account",
      fields: ["seller_id", "provider", "external_account_id", "status"],
      filters: { seller_id: sellerIds },
    })
    for (const row of (data ?? []) as PayoutAccountRow[]) {
      if (row?.seller_id) out.set(row.seller_id, row)
    }
  } catch {
    // A lookup that fails leaves the map empty, so every allocation is refused
    // with "no payout account on file" and stays queued. Failing closed on a
    // payout read is the only safe direction.
  }

  return out
}

/**
 * The registered disbursement adapter, if any.
 *
 * Resolved by name so the route carries no compile-time dependency on a
 * processor SDK. Nothing registers this yet: wiring a Stripe Connect transfer
 * adapter is the remaining operator-side step, and until it exists a live run
 * returns 503 rather than marking rows paid against a rail that is not there.
 */
function resolveDisbursementPort(
  req: MedusaRequest
): PatronageDisbursementPort | null {
  try {
    const port = req.scope.resolve("patronageDisbursementPort") as
      | PatronageDisbursementPort
      | undefined
    return port && typeof port.send === "function" ? port : null
  } catch {
    return null
  }
}
