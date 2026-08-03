import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { listPurchasableAddons } from "../../../modules/vendor-plan/addons"
import { getAddonOwnership } from "../../../shared/vendor-addons"
import { isVendorBillingConfigured } from "../../../shared/vendor-charge-execution"

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

    return res.json({
      addons: listPurchasableAddons().map((addon) => ({
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
