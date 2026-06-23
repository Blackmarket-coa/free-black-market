import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/chat/unread")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { requireAdminId } from "../../../../shared/auth-helpers"
import { getMatrixService } from "../../../../shared/matrix-service"

/**
 * GET /admin/chat/unread
 * Returns the authenticated admin's total unread Matrix notification count.
 * Best-effort: returns { unread_count: 0 } on any missing config / failure.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const matrixService = getMatrixService()
  if (!matrixService) {
    res.status(200).json({ unread_count: 0 })
    return
  }

  const adminId = requireAdminId(req, res)
  if (!adminId) return

  try {
    const userModule = req.scope.resolve(Modules.USER)
    const admin = await userModule.retrieveUser(adminId)

    if (!admin || !admin.email) {
      res.status(200).json({ unread_count: 0 })
      return
    }

    const mxid = matrixService.buildMxid(admin.email.split("@")[0])
    const unreadCount = await matrixService.getUnreadCount(mxid)
    res.json({ unread_count: unreadCount })
  } catch (error) {
    log.warn(
      "[GET /admin/chat/unread] Matrix unavailable, returning degraded count:",
      error?.message
    )
    res.status(200).json({ unread_count: 0, degraded: true })
  }
}
