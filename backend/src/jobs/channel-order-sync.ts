import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import {
  applyChannelInventory,
  loadSellerVariantContexts,
} from "../shared/channel-inventory"
import { CHANNEL_CONNECTOR_MODULE } from "../modules/channel-connector/module-key"
import type ChannelConnectorService from "../modules/channel-connector/service"
import type { ConnectionRow } from "../modules/channel-connector/service"
import { getChannelAdapter } from "../modules/channel-connector/adapters"
import {
  ChannelApiError,
  type ChannelOrder,
} from "../modules/channel-connector/types"
import {
  decideIngestion,
  nextOrderCursor,
  planChannelInventoryAdjustments,
} from "../modules/channel-connector/ingestion"

const log = createLogger("jobs/channel-order-sync")

/** How far back a never-synced connection reads on its first poll. */
const FIRST_POLL_LOOKBACK_DAYS = 7

export type OrderSyncResult = {
  connections: number
  fetched: number
  ingested: number
  replayed: number
  skipped: number
  unmatched_lines: number
  failed: number
  /** Connections skipped because they are standing down. Phase 12. */
  throttled: number
}

/**
 * Pull orders from connected channels and decrement one shared stock pool.
 *
 * Phase 10. The point is not that orders appear in FBM — it is that a channel
 * sale and an FBM sale move the *same* inventory, so a vendor cannot sell their
 * last jar twice. Everything else here follows from making that safe.
 *
 * **Recording and decrementing are separately resumable.** An order is written
 * with `inventory_applied: false`, then decremented, then stamped. Doing it in
 * one step is not possible, and either ordering alone is unsafe: decrement-then-
 * record double-decrements after a crash (phantom stockout, lost sales),
 * record-then-decrement never decrements (oversell, a cancelled order on a real
 * buyer). `decideIngestion` carries the full argument; the unique index on
 * `(channel_id, external_id)` is what makes a replay find the same row instead
 * of creating a second one.
 *
 * **The cursor advances to the latest order actually ingested, never to the
 * clock.** A clock cursor silently skips anything the channel had not yet
 * returned when the poll ran, and those orders are never seen again. Re-reading
 * is free here; advancing past an order is not.
 *
 * **A line whose SKU matches nothing is counted and reported, never ignored.**
 * An unmatched line means stock did not move for a sale that really happened,
 * and the vendor finds out by overselling. It is the single most important
 * thing this job can tell an operator.
 */
