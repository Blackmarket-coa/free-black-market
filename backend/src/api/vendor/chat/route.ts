import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/chat")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { requireSellerId } from "../../../shared/auth-helpers"
import {
  getMatrixService,
  GOVERNANCE_POWER_LEVEL,
} from "../../../shared/matrix-service"

type SellerModuleLike = {
  retrieveSeller: (
    sellerId: string,
    options?: { relations?: string[] }
  ) => Promise<{
    handle?: string | null
    name?: string | null
    members?: Array<{ email?: string | null }>
  } | null>
}

/**
 * GET /vendor/chat
 * Returns Matrix/Element configuration and a single-use login token for the
 * authenticated vendor, defaulting to their vendor room.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const matrixService = getMatrixService()

  if (!matrixService) {
    res.status(200).json({
      configured: false,
      message: "Chat is not configured",
    })
    return
  }

  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const sellerService = req.scope.resolve(SELLER_MODULE) as SellerModuleLike
    const seller = await sellerService.retrieveSeller(sellerId, {
      relations: ["members"],
    })

    if (!seller || !seller.members || seller.members.length === 0) {
      res.status(404).json({ message: "Seller information not found" })
      return
    }

    const member = seller.members[0]
    if (!member.email) {
      res.status(404).json({ message: "Seller member email not found" })
      return
    }

    const displayName = seller.name || member.email
    const localpartSource = seller.handle || member.email.split("@")[0]
    const vendorAlias = `vendor-${seller.handle || sellerId}`
    const serverName = matrixService.getServerName()

    let mxid: string | null = null
    let login: { login_token: string; expires_in_ms: number } | null = null

    try {
      const ensured = await matrixService.ensureUser(localpartSource, displayName, {
        email: member.email,
      })
      mxid = ensured.mxid

      await matrixService.ensureRoom({
        alias: vendorAlias,
        name: `${seller.name || "Vendor"} Channel`,
        invite: [mxid],
        powerLevels: { [mxid]: GOVERNANCE_POWER_LEVEL.vendor },
      })

      login = await matrixService.mintLoginToken(mxid)
    } catch (error) {
      log.error("[GET /vendor/chat] Provisioning failed:", error.message)
    }

    const response: Record<string, unknown> = {
      configured: true,
      element_url: process.env.MATRIX_ELEMENT_URL,
      homeserver_url:
        process.env.MATRIX_PUBLIC_BASE_URL || process.env.MATRIX_HOMESERVER_URL,
      server_name: serverName,
      mxid,
      default_room_alias: `#${vendorAlias}:${serverName}`,
    }

    if (login) {
      response.login = login
    }

    res.json(response)
  } catch (error) {
    log.error("[GET /vendor/chat] Error:", error)
    res.status(500).json({
      message: error.message || "Failed to retrieve chat configuration",
    })
  }
}
