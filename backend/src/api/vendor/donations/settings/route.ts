import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"

/**
 * Donation checkout settings are one platform-wide row (`donation_settings`
 * with `is_default: true`): the default percentage, round-up and settlement
 * mode every storefront checkout uses. Vendors may read them so the panel can
 * show what buyers will see; only the operator writes them, through
 * `/admin/donations/settings`, where the tenancy gate on `ledger_batch` lives.
 *
 * Until 2026-09-06 this route also accepted a POST that upserted that same
 * default row behind seller-only auth, so any seller could change the
 * platform's donation percentage and settlement mode — and its schema
 * accepted a `settlement_mode` value (`direct`) the model does not have.
 * Recorded in `docs/CDFI_COOP_ROADMAP.md` §1a.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const settings = await service.getOrCreateDefaultSettings()
  res.status(200).json({ settings })
}

export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  res.status(403).json({
    code: "DONATION_SETTINGS_PLATFORM_SCOPED",
    message:
      "Donation checkout settings are platform-wide and are set by the operator in the admin panel.",
  })
}
