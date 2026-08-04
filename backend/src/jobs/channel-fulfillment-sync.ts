import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { CHANNEL_CONNECTOR_MODULE } from "../modules/channel-connector/module-key"
import type ChannelConnectorService from "../modules/channel-connector/service"
import type { ConnectionRow } from "../modules/channel-connector/service"
import { getChannelAdapter } from "../modules/channel-connector/adapters"
import { ChannelApiError } from "../modules/channel-connector/types"

const log = createLogger("jobs/channel-fulfillment-sync")

export type FulfillmentSyncResult = {
  connections: number
  pending: number
  reported: number
  failed: number
}

/**
 * Report shipments back to the channels that sold them.
 *
 * The outbound half of Phase 10. A marketplace that never sees tracking treats
 * the order as unfulfilled: Amazon and Etsy penalise the seller account for it,
 * and even on gentler channels the buyer opens a ticket the vendor has to
 * answer. Reporting is not optional politeness — it is part of having sold
 * through the channel at all.
 *
 * Recording and reporting are separate steps, for the same reason ingestion
 * splits recording from decrementing: a vendor marking a parcel posted must
 * never be blocked by the channel being unreachable. `POST .../fulfillment`
 * writes `fulfilled_at` immediately; this job carries it outward and stamps
 * `fulfillment_reported_at` only once the channel has accepted it. Until then
 * the row stays on the work list, so a failed report is retried rather than
 * lost — which is the whole point, because a silently dropped report looks
 * identical to a shipment that never happened.
 *
 * A rejection is recorded and skipped; only a retryable failure is left for the
 * next pass. A 422 on a malformed shipment will fail identically forever, and
 * retrying it every ten minutes would bury the reports that could still succeed.
 */
export async function processChannelFulfillmentSync(
  container: MedusaContainer
): Promise<FulfillmentSyncResult> {
  const result: FulfillmentSyncResult = {
    connections: 0,
    pending: 0,
    reported: 0,
    failed: 0,
  }

  const service = container.resolve<ChannelConnectorService>(
    CHANNEL_CONNECTOR_MODULE
  )

  const connections = (await service.listChannelConnections(
    {}
  )) as unknown as ConnectionRow[]

  for (const connection of connections) {
    if (!connection.enabled) continue

    const adapter = getChannelAdapter(connection.channel_id)
    if (!adapter?.supports("push_fulfillment") || !adapter.pushFulfillment) {
      // A channel that does not accept shipment reports is not a failure —
      // it is a declared capability gap, and the rows simply stay unreported.
      continue
    }

    const pending = (
      await service.listUnreportedFulfillments(connection.channel_id)
    ).filter((f) => f.seller_id === connection.seller_id)

    if (!pending.length) continue

    result.connections++
    result.pending += pending.length

    const credentials = service.toCredentials(connection)

    for (const shipment of pending) {
      try {
        await adapter.pushFulfillment(
          {
            external_order_id: shipment.external_id,
            carrier: shipment.carrier,
            tracking_number: shipment.tracking_number,
            shipped_at: shipment.fulfilled_at ?? new Date(),
          },
          credentials
        )
        await service.markFulfillmentReported(shipment.id)
        result.reported++
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown channel error"
        result.failed++
        await service
          .recordFulfillmentError(shipment.id, message)
          .catch(() => undefined)

        if (err instanceof ChannelApiError && err.retryable) {
          // Rate limited or the channel is down — the rest of this
          // connection's queue will hit the same wall, so stop and let the
          // next pass retry rather than burning through it.
          break
        }
      }
    }
  }

  if (result.pending) {
    log.info(
      `[channel-fulfillment] ${result.connections} connections: ` +
        `${result.reported}/${result.pending} shipments reported, ${result.failed} failed`
    )
  }

  return result
}

export default async function channelFulfillmentSync(
  container: MedusaContainer
) {
  await processChannelFulfillmentSync(container)
}

export const config = {
  name: "channel-fulfillment-sync",
  // Every 10 minutes. Faster than the listing push because the penalty for a
  // late shipment report falls on the vendor's channel account, not on us.
  schedule: "*/10 * * * *",
}
