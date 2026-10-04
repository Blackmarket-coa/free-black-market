import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"

type Body = {
  settlement_mode?: "split_processor" | "ledger_batch"
  default_percentage?: number
  round_up_enabled?: boolean
}

type StorefrontContext = {
  storefront_id?: string
  organization_id?: string
  role?: string
  tier?: string
  gates?: Record<string, unknown>
} | null

type RequestWithStorefront = MedusaRequest & { storefront_context?: StorefrontContext }

/**
 * `ledger_batch` is the custody-shaped settlement mode: donations accrue on
 * FBM's books and a weekly job queues their disbursement. While
 * FF_NONPROFIT_PARITY_V1 is on, donations are direct charges on the org's own
 * Stripe account (docs/POSTURE_A_COMPLIANCE.md rule 10) and `split_processor`
 * is the only mode; selecting `ledger_batch` is refused with a typed 409 so an
 * operator learns why rather than silently keeping a mode nothing executes.
 * With the flag off the tier-2 path is untouched.
 */
export const SETTLEMENT_MODE_RETIRED = "settlement_mode_retired" as const

export type SettlementModeRetiredResponse = {
  type: typeof SETTLEMENT_MODE_RETIRED
  message: string
  requested: "ledger_batch"
  allowed: ["split_processor"]
  flag: string
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const settings = await service.getOrCreateDefaultSettings()
  return res.status(200).json({ settings, storefront_context: (req as RequestWithStorefront).storefront_context || null })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const body = req.validatedBody || req.body
  const context = (req as RequestWithStorefront).storefront_context || null

  if (body.settlement_mode === "ledger_batch" && featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
    const refusal: SettlementModeRetiredResponse = {
      type: SETTLEMENT_MODE_RETIRED,
      message:
        "ledger_batch accrues donations on FBM's books; while direct-charge donations are on, split_processor is the only settlement mode (docs/POSTURE_A_COMPLIANCE.md rule 10).",
      requested: "ledger_batch",
      allowed: ["split_processor"],
      flag: PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1,
    }
    return res.status(409).json(refusal)
  }

  if (body.settlement_mode === "ledger_batch" && !context?.gates?.advanced_automation) {
    return res.status(403).json({
      message: "ledger_batch mode requires tier2_aligned_org",
      storefront_tier: context?.tier,
    })
  }

  const settings = await service.upsertDefaultSettings(body as Record<string, unknown>)
  return res.status(200).json({ settings })
}
