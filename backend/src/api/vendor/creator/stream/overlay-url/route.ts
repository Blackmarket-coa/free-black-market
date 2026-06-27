import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/vendor/creator/stream/overlay-url")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { requireSellerId } from "../../../../../shared/auth-helpers"

const OVERLAY_TTL_SECONDS = 24 * 60 * 60 // 24h — creator refreshes for long streams

type PgConnection = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

/**
 * POST /vendor/creator/stream/overlay-url
 *
 * Mints a signed, time-limited URL the creator pastes into OBS as a browser
 * source. The overlay page itself is served by Blackout at
 * `${BLACKOUT_APP_URL}/overlay/{token}`; FBM only issues the token because it
 * owns the creator's authenticated identity (seller + mxid).
 *
 * The token is an HS256 JWT signed with BLACKOUT_OVERLAY_SECRET (a shared
 * secret Blackout verifies). It carries the seller id and the creator's mxid so
 * the overlay can scope to the right Space, and expires after 24h.
 *
 * Returns 503 when the overlay secret is not configured, so an environment that
 * has not wired the Blackout overlay never hands out an unverifiable token.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const secret = process.env.BLACKOUT_OVERLAY_SECRET
  if (!secret) {
    return res.status(503).json({
      code: "overlay_unconfigured",
      message: "Stream overlay is not configured (BLACKOUT_OVERLAY_SECRET unset).",
    })
  }

  // Resolve the creator's mxid for Space scoping. Absent (un-backfilled) is fine
  // — the overlay can still render seller-scoped content.
  let mxid: string | null = null
  try {
    const conn = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as PgConnection
    const r = await conn.raw(
      `SELECT mxid FROM seller_metadata WHERE seller_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sellerId]
    )
    const v = r?.rows?.[0]?.mxid
    if (typeof v === "string" && v.length > 0) mxid = v
  } catch (err) {
    log.warn(
      `[overlay-url] mxid lookup failed for seller ${sellerId}: ${
        err instanceof Error ? err.message : err
      }`
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + OVERLAY_TTL_SECONDS
  const token = jwt.sign(
    {
      seller_id: sellerId,
      creator_mxid: mxid,
      iat: now,
      exp,
      iss: "fbm",
      aud: "blackout-overlay",
    },
    secret,
    { algorithm: "HS256" }
  )

  const appBase = (process.env.BLACKOUT_APP_URL || "https://theblackout.app").replace(
    /\/$/,
    ""
  )

  return res.json({
    overlay_url: `${appBase}/overlay/${token}`,
    expires_at: new Date(exp * 1000).toISOString(),
    instructions:
      "Paste this URL into OBS as a Browser Source at 1920×1080. Expires in 24 hours — regenerate before long streams.",
  })
}
