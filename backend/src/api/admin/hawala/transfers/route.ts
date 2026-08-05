import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/hawala/transfers")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { resolveRequestIdempotencyKey } from "../../../../shared/request-idempotency"

/**
 * GET /admin/hawala/transfers
 * List ledger entries/transfers
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    entry_type,
    status,
    order_id,
    limit = "50",
    offset = "0",
  } = req.query

  const filters: Record<string, unknown> = {}
  if (entry_type) filters.entry_type = entry_type
  if (status) filters.status = status
  if (order_id) filters.order_id = order_id

  const take = Math.min(Math.max(parseInt(limit as string) || 50, 1), 100)
  const skip = Math.max(parseInt(offset as string) || 0, 0)

  const entries = await hawalaService.listLedgerEntries({
    filters,
    take,
    skip,
  })

  res.json({
    entries,
    count: entries.length,
    limit: take,
    offset: skip,
  })
}

/**
 * POST /admin/hawala/transfers
 * Create a manual transfer between accounts
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    debit_account_id,
    credit_account_id,
    amount,
    entry_type,
    description,
    reference_type,
    reference_id,
    idempotency_key,
    metadata,
  } = req.body as {
    debit_account_id: string
    credit_account_id: string
    amount: number
    entry_type: string
    description?: string
    reference_type?: string
    reference_id?: string
    idempotency_key?: string
    metadata?: Record<string, unknown>
  }

  if (!debit_account_id || !credit_account_id || !amount || !entry_type) {
    return res.status(400).json({
      error: "debit_account_id, credit_account_id, amount, and entry_type are required",
    })
  }

  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" })
  }

  if (debit_account_id === credit_account_id) {
    return res.status(400).json({ error: "Debit and credit accounts must be different" })
  }

  try {
    const entry = await hawalaService.createTransfer({
      debit_account_id,
      credit_account_id,
      amount,
      entry_type,
      description,
      reference_type,
      reference_id,
      // An explicit key always wins. Without one, derive a deterministic key
      // from the operator and the transfer itself — `Date.now()` made every
      // retry of a manual transfer a second, distinct movement.
      idempotency_key:
        idempotency_key ||
        resolveRequestIdempotencyKey({
          scope: "manual",
          actorId:
            (req as unknown as { auth_context?: { actor_id?: string } })
              .auth_context?.actor_id || "admin",
          headers: req.headers,
          payload: {
            debit_account_id,
            credit_account_id,
            amount,
            entry_type,
            reference_id,
          },
        }).key,
      metadata,
    })

    res.status(201).json({ entry })
  } catch (error) {
    log.error("Error creating transfer:", error)
    res.status(400).json({ error: "Failed to create transfer" })
  }
}
