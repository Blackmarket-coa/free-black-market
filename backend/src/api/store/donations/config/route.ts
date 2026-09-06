import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"
import { resolveActiveFiscalSponsor } from "../../../../modules/donation/fiscal-sponsors"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const donationService = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const tenancyService = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)

  const storefront_id = String(req.headers["x-storefront-id"] || "")
  const context = storefront_id
    ? await tenancyService.resolveContext({ storefront_id })
    : { tier: "tier0_public" as const }

  const settings = await donationService.getOrCreateDefaultSettings()
  const gates = tenancyService.featureGatesForTier(context.tier)

  // Surface fiscal-sponsor display fields to the storefront so the
  // checkout widget can show "routed through [501(c)(3) name]" — but only
  // once the sponsor is live. Every registry entry is `live: false` until the
  // agreement in `docs/FISCAL_SPONSOR_DECISION.md` is signed, and until
  // 2026-09-06 the widget told donors their gift was already routed through
  // a 501(c)(3). `fiscal_sponsor_live` is the flag the widget keys its
  // "pending" copy on. `fiscal_sponsor_account_id` stays server-side; never
  // expose it to the storefront. See `docs/POSTURE_A_COMPLIANCE.md`.
  const safeSettings = {
    default_percentage: settings.default_percentage,
    round_up_enabled: settings.round_up_enabled,
    fiscal_sponsor_name: settings.fiscal_sponsor_name ?? null,
    fiscal_sponsor_url: settings.fiscal_sponsor_url ?? null,
    fiscal_sponsor_live: resolveActiveFiscalSponsor().live === true,
  }

  res.status(200).json({ settings: safeSettings, feature_gates: gates, tier: context.tier })
}
