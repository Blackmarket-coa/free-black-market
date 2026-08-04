import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import {
  getAddonDefinition,
  listPurchasableAddons,
} from "../../../../../modules/vendor-plan/addons"
import {
  getAddonOwnership,
  grantAddon,
  revokeAddon,
} from "../../../../../shared/vendor-addons"

const log = createLogger("api/admin/sellers/addons")

type GrantBody = {
  code?: string
  reason?: string | null
}

/** GET /admin/sellers/:id/addons — which packs this seller holds. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  try {
    const owned = await getAddonOwnership(req.scope, sellerId)
    return res.json({ addons: owned, catalog: listPurchasableAddons() })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /admin/sellers/:id/addons] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load add-ons" })
  }
}

/**
 * POST /admin/sellers/:id/addons — comp a pack (one window, extending any
 * open one). The operator counterpart of the purchase route, and the only
 * path that grants without a paid charge.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  const body = (req.body ?? {}) as GrantBody
  const addon = getAddonDefinition(body.code)

  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }
  if (!addon) {
    return res.status(400).json({
      type: "invalid_data",
      message: `code must be one of: ${listPurchasableAddons()
        .map((a) => a.code)
        .join(", ")}`,
    })
  }

  try {
    const owned = await grantAddon(req.scope, {
      sellerId,
      code: addon.code,
      reason: body.reason ?? "operator grant",
    })
    return res.json({ addon: owned })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /admin/sellers/:id/addons] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to grant add-on" })
  }
}

/**
 * DELETE /admin/sellers/:id/addons — end a pack now (refund, dispute).
 * Body: `{ code, reason? }`. Idempotent when nothing is active.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  const body = (req.body ?? {}) as GrantBody
  const code = String(body.code || "").trim()

  if (!sellerId || !code) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id and code are required" })
  }

  try {
    const revoked = await revokeAddon(
      req.scope,
      sellerId,
      code,
      body.reason ?? undefined
    )
    return res.json({ revoked })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[DELETE /admin/sellers/:id/addons] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to revoke add-on" })
  }
}
