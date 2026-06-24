import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { EMBED_KEYS_MODULE } from "../../../../modules/embed-keys"
import type EmbedKeysService from "../../../../modules/embed-keys/service"

const log = createLogger("api/vendor/embed-keys/[id]")

/**
 * DELETE /vendor/embed-keys/:id — soft-revoke a key.
 *
 * Ownership is enforced in the service (the key must belong to this seller),
 * so a vendor can never revoke another vendor's key by guessing an id.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const id = req.params.id
  try {
    const embedKeys = req.scope.resolve(EMBED_KEYS_MODULE) as EmbedKeysService
    const ok = await embedKeys.revokeKey(id, sellerId)
    if (!ok) {
      return res
        .status(404)
        .json({ message: "Embed key not found", type: "not_found" })
    }
    return res.json({ id, revoked: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[DELETE /vendor/embed-keys/:id] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to revoke embed key", type: "server_error" })
  }
}
