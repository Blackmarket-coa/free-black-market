import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../modules/marketplace-webhooks/service"
import { WebhookDeliveryStatus } from "../../../../modules/marketplace-webhooks/models/webhook-delivery"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../../../shared/feature-flags"

/**
 * GET /admin/black-mask/deliveries -- Black Mask provisioning channel health
 * (F3), mirroring /admin/blackstar/deliveries.
 *
 * Defaults to what needs a human: DEAD (ladder exhausted) and FAILED
 * (retrying). `status=pending|succeeded|failed|dead` filters to one. Rows
 * carry the stored payload (FBM ids, plan, seats), attempt count and the last
 * response code/excerpt. No row holds an email or a request body: the email
 * is resolved at send time and never stored.
 *
 * Dark (404) while FF_BLACK_MASK_PROVISIONING_V1 is off: the matcher in
 * api/middlewares.ts says so, and the handler repeats it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")) {
    return res.status(404).json({
      type: "feature_disabled",
      message: `Feature flag ${PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1} is disabled`,
    })
  }

  const requested =
    typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : ""
  const valid = Object.values(WebhookDeliveryStatus) as string[]
  if (requested && !valid.includes(requested)) {
    return res.status(400).json({ message: `status must be one of ${valid.join(", ")}` })
  }

  const service = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  const limit = Number(req.query.limit)
  const deliveries = await service.listBlackMaskDeliveries({
    status: requested
      ? (requested as WebhookDeliveryStatus)
      : [WebhookDeliveryStatus.DEAD, WebhookDeliveryStatus.FAILED],
    ...(Number.isFinite(limit) ? { limit } : {}),
  })

  return res.json({
    deliveries,
    count: deliveries.length,
    filter: requested || "dead,failed",
  })
}
