import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FUND_ACCOUNTING_MODULE } from "../../../../../modules/fund-accounting"
import type FundAccountingModuleService from "../../../../../modules/fund-accounting/service"
import { FundEntryType } from "../../../../../modules/fund-accounting/models/fund-transaction"
import { getSellerId } from "../../../quests/_helpers"

const ENTRY_TYPES = new Set<string>(Object.values(FundEntryType))

/** GET /vendor/funds/:id/entries — movements against one fund. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )
  const fund_transactions = await service.listEntries(sellerId, req.params.id)
  res.json({ fund_transactions, count: fund_transactions.length })
}

interface CreateEntryBody {
  entry_type: string
  amount_cents: number
  occurred_at?: string
  description?: string
  program_id?: string
  reference_type?: string
  reference_id?: string
  metadata?: Record<string, unknown>
  force?: boolean
}

/** POST /vendor/funds/:id/entries — record a movement against a fund. */
export const POST = async (
  req: MedusaRequest<CreateEntryBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateEntryBody)
  if (!b.entry_type || !ENTRY_TYPES.has(b.entry_type)) {
    return res.status(400).json({
      message: `entry_type must be one of: ${[...ENTRY_TYPES].join(", ")}`,
    })
  }
  if (typeof b.amount_cents !== "number" || !Number.isFinite(b.amount_cents)) {
    return res.status(400).json({ message: "amount_cents must be a number" })
  }

  const service = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )

  try {
    const fund_transaction = await service.recordEntry({
      seller_id: sellerId,
      fund_id: req.params.id,
      entry_type: b.entry_type as FundEntryType,
      amount_cents: b.amount_cents,
      occurred_at: b.occurred_at,
      description: b.description ?? null,
      program_id: b.program_id ?? null,
      reference_type: b.reference_type ?? null,
      reference_id: b.reference_id ?? null,
      metadata: b.metadata ?? null,
      force: b.force,
    })
    res.status(201).json({ fund_transaction })
  } catch (e) {
    // The guards are the point of the endpoint: a refused spend is a 409 the
    // caller can act on, not a 500.
    if (e instanceof MedusaError) {
      if (e.type === MedusaError.Types.NOT_FOUND) {
        return res.status(404).json({ message: "Fund not found" })
      }
      if (e.type === MedusaError.Types.NOT_ALLOWED) {
        return res.status(409).json({ message: e.message })
      }
      if (e.type === MedusaError.Types.INVALID_DATA) {
        return res.status(400).json({ message: e.message })
      }
    }
    throw e
  }
}
