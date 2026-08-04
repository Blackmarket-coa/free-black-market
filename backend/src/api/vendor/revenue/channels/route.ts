import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { collectCrossChannelRevenue } from "../../../../shared/cross-channel-revenue"
import { bestNetChannel } from "../../../../modules/payout-breakdown/channel-revenue"

const log = createLogger("api/vendor/revenue/channels")

const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365

/**
 * GET /vendor/revenue/channels — what this vendor actually earned, per channel.
 *
 * The one place true net revenue is visible. A vendor reading gross figures
 * from three dashboards cannot tell which channel is worth their effort:
 * Faire, Etsy and Amazon all take their cut before the money arrives, so a
 * channel with higher sales can be worth less than a quieter one.
 *
 * Not plan-gated. It reports on the vendor's own money, and gating it would
 * hide the take-rate comparison from exactly the sellers most exposed to a bad
 * one — the same reasoning as `/vendor/billing` and `/vendor/usage`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const requested = Number(req.query.days ?? DEFAULT_WINDOW_DAYS)
  // Clamped rather than rejected: an out-of-range window is a narrower answer,
  // not an error, and 400-ing a dashboard read helps nobody.
  const days = Number.isFinite(requested)
    ? Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(requested)))
    : DEFAULT_WINDOW_DAYS

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  try {
    const revenue = await collectCrossChannelRevenue(req.scope, sellerId, {
      since,
      currencyCode:
        typeof req.query.currency_code === "string"
          ? req.query.currency_code
          : undefined,
    })

    return res.json({
      window_days: days,
      since,
      ...revenue,
      /**
       * Only set when there is a real comparison to make — two or more
       * earning channels. "Your best channel is your only channel" is not a
       * finding, and presenting it as one would erode trust in the rest.
       */
      best_net_channel: bestNetChannel(revenue),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/revenue/channels] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load channel revenue" })
  }
}
