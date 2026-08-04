import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../../../shared/logger"
import { requireSellerId } from "../../../../../../shared"
import { CHANNEL_CONNECTOR_MODULE } from "../../../../../../modules/channel-connector/module-key"
import type ChannelConnectorService from "../../../../../../modules/channel-connector/service"

const log = createLogger("api/vendor/channels/orders/fulfillment")

type Body = {
  tracking_number?: string
  carrier?: string
}

/**
 * POST /vendor/channels/orders/:id/fulfillment — record a shipment.
 *
 * Writes local truth only; `jobs/channel-fulfillment-sync` carries it to the
 * channel. Deliberately not a synchronous push: a vendor marking a parcel
 * posted must not fail because the marketplace is rate-limiting, and a report
 * that is retried until accepted is worth more than one that succeeded or
 * vanished depending on the minute it was attempted.
 *
 * Ownership is checked against the seller, not assumed from the id — the id
 * comes from the client, and one vendor must not be able to mark another
 * vendor's order shipped.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const id = req.params.id
  const body = req.validatedBody ?? req.body ?? {}

  try {
    const service = req.scope.resolve<ChannelConnectorService>(
      CHANNEL_CONNECTOR_MODULE
    )

    const owned = (await service.listChannelOrderRecords({
      id,
      seller_id: sellerId,
    })) as unknown as { id: string }[]

    if (!owned?.length) {
      // 404 rather than 403: confirming the order exists but belongs to
      // somebody else would leak that it exists at all.
      return res
        .status(404)
        .json({ type: "not_found", message: "Channel order not found." })
    }

    await service.markFulfilled({
      id,
      carrier: body.carrier?.trim() || null,
      tracking_number: body.tracking_number?.trim() || null,
    })

    return res.json({
      id,
      fulfilled: true,
      // Honest about what has and has not happened yet.
      fulfillment_reported: false,
      message: "Shipment recorded. It will be reported to the channel shortly.",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/channels/orders/:id/fulfillment] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to record shipment" })
  }
}
