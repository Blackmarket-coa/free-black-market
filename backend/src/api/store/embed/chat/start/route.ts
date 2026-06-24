import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { getMatrixService } from "../../../../../shared/matrix-service"
import type { EmbedRequest } from "../../../../middlewares/embed-key"

const log = createLogger("api/store/embed/chat/start")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function blackoutBase(): string {
  return (process.env.BLACKOUT_BASE_URL || "https://theblackout.app").replace(
    /\/$/,
    ""
  )
}

/**
 * POST /store/embed/chat/start  (publishable key required)
 *
 * Opens a conversation between a website visitor and the vendor. Preferred
 * path: create a private Matrix room, invite the vendor's mxid, and post the
 * visitor's first message — returning a widget URL the embed can iframe. If
 * Matrix is unconfigured/unreachable or the vendor has no mxid, we gracefully
 * fall back to emailing the vendor and still return a usable response.
 *
 * Body: { customer_email, message, customer_name? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as EmbedRequest).embed_seller_id
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Missing embed context", type: "unauthorized" })
  }

  const body = (req.body ?? {}) as {
    customer_email?: string
    customer_name?: string
    message?: string
  }
  const customer_email = String(body.customer_email || "").trim().toLowerCase()
  const message = String(body.message || "").trim().slice(0, 4000)
  const customer_name = body.customer_name?.trim().slice(0, 120) || null

  if (!customer_email || !EMAIL_RE.test(customer_email) || !message) {
    return res.status(400).json({
      message: "customer_email and message are required",
      type: "invalid_data",
    })
  }

  try {
    const query = req.scope.resolve("query")
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "name", "handle", "email"],
      filters: { id: sellerId } as any,
    })
    const seller = sellers?.[0]
    if (!seller) {
      return res
        .status(404)
        .json({ message: "Vendor not found", type: "not_found" })
    }

    let vendorMxid: string | null = null
    try {
      const { data: metaRows } = await query.graph({
        entity: "seller_metadata",
        fields: ["mxid"],
        filters: { seller_id: sellerId } as any,
      })
      vendorMxid = metaRows?.[0]?.mxid ?? null
    } catch {
      /* non-fatal */
    }

    const matrix = getMatrixService()
    const intro = `New website message from ${customer_name || "a visitor"} (${customer_email}):\n\n${message}`

    // ── Preferred: Matrix room ────────────────────────────────────────────
    if (matrix && vendorMxid) {
      // Stable-ish alias per visitor+vendor so repeat messages reuse a room.
      const localpart = customer_email.split("@")[0]
      const alias = matrix.sanitizeLocalpart(
        `embed-${seller.handle || sellerId}-${localpart}`
      )
      const roomId = await matrix.ensureRoom({
        alias,
        name: `${seller.name || "Vendor"} ↔ ${customer_name || customer_email}`,
        topic: `Embed chat with ${customer_email}`,
        invite: [vendorMxid],
      })

      if (roomId) {
        await matrix.invite(roomId, vendorMxid)
        await matrix.sendMessage(roomId, intro)
        return res.status(201).json({
          channel: "matrix",
          room_id: roomId,
          widget_url: `${blackoutBase()}/embed/room/${encodeURIComponent(roomId)}`,
        })
      }
      log.warn(`[embed/chat] room creation failed for ${sellerId}; emailing`)
    }

    // ── Fallback: email the vendor ────────────────────────────────────────
    const to = seller.email
    if (to) {
      try {
        const notification = req.scope.resolve("notification") as any
        await notification.createNotifications({
          to,
          channel: "email",
          template: "embed-chat-message",
          data: {
            vendor_name: seller.name ?? null,
            customer_email,
            customer_name,
            message,
          },
        })
      } catch (err) {
        log.warn(`[embed/chat] email fallback failed for ${sellerId}`, err)
      }
    }

    return res.status(201).json({
      channel: "email",
      room_id: null,
      widget_url: null,
      message:
        "Your message was sent to the vendor — they'll reply to your email.",
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /store/embed/chat/start] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to start chat", type: "server_error" })
  }
}
