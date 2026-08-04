import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { CHANNEL_CONNECTOR_MODULE } from "../modules/channel-connector/module-key"
import type ChannelConnectorService from "../modules/channel-connector/service"
import type { ConnectionRow } from "../modules/channel-connector/service"
import { getChannelAdapter } from "../modules/channel-connector/adapters"
import { ChannelApiError } from "../modules/channel-connector/types"
import { classifyFailure } from "../modules/channel-connector/throttle"

const log = createLogger("jobs/channel-fulfillment-sync")

export type FulfillmentSyncResult = {
  connections: number
  pending: number
  reported: number
  failed: number
  /** Connections skipped because they are standing down. Phase 12. */
  throttled: number
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
 *
 * **Phase 12:** a connection standing down is skipped entirely. Breaking out of
 * the inner loop on a retryable error was never enough on its own — the next
 * tick, ten minutes later, walked straight back into the same wall. The stored
 * `throttled_until` is what makes the pause outlive this run.
 */
export async function processChannelFulfillmentSync(
  container: MedusaContainer,
  options: { now?: Date } = {}
): Promise<FulfillmentSyncResult> {
  const now = options.now ?? new Date()
  const result: FulfillmentSyncResult = {
    connections: 0,
    pending: 0,
    reported: 0,
    failed: 0,
    throttled: 0,
  }

  const service = container.resolve<ChannelConnectorService>(
    CHANNEL_CONNECTOR_MODULE
  )

  const connections = (await service.listChannelConnections(
    {}
  )) as unknown as ConnectionRow[]

  for (const connection of connections) {
    if (!connection.enabled) continue

    // Checked before the work list is even read: a connection asked to wait
    // should cost the channel nothing at all, and a query here is free but the
    // request it would lead to is not.
    if (!service.mayAttempt(connection, now)) {
      result.throttled++
      continue
    }

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
    let reportedAny = false

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
        reportedAny = true
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown channel error"
        result.failed++
        await service
          .recordFulfillmentError(shipment.id, message)
          .catch(() => undefined)

        if (err instanceof ChannelApiError) {
          // Only failures that say something about the *connection*. A 422 is a
          // fact about one shipment, already recorded against that row by
          // `recordFulfillmentError` above — writing it here too would overwrite
          // the connection's error with a per-item one and cost a database
          // round trip per bad shipment.
          if (classifyFailure(err.status, err.retryAfterSeconds) !== "rejected") {
            await service
              .recordFailure({
                row: connection,
                status: err.status,
                retryAfterSeconds: err.retryAfterSeconds,
                message,
                now,
              })
              .catch(() => undefined)
          }

          if (err.retryable) {
            // Rate limited or the channel is down — the rest of this
            // connection's queue will hit the same wall, so stop and let the
            // stored backoff decide when to come back.
            break
          }
        }
      }
    }

    // Only on a call that actually worked. Clearing the stand-down after a run
    // where every shipment failed would erase the backoff just set, and the
    // next tick would walk straight back into the wall.
    if (reportedAny) {
      await service.recordSuccess(connection.id, now).catch(() => undefined)
    }
  }

  if (result.pending || result.throttled) {
    log.info(
      `[channel-fulfillment] ${result.connections} connections: ` +
        `${result.reported}/${result.pending} shipments reported, ` +
        `${result.failed} failed, ${result.throttled} standing down`
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
