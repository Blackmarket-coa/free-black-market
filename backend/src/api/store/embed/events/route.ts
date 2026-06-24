import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { EMBED_ANALYTICS_MODULE } from "../../../../modules/embed-analytics"
import type EmbedAnalyticsService from "../../../../modules/embed-analytics/service"
import type { EmbedRequest } from "../../../middlewares/embed-key"

const log = createLogger("api/store/embed/events")

const MAX_BATCH = 50
const MAX_TYPE_LEN = 64

type IncomingEvent = {
  event_type?: string
  product_id?: string
  order_id?: string
  session_id?: string
  metadata?: Record<string, unknown>
}

/**
 * POST /store/embed/events  (publishable key required)
 *
 * Fire-and-forget analytics ingestion. Accepts `{ events: [...] }` (or a bare
 * array). seller_id/key_id/origin are taken from the validated embed context,
 * never the body. Always returns 202 quickly; bad rows are skipped.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const r = req as EmbedRequest
  const sellerId = r.embed_seller_id
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Missing embed context", type: "unauthorized" })
  }

  const raw = req.body as { events?: IncomingEvent[] } | IncomingEvent[]
  const incoming = Array.isArray(raw) ? raw : raw?.events
  if (!Array.isArray(incoming) || !incoming.length) {
    return res.status(202).json({ accepted: 0 })
  }

  const rows = incoming
    .slice(0, MAX_BATCH)
    .map((e) => {
      const type = String(e?.event_type || "").trim().slice(0, MAX_TYPE_LEN)
      if (!type) return null
      return {
        seller_id: sellerId,
        key_id: r.embed_key_id ?? null,
        origin: r.embed_origin ?? null,
        session_id: e.session_id ? String(e.session_id).slice(0, 64) : null,
        event_type: type,
        product_id: e.product_id ? String(e.product_id).slice(0, 64) : null,
        order_id: e.order_id ? String(e.order_id).slice(0, 64) : null,
        metadata:
          e.metadata && typeof e.metadata === "object" ? e.metadata : null,
      }
    })
    .filter(Boolean) as Record<string, unknown>[]

  if (!rows.length) {
    return res.status(202).json({ accepted: 0 })
  }

  // Respond immediately; persist without blocking the beacon.
  res.status(202).json({ accepted: rows.length })

  try {
    const analytics = req.scope.resolve(
      EMBED_ANALYTICS_MODULE
    ) as EmbedAnalyticsService
    await analytics.createEmbedEvents(rows)
  } catch (err) {
    log.warn(`[embed/events] persist failed for ${sellerId}`, err)
  }
}
