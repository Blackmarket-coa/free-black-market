import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/printful/webhooks")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHmac, timingSafeEqual } from "crypto"

type PrintfulWebhookPayload = {
  type?: string
  data?: Record<string, unknown>
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payload = (req.body || {}) as PrintfulWebhookPayload

  try {
    const valid = verifyPrintfulSignature(req, payload)

    if (!valid) {
      return res.status(401).json({ error: "Invalid Printful webhook signature" })
    }

    const eventType = payload.type || "unknown"

    switch (eventType) {
      case "package_shipped":
        log.info("Printful package_shipped webhook received", payload.data)
        break
      case "order_failed":
        log.warn("Printful order_failed webhook received", payload.data)
        break
      case "order_canceled":
        log.info("Printful order_canceled webhook received", payload.data)
        break
      case "product_synced":
        log.info("Printful product_synced webhook received", payload.data)
        break
      default:
        log.info(`Unhandled Printful webhook event: ${eventType}`)
        break
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    log.error("Failed to process Printful webhook", error)
    return res.status(500).json({ error: "Failed to process webhook" })
  }
}

function verifyPrintfulSignature(req: MedusaRequest, payload: PrintfulWebhookPayload): boolean {
  const secret = process.env.PRINTFUL_WEBHOOK_SECRET

  if (!secret) {
    return true
  }

  const signature = String(req.headers["x-printful-signature"] || "")
  if (!signature) {
    return false
  }

  const rawBody = ((req as any).rawBody && Buffer.isBuffer((req as any).rawBody))
    ? (req as any).rawBody.toString("utf8")
    : JSON.stringify(payload)

  const digest = createHmac("sha256", secret).update(rawBody).digest("hex")

  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}
