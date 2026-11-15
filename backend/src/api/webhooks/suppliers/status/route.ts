import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SUPPLIER_FORWARDING_MODULE } from "../../../../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../../../../modules/supplier-forwarding/service"
import { ManualFulfillmentStatus } from "../../../../modules/supplier-forwarding/models"
import { isAllowedManualFulfillmentTransition } from "../../../../modules/supplier-forwarding/manual-fulfillment-transitions"
import {
  SUPPLIER_WEBHOOK_SIGNATURE_HEADER,
  supplierWebhookSecret,
  verifySupplierWebhookSignature,
} from "../../../../modules/supplier-forwarding/webhook-auth"
import { forbidden } from "../../../../shared/community-read-access"
import { createLogger } from "../../../../shared/logger"

const log = createLogger("api/webhooks/suppliers/status")

/**
 * POST /webhooks/suppliers/status — a supplier reports the manual-fulfillment
 * status of an order FBM forwarded to it.
 *
 * Public route, so every refusal happens here, in this order, before anything
 * is written:
 *
 *   1. `SUPPLIER_WEBHOOK_SECRET` unset or shorter than 32 characters ⇒ 503.
 *      A webhook that cannot be verified is not a webhook; nothing is read.
 *   2. No raw body ⇒ 400 (the `/webhooks/suppliers/status` entry in
 *      `src/api/middlewares.ts` sets `preserveRawBody`; without it there is
 *      nothing to verify).
 *   3. `x-fbm-signature` is not the HMAC of the raw body under the key derived
 *      for the body's `supplier_id` ⇒ 401. See `webhook-auth.ts`.
 *   4. Body fails the schema ⇒ 400.
 *   5. The supplier has no active profile, or no forwarding attempt exists for
 *      this order and this supplier ⇒ 403 (`forbidden()`: one answer for "no
 *      such order" and "not yours", so a supplier cannot map other orders).
 *   6. The status is not reachable from the order's current status in the
 *      manual-fulfillment state machine ⇒ 409. Repeating the current status
 *      is a re-delivery: 200, `duplicate: true`, nothing written.
 *
 * Rate limited per client IP by `supplierWebhookRateLimiter` in the same
 * middlewares entry.
 */
export const AUTHENTICATE = false

const schema = z.object({
  order_id: z.string().min(1).max(128),
  supplier_id: z.string().min(1).max(128),
  status: z.nativeEnum(ManualFulfillmentStatus),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const secret = supplierWebhookSecret()
  if (!secret) {
    return res.status(503).json({
      message: "Supplier webhook not configured",
      type: "not_configured",
    })
  }

  const rawBody: unknown = req.rawBody
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return res.status(400).json({ message: "Missing request body", type: "invalid_data" })
  }

  // The claimed supplier picks the key. Nothing else in the body is trusted
  // until the signature over the raw bytes has been checked.
  const claimed = (req.body as { supplier_id?: unknown } | undefined)?.supplier_id
  const signature = req.headers[SUPPLIER_WEBHOOK_SIGNATURE_HEADER]
  if (
    typeof claimed !== "string" ||
    claimed.length === 0 ||
    !verifySupplierWebhookSignature({
      secret,
      supplierId: claimed,
      rawBody,
      signature: typeof signature === "string" ? signature : undefined,
    })
  ) {
    return res.status(401).json({ message: "Invalid signature", type: "unauthorized" })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid supplier status payload", type: "invalid_data" })
  }
  const body = parsed.data

  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)

  const [profile] = await service.listSupplierProfiles(
    { supplier_id: body.supplier_id, is_active: true },
    { take: 1 }
  )
  if (!profile) {
    log.warn(`supplier status webhook from inactive or unknown supplier ${body.supplier_id}`)
    return forbidden(res)
  }

  const [attempt] = await service.listForwardingAttempts(
    { order_id: body.order_id, supplier_id: body.supplier_id },
    { take: 1 }
  )
  if (!attempt) {
    log.warn(`supplier ${body.supplier_id} reported status for order ${body.order_id} it was never forwarded`)
    return forbidden(res)
  }

  const [latest] = await service.listManualFulfillmentUpdates(
    { order_id: body.order_id, supplier_id: body.supplier_id },
    { order: { created_at: "DESC" }, take: 1 }
  )
  const currentStatus = (latest?.status as ManualFulfillmentStatus | undefined) ?? ManualFulfillmentStatus.PENDING

  if (currentStatus === body.status) {
    return res.status(200).json({ received: true, duplicate: true, status: currentStatus })
  }

  if (!isAllowedManualFulfillmentTransition(currentStatus, body.status)) {
    return res.status(409).json({
      message: `Invalid status transition from ${currentStatus} to ${body.status}`,
      type: "invalid_transition",
      current_status: currentStatus,
    })
  }

  const update = await service.createManualFulfillmentUpdates({
    order_id: body.order_id,
    supplier_id: body.supplier_id,
    status: body.status,
    notes: body.notes,
    source: "supplier_webhook",
    metadata: body.metadata,
  })

  return res.status(200).json({ received: true, update })
}
