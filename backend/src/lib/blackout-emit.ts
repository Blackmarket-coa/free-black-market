import { createLogger } from "../shared/logger"
const log = createLogger("lib/blackout-emit")
import type { MedusaContainer } from "@medusajs/framework/types"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Fire-and-forget emit onto the global Blackout outbound channel (§1-§3).
 *
 * Resolves the webhooks module and enqueues the event; the drain job ships it.
 * Errors are swallowed and logged so a webhook hiccup never breaks the business
 * flow (order placement, refund, etc.) that triggered it. No-ops silently when
 * the emitter is unconfigured. Returns the eventId on enqueue, else null.
 */
export async function emitBlackoutEvent(
  container: MedusaContainer,
  type: string,
  fields: Record<string, unknown>,
  opts: { eventId?: string; metadata?: Record<string, unknown> } = {}
): Promise<string | null> {
  try {
    const webhooks = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    const result = await webhooks.emitBlackout(type, fields, opts)
    return result ? opts.eventId ?? null : null
  } catch (err) {
    log.error(
      `[blackout-emit] failed to enqueue ${type}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}
