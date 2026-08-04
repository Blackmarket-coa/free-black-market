import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { CHANNEL_CONNECTOR_MODULE } from "../../../modules/channel-connector/module-key"
import type ChannelConnectorService from "../../../modules/channel-connector/service"
import {
  CHANNEL_CATALOG,
  getChannelDefinition,
} from "../../../modules/channel-connector/catalog"
import { getChannelAdapter } from "../../../modules/channel-connector/adapters"

const log = createLogger("api/vendor/channels")

/**
 * GET /vendor/channels — the channels this vendor can connect, and their state.
 *
 * Returns the catalogue joined to the seller's connections rather than only
 * what they have connected: the list is also the place a vendor discovers a
 * channel exists, and a screen that renders nothing until you have already
 * done the thing is not a way in.
 *
 * The access token is never returned. A vendor who needs it has it already;
 * echoing it back only widens where it can leak.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const service = req.scope.resolve<ChannelConnectorService>(
      CHANNEL_CONNECTOR_MODULE
    )
    const connections = await service.listForSeller(sellerId)
    const byChannel = new Map(connections.map((c) => [c.channel_id, c]))

    return res.json({
      channels: CHANNEL_CATALOG.map((definition) => {
        const connection = byChannel.get(definition.id)
        const adapter = getChannelAdapter(definition.id)
        return {
          id: definition.id,
          display_name: definition.display_name,
          description: definition.description,
          // Read from the adapter, not the catalogue: the catalogue is what we
          // advertise and the adapter is what actually runs. A drift test holds
          // them equal, and this reports the one that is true.
          capabilities: adapter?.capabilities ?? [],
          available: Boolean(adapter),
          credential_hint: definition.credential_hint,
          credential_url: definition.credential_url,
          connected: Boolean(connection),
          enabled: connection?.enabled ?? false,
          last_synced_at: connection?.last_synced_at ?? null,
          orders_synced_through: connection?.orders_synced_through ?? null,
          last_error: connection?.last_error ?? null,
          // Phase 12. A connection that is enabled but standing down looks
          // identical to a healthy idle one from the outside, and a vendor
          // watching orders not arrive deserves better than silence. The two
          // fields say different things and the panel should too: `throttled_
          // until` is "we are waiting, this resolves itself", `needs_reauth` is
          // "nothing will happen until you paste a new token".
          throttled_until: connection?.throttled_until ?? null,
          needs_reauth: connection?.needs_reauth ?? false,
        }
      }),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/channels] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load channels" })
  }
}

type ConnectBody = {
  channel_id?: string
  access_token?: string
  /** Optional, for pointing at a sandbox. Defaults to the catalogue value. */
  api_base_url?: string
  options?: Record<string, unknown>
}

/**
 * POST /vendor/channels — connect or re-enter credentials for a channel.
 *
 * Upserts, because re-entering a token is what a vendor does when one expires.
 * Making that a conflict would push them toward deleting and recreating the
 * connection, which discards the listing map and duplicates their entire
 * catalogue on the next push.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ConnectBody>,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = req.validatedBody ?? req.body ?? {}
  const channelId = (body.channel_id ?? "").trim()
  const accessToken = (body.access_token ?? "").trim()

  const definition = getChannelDefinition(channelId)
  if (!definition) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Unknown channel "${channelId}".`,
    })
  }
  if (!getChannelAdapter(channelId)) {
    // Catalogued but not shipped in this build — a real state after a
    // rollback, and honest to say so rather than accepting credentials for
    // something that cannot run.
    return res.status(409).json({
      type: "channel_unavailable",
      message: `${definition.display_name} is not available on this deployment.`,
    })
  }
  if (!accessToken) {
    return res.status(400).json({
      type: "invalid_data",
      message: "An access token is required.",
    })
  }

  try {
    const service = req.scope.resolve<ChannelConnectorService>(
      CHANNEL_CONNECTOR_MODULE
    )
    const connection = await service.upsertConnection({
      seller_id: sellerId,
      channel_id: channelId,
      api_base_url: (body.api_base_url ?? "").trim() || definition.api_base_url,
      access_token: accessToken,
      options: body.options ?? null,
    })

    // Deliberately not echoing the token back.
    return res.status(201).json({
      channel_id: connection.channel_id,
      connected: true,
      enabled: connection.enabled,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/channels] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to connect channel" })
  }
}
