import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../../shared/logger"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"

const log = createLogger("api/admin/blackstar/deliveries/[id]/replay")

/**
 * POST /admin/blackstar/deliveries/:id/replay — put a dead delivery back on
 * the queue, and by default attempt it immediately so the operator gets an
 * answer in the same request rather than watching the drain job.
 *
 * Safe from FBM's side by construction: the envelope's `event_id` is
 * unchanged and Blackstar's inbound receipt table dedupes on it, so replaying
 * something Blackstar did receive is a no-op there. A SUCCEEDED delivery is
 * refused all the same — that is a duplicate, not a retry, and "they would
 * dedupe it" is not a reason to send it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const body = (req.body ?? {}) as { attempt_now?: unknown }
  const attemptNow = body.attempt_now !== false

  const service = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  try {
    const result = await service.replayBlackstarDelivery(id, { attemptNow })
    return res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Replay failed"
    if (/No delivery/.test(message)) return res.status(404).json({ message })
    if (/not a Blackstar delivery|already succeeded/.test(message)) {
      return res.status(409).json({ message })
    }
    log.error(`[replay] delivery ${id}`, err)
    return res.status(500).json({ message: "Replay failed" })
  }
}
