import { createLogger } from "../shared/logger"
const log = createLogger("jobs/drain-black-mask-provisioning")
import { MedusaContainer } from "@medusajs/framework/types"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"
import {
  blackMaskProvisioningConfig,
  isBlackMaskProvisioningEnabled,
} from "../modules/marketplace-webhooks/black-mask"
import { makeBlackMaskCustomerLookup } from "../lib/black-mask-provisioning"

/**
 * Scheduled Job: send due Black Mask provisioning deliveries (F3).
 *
 * Separate from drain-webhook-deliveries on purpose: these rows are claimed
 * before sending, time out after 10s, and climb an 8-attempt / ~45h ladder,
 * and a slow Black Mask receiver must not stall the Blackout and Blackstar
 * channels. Does nothing (and resolves nothing) while
 * FF_BLACK_MASK_PROVISIONING_V1 is off or the channel config is incomplete;
 * queued rows wait, with no attempt burned.
 */
export default async function drainBlackMaskProvisioningJob(container: MedusaContainer) {
  if (!isBlackMaskProvisioningEnabled() || !blackMaskProvisioningConfig()) {
    return { attempted: 0, sent: 0 }
  }
  const webhooks = container.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  try {
    const result = await webhooks.drainBlackMaskDeliveries({
      limit: 25,
      lookupCustomer: makeBlackMaskCustomerLookup(container),
    })
    if (result.attempted > 0) {
      log.info(`[Black Mask Drain] attempted ${result.attempted}, delivered ${result.sent}`)
    }
    return result
  } catch (error) {
    log.error("[Black Mask Drain] error draining deliveries:", error)
    throw error
  }
}

export const config = {
  name: "drain-black-mask-provisioning",
  schedule: "*/1 * * * *",
}
