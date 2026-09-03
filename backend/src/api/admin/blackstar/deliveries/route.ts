import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../modules/marketplace-webhooks/service"
import { WebhookDeliveryStatus } from "../../../../modules/marketplace-webhooks/models/webhook-delivery"

/**
 * GET /admin/blackstar/deliveries — outbound bridge health.
 *
 * Defaults to what needs a human: DEAD (retries exhausted) and FAILED
 * (retrying). Pass `status=succeeded|pending` for the rest. Each row is the
 * delivery record itself — envelope, attempt count, last response code and
 * body — because "it failed" is not a diagnosis and the response body usually
 * is.
 *
 * Until this route existed, a delivery that died was invisible from every
 * screen. See `listBlackstarDeliveries`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  const requested =
    typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : ""
  const valid = Object.values(WebhookDeliveryStatus) as string[]
  if (requested && !valid.includes(requested)) {
    return res
      .status(400)
      .json({ message: `status must be one of ${valid.join(", ")}` })
  }

  const limit = Number(req.query.limit)
  const deliveries = await service.listBlackstarDeliveries({
    status: requested
      ? (requested as WebhookDeliveryStatus)
      : [WebhookDeliveryStatus.DEAD, WebhookDeliveryStatus.FAILED],
    ...(Number.isFinite(limit) ? { limit } : {}),
  })

  return res.json({
    deliveries,
    count: (deliveries as unknown[]).length,
    filter: requested || "dead,failed",
  })
}
