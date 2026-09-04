import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FUND_ACCOUNTING_MODULE } from "../../../modules/fund-accounting"
import type FundAccountingModuleService from "../../../modules/fund-accounting/service"
import {
  FundRestriction,
  FundSource,
} from "../../../modules/fund-accounting/models/fund"
import { getSellerId } from "../quests/_helpers"

const RESTRICTIONS = new Set<string>(Object.values(FundRestriction))
const SOURCES = new Set<string>(Object.values(FundSource))

/** GET /vendor/funds — the seller's funds. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )
  const funds = await service.listForSeller(sellerId)
  res.json({ funds, count: funds.length })
}

interface CreateFundBody {
  name: string
  code: string
  description?: string
  restriction?: string
  source?: string
  purpose_description?: string
  designated_program_id?: string
  spend_from?: string
  spend_until?: string
  grantor_name?: string
  grant_reference?: string
  currency_code?: string
  enforce_spend_limit?: boolean
  metadata?: Record<string, unknown>
}

/** POST /vendor/funds — open a fund. */
export const POST = async (
  req: MedusaRequest<CreateFundBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateFundBody)
  if (!b.name) return res.status(400).json({ message: "name is required" })
  if (!b.code) return res.status(400).json({ message: "code is required" })
  if (b.restriction !== undefined && !RESTRICTIONS.has(b.restriction)) {
    return res.status(400).json({
      message: `restriction must be one of: ${[...RESTRICTIONS].join(", ")}`,
    })
  }
  if (b.source !== undefined && !SOURCES.has(b.source)) {
    return res
      .status(400)
      .json({ message: `source must be one of: ${[...SOURCES].join(", ")}` })
  }

  const spendFrom = b.spend_from ? new Date(b.spend_from) : null
  const spendUntil = b.spend_until ? new Date(b.spend_until) : null
  for (const [field, value] of [
    ["spend_from", spendFrom],
    ["spend_until", spendUntil],
  ] as const) {
    if (value && Number.isNaN(value.getTime())) {
      return res.status(400).json({ message: `${field} must be a valid date` })
    }
  }
  if (spendFrom && spendUntil && spendFrom > spendUntil) {
    return res
      .status(400)
      .json({ message: "spend_from must not be after spend_until" })
  }

  const service = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )
  const fund = await service.createFunds({
    seller_id: sellerId,
    name: b.name,
    code: b.code,
    description: b.description ?? null,
    restriction: (b.restriction ?? FundRestriction.UNRESTRICTED) as FundRestriction,
    source: (b.source ?? FundSource.GRANT) as FundSource,
    purpose_description: b.purpose_description ?? null,
    designated_program_id: b.designated_program_id ?? null,
    spend_from: spendFrom,
    spend_until: spendUntil,
    grantor_name: b.grantor_name ?? null,
    grant_reference: b.grant_reference ?? null,
    currency_code: b.currency_code ?? "usd",
    enforce_spend_limit: b.enforce_spend_limit ?? true,
    metadata: b.metadata ?? null,
  })

  res.status(201).json({ fund })
}
