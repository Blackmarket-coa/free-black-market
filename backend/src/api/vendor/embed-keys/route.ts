import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import {
  getSellerPlanLimits,
  respondPlanLimitReached,
} from "../../../shared/seller-plan"
import { hasRoomFor } from "../../../modules/vendor-plan/limits"
import { EMBED_KEYS_MODULE } from "../../../modules/embed-keys"
import type EmbedKeysService from "../../../modules/embed-keys/service"

const log = createLogger("api/vendor/embed-keys")

type EmbedKeyRow = {
  id: string
  last_four: string
  label: string | null
  revoked_at: Date | null
  last_used_at: Date | null
  created_at: Date
}

/** Public-safe view of a key (never includes the hash or plaintext). */
function serializeKey(row: EmbedKeyRow) {
  return {
    id: row.id,
    label: row.label ?? null,
    masked: `pk_live_…${row.last_four}`,
    last_used_at: row.last_used_at ?? null,
    revoked_at: row.revoked_at ?? null,
    created_at: row.created_at,
    active: !row.revoked_at,
  }
}

/**
 * GET /vendor/embed-keys — list this vendor's publishable keys (masked).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const embedKeys = req.scope.resolve(EMBED_KEYS_MODULE) as EmbedKeysService
    const rows = (await embedKeys.listVendorEmbedKeys(
      { seller_id: sellerId },
      { order: { created_at: "DESC" } }
    )) as unknown as EmbedKeyRow[]
    return res.json({ keys: rows.map(serializeKey) })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/embed-keys] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load embed keys", type: "server_error" })
  }
}

/**
 * POST /vendor/embed-keys — create a key. The plaintext is returned ONCE.
 * Body: { label?: string }
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const body = (req.body ?? {}) as { label?: string }
    const label =
      typeof body.label === "string" && body.label.trim()
        ? body.label.trim().slice(0, 80)
        : null

    const embedKeys = req.scope.resolve(EMBED_KEYS_MODULE) as EmbedKeysService

    // Count only live keys. A revoked key is not consuming anything, and
    // counting it would leave a vendor permanently unable to rotate once they
    // hit the cap — the exact moment they most need a new key.
    const existing = (await embedKeys.listVendorEmbedKeys({
      seller_id: sellerId,
    })) as unknown as { revoked_at: Date | null }[]
    const live = existing.filter((k) => !k.revoked_at).length

    const { plan_code, limits } = await getSellerPlanLimits(req, sellerId)
    if (!hasRoomFor(live, limits.embed_keys)) {
      return respondPlanLimitReached(res, {
        limit_key: "embed_keys",
        limit: limits.embed_keys,
        current: live,
        plan_code,
        noun: "embed keys",
      })
    }

    const generated = await embedKeys.generateKey(sellerId, label)

    return res.status(201).json({
      // `key` is the plaintext — surfaced exactly once. The panel must prompt
      // the vendor to copy it now; it is unrecoverable afterwards.
      key: generated.key,
      embed_key: {
        id: generated.id,
        label: generated.label,
        masked: `pk_live_…${generated.last_four}`,
        created_at: generated.created_at,
        active: true,
      },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/embed-keys] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to create embed key", type: "server_error" })
  }
}
