import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { createStripeAchService } from "../../../../modules/hawala-ledger/stripe-ach"
import { applyVendorChargeEvent } from "../../../../shared/vendor-charge-execution"

const log = createLogger("api/webhooks/vendor-billing/stripe")

/**
 * POST /webhooks/vendor-billing/stripe
 *
 * Settles vendor charges from Stripe payment_intent events. This is the slow
 * half of collection: cards usually settle synchronously in `executeCharge`,
 * but ACH sits in `processing` for days and only this webhook finishes it.
 *
 * Shares the Stripe account (and webhook secret) with the hawala rails, so
 * only events whose `metadata.type === "vendor_charge"` are touched —
 * everything else is acknowledged and ignored. Signature verification reuses
 * `StripeAchService.handleWebhook`, the same constructEvent wrapper the hawala
 * endpoint uses; the interesting logic lives in `applyVendorChargeEvent`,
 * which is what the unit tests exercise.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const signature = req.headers["stripe-signature"] as string
  if (!signature) {
    return res.status(400).json({ error: "Missing Stripe signature" })
  }

  const rawBody = (req as MedusaRequest & { rawBody?: Buffer }).rawBody
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    // Without the raw bytes, constructEvent verifies nothing.
    log.error("Webhook raw body missing — check preserveRawBody middleware")
    return res.status(400).json({ error: "Invalid request body format" })
  }

  try {
    const event = await createStripeAchService().handleWebhook(
      rawBody,
      signature
    )
    const result = await applyVendorChargeEvent(req.scope, event)

    if (result.handled) {
      log.info(`vendor charge webhook: ${event.type} -> ${result.outcome}`)
    }
    // 200 for ignored events too — a non-2xx makes Stripe retry traffic that
    // was never ours to handle.
    return res.json({ received: true, outcome: result.outcome })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error(`vendor charge webhook failed: ${message}`)
    return res.status(400).json({ error: "Webhook verification failed" })
  }
}
