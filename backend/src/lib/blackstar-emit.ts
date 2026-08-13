import { createLogger } from "../shared/logger"
const log = createLogger("lib/blackstar-emit")
import type { MedusaContainer } from "@medusajs/framework/types"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Fire-and-forget emit onto the global Blackstar outbound channel — the
 * FBM→Blackstar half of the federated-logistics bridge.
 *
 * Resolves the webhooks module and enqueues the event; the drain job ships it
 * with the timestamped-HMAC contract signature. Errors are swallowed and
 * logged so a bridge hiccup never breaks the business flow (order placement,
 * fulfillment, cancellation) that triggered it. No-ops silently when the
 * channel is unconfigured. Returns the eventId on enqueue, else null.
 */
export async function emitBlackstarEvent(
  container: MedusaContainer,
  type: string,
  payload: Record<string, unknown>,
  opts: { eventId?: string; correlationId?: string } = {}
): Promise<string | null> {
  try {
    const webhooks = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    const result = await webhooks.emitBlackstar(type, payload, opts)
    return result ? opts.eventId ?? null : null
  } catch (err) {
    log.error(
      `[blackstar-emit] failed to enqueue ${type}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}
