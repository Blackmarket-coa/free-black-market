import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getMatrixService } from "../../../shared/matrix-service"

/**
 * GET /store/chat
 * Returns Matrix/Element configuration and a single-use login token for the
 * authenticated customer, for embedding Element Web with auto-login.
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

  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "Authentication required" })
    return
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name", "last_name"],
      filters: { id: customerId },
    })

    if (!customer || !customer.email) {
      res.status(404).json({ message: "Customer information not found" })
      return
    }

    const displayName =
      customer.first_name && customer.last_name
        ? `${customer.first_name} ${customer.last_name}`
        : customer.email

    const localpartSource = customer.email.split("@")[0]

    let mxid: string | null = null
    let login: { login_token: string; expires_in_ms: number } | null = null

    try {
      const ensured = await matrixService.ensureUser(localpartSource, displayName, {
        email: customer.email,
      })
      mxid = ensured.mxid
      login = await matrixService.mintLoginToken(mxid)
    } catch (error: any) {
      console.error("[GET /store/chat] Provisioning failed:", error.message)
      // Graceful degradation: omit login so the client can still render Element.
    }

    const response: Record<string, unknown> = {
      configured: true,
      element_url: process.env.MATRIX_ELEMENT_URL,
      homeserver_url:
        process.env.MATRIX_PUBLIC_BASE_URL || process.env.MATRIX_HOMESERVER_URL,
      server_name: matrixService.getServerName(),
      mxid,
      default_room_alias: `#${matrixService.generalRoomAlias()}:${matrixService.getServerName()}`,
    }

    if (login) {
      response.login = login
    }

    res.json(response)
  } catch (error: any) {
    console.error("[GET /store/chat] Error:", error)
    res.status(500).json({
      message: error.message || "Failed to retrieve chat configuration",
    })
  }
}
