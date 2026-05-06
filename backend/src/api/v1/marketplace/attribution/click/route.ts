import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createHash } from "crypto"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../modules/creator-attribution/service"

/**
 * Record a click without redirect. Used by SPA / iframe widgets that can't
 * invoke the /r/:shortCode redirector (e.g. a shoppable widget embedded in
 * Blackout where the link clicks happen client-side).
 *
 * The caller MUST send a `visitor_token` it has already minted (matching the
 * `_fbm_visitor` cookie pattern); the server only validates the short code.
 */

const ClickSchema = z.object({
  short_code: z.string().min(3).max(64),
  visitor_token: z.string().min(8).max(128),
  referrer: z.string().max(2048).optional().nullable(),
  fingerprint: z.string().max(128).optional().nullable(),
})

function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const salt = process.env.CREATOR_ATTRIBUTION_IP_SALT || ""
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)
}

function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  return createHash("sha256").update(ua).digest("hex").slice(0, 32)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = ClickSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid click payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null
  const ua = (req.headers["user-agent"] as string | undefined) || null

  try {
    const event = await service.recordClick({
      shortCode: parsed.data.short_code,
      visitorToken: parsed.data.visitor_token,
      ipHash: hashIp(ip),
      userAgentHash: hashUserAgent(ua),
      referrer: parsed.data.referrer ?? null,
      fingerprint: parsed.data.fingerprint ?? null,
    })
    return res.status(201).json({
      click_event_id: event.id,
      occurred_at: event.occurred_at,
    })
  } catch (err) {
    return res.status(404).json({
      message: (err as Error).message,
      type: "not_found",
    })
  }
}
