import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import {
  addonCoveredByPlan,
  addonOfferedForPurchase,
  listPurchasableAddons,
} from "../../../modules/vendor-plan/addons"
import { allAccessPlanEnabled } from "../../../modules/vendor-plan/catalog"
import { getAddonOwnership } from "../../../shared/vendor-addons"
import { isVendorBillingConfigured } from "../../../shared/vendor-charge-execution"
import { addonPlanContextOrNull } from "../../../shared/vendor-plan-code"

const log = createLogger("api/vendor/addons")

/**
 * GET /vendor/addons — the pack catalog and where this vendor stands on each.
 *
 * `purchasable` mirrors `GET /vendor/promotion`: the price list is always
 * visible, and the flag tells the panel whether self-serve checkout is open or
 * the team arranges it. Not plan-gated — hiding the catalog from vendors on
 * small plans would hide it from exactly the vendors add-ons exist for.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const owned = await getAddonOwnership(req.scope, sellerId)
    const ownedByCode = new Map(owned.map((o) => [o.code, o]))

    // FF_ALL_ACCESS_PLAN_V1 (operator answer OI-9): a pack the seller's plan
    // already covers is not offered for sale — for an all_access seller that
    // is every pack — but one they own and is still active stays listed, as
    // owned, flagged `covered_by_plan`. Nothing here revokes or refunds.
    // Flag off, the plan is not read and the response is exactly as before.
    const allAccessOn = allAccessPlanEnabled()
    const ctx = allAccessOn
      ? await addonPlanContextOrNull(req.scope, sellerId)
      : null
    const planCode = ctx?.plan_code ?? null

    const listed = listPurchasableAddons().filter((addon) => {
      if (!allAccessOn || ctx === null) return true
      return (
        addonOfferedForPurchase(addon, ctx.plan_code, true, ctx.pending_plan_code) ||
        ownedByCode.get(addon.code)?.active === true
      )
    })

    return res.json({
      addons: listed.map((addon) => ({
        code: addon.code,
        display_name: addon.display_name,
        description: addon.description,
        price_amount: addon.price_amount,
        currency_code: addon.currency_code,
        duration_days: addon.duration_days,
        feature_keys: addon.feature_keys,
        owned: ownedByCode.get(addon.code) ?? {
          code: addon.code,
          active: false,
          expires_at: null,
        },
        ...(allAccessOn
          ? {
              covered_by_plan:
                planCode !== null && addonCoveredByPlan(addon, planCode),
            }
          : {}),
      })),
      purchasable: isVendorBillingConfigured(),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/addons] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load add-ons" })
  }
}
