import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { CHANNEL_CONNECTOR_MODULE } from "../../../../modules/channel-connector/module-key"
import type ChannelConnectorService from "../../../../modules/channel-connector/service"

const log = createLogger("api/vendor/channels/orders")

/**
 * GET /vendor/channels/orders — orders channels sold on this vendor's behalf.
 *
 * These are deliberately not Medusa orders. A channel order has already been
 * paid for elsewhere, so forcing it through FBM's checkout would invent a
 * payment that never happened. What the vendor needs from it is what they
 * earned and whether they still owe a shipment, and that is what this returns.
 *
 * `channel_fee_amount` is included because it is the difference between what
 * the buyer paid and what the vendor receives — reporting the gross alone is
 * how an integration ends up overstating someone's income.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const service = req.scope.resolve<ChannelConnectorService>(
      CHANNEL_CONNECTOR_MODULE
    )
    const rows = (await service.listOrdersForSeller(sellerId)) as unknown as {
      id: string
      channel_id: string
      external_id: string
      placed_at: Date
      currency_code: string
      total_amount: number
      channel_fee_amount: number | null
      buyer_name: string | null
      items: unknown
      inventory_applied: boolean
      inventory_report: { skipped?: unknown[] } | null
      fulfilled_at: Date | null
      tracking_number: string | null
      fulfillment_reported_at: Date | null
      fulfillment_error: string | null
    }[]

    return res.json({
      orders: (rows ?? []).map((o) => ({
        id: o.id,
        channel_id: o.channel_id,
        external_id: o.external_id,
        placed_at: o.placed_at,
        currency_code: o.currency_code,
        total_amount: Number(o.total_amount),
        channel_fee_amount:
          o.channel_fee_amount === null ? null : Number(o.channel_fee_amount),
        /** Gross minus the channel's cut — what the vendor actually earned. */
        net_amount:
          Number(o.total_amount) - Number(o.channel_fee_amount ?? 0),
        buyer_name: o.buyer_name,
        items: o.items ?? [],
        fulfilled: Boolean(o.fulfilled_at),
        fulfilled_at: o.fulfilled_at,
        tracking_number: o.tracking_number,
        /** True once the channel has accepted the shipment report. */
        fulfillment_reported: Boolean(o.fulfillment_reported_at),
        fulfillment_error: o.fulfillment_error,
        /**
         * Surfaced because an order whose stock never moved is one the vendor
         * may be about to oversell — the same lines the sync job warns about,
         * shown against the order they came from.
         */
        unmatched_lines: (o.inventory_report?.skipped ?? []).length,
      })),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/channels/orders] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load channel orders" })
  }
}
