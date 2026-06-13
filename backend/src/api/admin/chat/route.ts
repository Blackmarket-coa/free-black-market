import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/chat")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { requireAdminId } from "../../../shared/auth-helpers"
import { getMatrixService } from "../../../shared/matrix-service"

/**
 * GET /admin/chat
 * Returns Matrix/Element configuration and a single-use login token for the
 * admin panel, defaulting to the community room.
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

  const adminId = requireAdminId(req, res)
  if (!adminId) return

  try {
    const userModule = req.scope.resolve(Modules.USER)
    const admin = await userModule.retrieveUser(adminId)

    if (!admin || !admin.email) {
      res.status(404).json({ message: "Admin user not found" })
      return
    }

    const displayName =
      admin.first_name && admin.last_name
        ? `${admin.first_name} ${admin.last_name}`
        : admin.email

    const localpartSource = admin.email.split("@")[0]
    const serverName = matrixService.getServerName()
    const generalAlias = matrixService.generalRoomAlias()

    let mxid: string | null = null
    let login: { login_token: string; expires_in_ms: number } | null = null

    try {
      const ensured = await matrixService.ensureUser(localpartSource, displayName, {
        email: admin.email,
      })
      mxid = ensured.mxid
      await matrixService.ensureRoom({
        alias: generalAlias,
        name: "General",
        invite: [mxid],
      })
      login = await matrixService.mintLoginToken(mxid)
    } catch (error: any) {
      log.error("[GET /admin/chat] Provisioning failed:", error.message)
    }

    const response: Record<string, unknown> = {
      configured: true,
      element_url: process.env.MATRIX_ELEMENT_URL,
      homeserver_url:
        process.env.MATRIX_PUBLIC_BASE_URL || process.env.MATRIX_HOMESERVER_URL,
      server_name: serverName,
      mxid,
      default_room_alias: `#${generalAlias}:${serverName}`,
    }

    if (login) {
      response.login = login
    }

    res.json(response)
  } catch (error: any) {
    log.error("[GET /admin/chat] Error:", error)
    res.status(500).json({
      message: error.message || "Failed to retrieve chat configuration",
    })
  }
}
