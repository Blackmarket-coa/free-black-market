import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getMatrixService } from "../../../../shared/matrix-service"

/**
 * GET /store/chat/unread
 * Returns the authenticated customer's total unread Matrix notification count.
 * Best-effort: returns { unread_count: 0 } when chat is unconfigured, the user
 * has no mxid, or Synapse is unavailable — never errors the badge.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const matrixService = getMatrixService()
  const customerId = req.auth_context?.actor_id

  if (!matrixService || !customerId) {
    res.status(200).json({ unread_count: 0 })
    return
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { id: customerId },
    })

    if (!customer || !customer.email) {
      res.status(200).json({ unread_count: 0 })
      return
    }

    const mxid = matrixService.buildMxid(customer.email.split("@")[0])
    const unreadCount = await matrixService.getUnreadCount(mxid)
    res.json({ unread_count: unreadCount })
  } catch (error: any) {
    console.error("[GET /store/chat/unread] Error:", error.message)
    res.status(200).json({ unread_count: 0 })
  }
}
