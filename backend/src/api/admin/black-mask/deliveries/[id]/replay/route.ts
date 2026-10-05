import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../../shared/logger"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../../../../../shared/feature-flags"

const log = createLogger("api/admin/black-mask/deliveries/[id]/replay")

/**
 * POST /admin/black-mask/deliveries/:id/replay -- put a DEAD Black Mask
 * delivery back on the queue (pending, attempt 0, due now). The next drain
 * (every minute) claims and sends it with a fresh signature and, for
 * `placed`, a freshly resolved email.
 *
 * Only DEAD rows (409 otherwise): a pending/failed row is already on its
 * ladder and a succeeded row would be a duplicate. Replaying is safe from
 * FBM's side because the event_id is unchanged and the receiver dedupes on it.
 *
 * Dark (404) while FF_BLACK_MASK_PROVISIONING_V1 is off.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")) {
    return res.status(404).json({
      type: "feature_disabled",
      message: `Feature flag ${PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1} is disabled`,
    })
  }

  const id = (req.params as { id?: string } | undefined)?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const service = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  try {
    const delivery = await service.replayBlackMaskDelivery(id)
    return res.json({ delivery, queued: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Replay failed"
    if (/^No delivery/.test(message)) return res.status(404).json({ message })
    if (/not a Black Mask delivery|not dead/.test(message)) {
      return res.status(409).json({ message })
    }
    log.error(`[replay] delivery ${id}`, err)
    return res.status(500).json({ message: "Replay failed" })
  }
}
