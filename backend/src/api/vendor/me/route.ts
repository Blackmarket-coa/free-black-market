import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/me")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

interface AuthContext {
  actor_id?: string
  actor_type?: string
  auth_identity_id?: string
}

/**
 * GET /vendor/me
 *
 * Returns the authenticated seller member profile for the vendor panel.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const authContext = (req as MedusaRequest & { auth_context?: AuthContext }).auth_context

  if (!authContext?.actor_id) {
    return res.status(401).json({
      message: "Unauthorized - seller authentication required",
      type: "unauthorized",
    })
  }

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const authModule = req.scope.resolve(Modules.AUTH)

  let memberId: string | null = null
  let sellerId: string | null = null

  if (authContext.actor_id.startsWith("mem_")) {
    memberId = authContext.actor_id
  } else if (authContext.actor_id.startsWith("sel_")) {
    sellerId = authContext.actor_id
  }

  if (!memberId && authContext.auth_identity_id) {
    const identities = await authModule.listAuthIdentities({ id: [authContext.auth_identity_id] })
    const authIdentity = identities?.[0]
    const appMetadata = authIdentity?.app_metadata as Record<string, unknown> | undefined
    const linkedSellerId = typeof appMetadata?.seller_id === "string" ? appMetadata.seller_id : null

    if (linkedSellerId?.startsWith("mem_")) {
      memberId = linkedSellerId
    } else if (linkedSellerId?.startsWith("sel_")) {
      sellerId = linkedSellerId
    }
  }

  try {
    let member: {
      id: string
      seller_id: string
      name: string | null
      email: string | null
      photo: string | null
      bio: string | null
      phone: string | null
      role: string | null
    } | null = null

    if (memberId) {
      const result = await pgConnection.raw(
        `
        SELECT id, seller_id, name, email, photo, bio, phone, role
        FROM member
        WHERE id = ?
        `,
        [memberId]
      )
      member = result.rows?.[0] ?? null
    } else if (sellerId) {
      const result = await pgConnection.raw(
        `
        SELECT id, seller_id, name, email, photo, bio, phone, role
        FROM member
        WHERE seller_id = ?
        ORDER BY created_at ASC
        LIMIT 1
        `,
        [sellerId]
      )
      member = result.rows?.[0] ?? null
    }

    if (!member) {
      return res.status(404).json({
        message: "Member profile not found",
        type: "not_found",
      })
    }

    return res.json({ member })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/me] Error:", errorMessage)
    return res.status(500).json({
      message: "Failed to fetch vendor member profile",
      type: "server_error",
    })
  }
}