export async function processChannelOrderSync(
  container: MedusaContainer,
  options: { sellerId?: string; now?: Date } = {}
): Promise<OrderSyncResult> {
  const now = options.now ?? new Date()
  const result: OrderSyncResult = {
    connections: 0,
    fetched: 0,
    ingested: 0,
    replayed: 0,
    skipped: 0,
    unmatched_lines: 0,
    failed: 0,
    throttled: 0,
  }

  const service = container.resolve<ChannelConnectorService>(
    CHANNEL_CONNECTOR_MODULE
  )

  const connections = (await service.listChannelConnections(
    options.sellerId ? { seller_id: options.sellerId } : {}
  )) as unknown as ConnectionRow[]

  for (const connection of connections) {
    if (!connection.enabled) continue

    // Phase 12. A standing-down connection is skipped whole. Note what this
    // costs when it fires: orders are the time-critical direction, so a backoff
    // here widens the oversell window from one cron interval to the length of
    // the backoff. That is the right trade anyway — a channel that is rate-
    // limiting us is not going to hand over those orders faster for being asked
    // more often, and being suspended loses them entirely — but it is a real
    // cost, and it is why `needs_reauth` is surfaced to the vendor rather than
    // simply retried.
    if (!service.mayAttempt(connection, now)) {
      result.throttled++
      continue
    }

    const adapter = getChannelAdapter(connection.channel_id)
    if (!adapter?.supports("pull_orders") || !adapter.pullOrders) continue

    result.connections++

    const since =
      connection.orders_synced_through ??
      new Date(now.getTime() - FIRST_POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

    let orders: ChannelOrder[]
    try {
      orders = await adapter.pullOrders(since, service.toCredentials(connection))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown channel error"
      result.failed++
      // The cursor is deliberately left where it was: a failed poll must not
      // advance past orders it never saw.
      if (err instanceof ChannelApiError) {
        await service.recordFailure({
          row: connection,
          status: err.status,
          retryAfterSeconds: err.retryAfterSeconds,
          message,
          now,
        })
      } else {
        // Not a channel answer at all — a bug on our side, or the adapter
        // throwing before it reached the network. Recorded so the connection
        // still reads as stalled, but without a stand-down: pausing a channel
        // because of our own defect would hide it behind an apparent outage.
        await service.recordSync({ id: connection.id, error: message })
      }
      continue
    }

    // The channel answered. Clearing here rather than at the end of the loop is
    // deliberate: a reachable channel with credentials that work has earned the
    // reset, and whether FBM then managed to ingest its orders is our problem,
    // not a reason to keep standing down from theirs.
    await service.recordSuccess(connection.id, now).catch(() => undefined)

    result.fetched += orders.length
    if (!orders.length) {
      await service.recordSync({ id: connection.id, error: null })
      continue
    }

    // Resolved once per connection rather than per order — the catalogue does
    // not change between two orders in the same batch, and a lookup per order
    // would make a busy vendor's poll quadratic for no gain.
    const variants = await loadSellerVariantContexts(
      container,
      connection.seller_id
    )

    const ingestedOrders: ChannelOrder[] = []
    const unmatched: { external_id: string; sku: string; reason: string }[] = []

    for (const order of orders) {
      try {
        const existing = await service.findOrder(
          connection.channel_id,
          order.external_id
        )
        const decision = decideIngestion(existing)

        if (decision.action === "skip") {
          result.skipped++
          // Still counts toward the cursor: it is a real order we have seen,
          // and excluding it could stall the cursor behind a batch that is
          // entirely already-ingested.
          ingestedOrders.push(order)
          continue
        }

        const orderId =
          decision.action === "apply_inventory"
            ? decision.order_id
            : (await service.recordOrder({
                seller_id: connection.seller_id,
                channel_id: connection.channel_id,
                order,
              })).id

        if (decision.action === "apply_inventory") result.replayed++
        else result.ingested++

        const plan = planChannelInventoryAdjustments(order.items, variants)
        const applied = await applyChannelInventory(container, plan.adjustments)

        for (const skip of plan.skipped) {
          unmatched.push({
            external_id: order.external_id,
            sku: skip.sku,
            reason: skip.reason,
          })
        }
        result.unmatched_lines += plan.skipped.length

        await service.markInventoryApplied(orderId, {
          adjustments: applied,
          skipped: plan.skipped,
        })

        ingestedOrders.push(order)
      } catch (err) {
        // One order's failure must not abandon the batch, and must not advance
        // the cursor past it — so it is simply not added to `ingestedOrders`.
        result.failed++
        log.warn(
          `[channel-orders] failed to ingest ${connection.channel_id}:${order.external_id}`,
          err
        )
      }
    }

    await service.recordSync({
      id: connection.id,
      orders_synced_through: nextOrderCursor(
        connection.orders_synced_through,
        ingestedOrders
      ),
      report: {
        fetched: orders.length,
        ingested: result.ingested,
        replayed: result.replayed,
        skipped: result.skipped,
        unmatched: unmatched.slice(0, 50),
      },
      error: null,
    })

    if (unmatched.length) {
      // Loud on purpose: every line here is a sale whose stock did not move.
      log.warn(
        `[channel-orders] ${connection.seller_id}/${connection.channel_id}: ` +
          `${unmatched.length} order lines did not match a stocked variant`
      )
    }
  }

  if (result.fetched || result.failed || result.throttled) {
    log.info(
      `[channel-orders] ${result.connections} connections: fetched ${result.fetched}, ` +
        `ingested ${result.ingested}, replayed ${result.replayed}, skipped ${result.skipped}, ` +
        `unmatched lines ${result.unmatched_lines}, failed ${result.failed}, ` +
        `${result.throttled} standing down`
    )
  }

  return result
}

export default async function channelOrderSync(container: MedusaContainer) {
  await processChannelOrderSync(container)
}

export const config = {
  name: "channel-order-sync",
  // Every 15 minutes. Orders are the time-critical direction — an uningested
  // order is stock FBM still believes it has, so the oversell window is exactly
  // this interval. Listings can wait an hour; this cannot.
  schedule: "*/15 * * * *",
}

/** Exported for the job's checks. */
export { FIRST_POLL_LOOKBACK_DAYS }
