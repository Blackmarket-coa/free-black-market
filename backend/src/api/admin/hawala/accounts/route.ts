import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { safePagination } from "../../../hawala-validation"

/**
 * GET /admin/hawala/accounts
 * List all ledger accounts with filters
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    account_type,
    owner_type,
    owner_id,
    status,
    limit,
    offset,
  } = req.query

  // Safe pagination with bounds checking
  const pagination = safePagination(limit as string, offset as string)

  const filters: Record<string, unknown> = {}
  if (account_type) filters.account_type = account_type
  if (owner_type) filters.owner_type = owner_type
  if (owner_id) filters.owner_id = owner_id
  if (status) filters.status = status

  const accounts = await hawalaService.listLedgerAccounts(filters)

  res.json({
    accounts,
    count: accounts.length,
    limit: pagination.limit,
    offset: pagination.offset,
  })
}

/**
 * POST /admin/hawala/accounts
 * Create a new ledger account
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    account_type,
    currency_code,
    owner_type,
    owner_id,
    stellar_address,
    metadata,
  } = req.body as {
    account_type: string
    currency_code?: string
    owner_type?: string
    owner_id?: string
    stellar_address?: string
    metadata?: Record<string, unknown>
  }

  if (!account_type) {
    return res.status(400).json({ error: "account_type is required" })
  }

  const account = await hawalaService.createAccount({
    account_type,
    currency_code,
    owner_type,
    owner_id,
    stellar_address,
    metadata,
  })

  res.status(201).json({ account })
}
