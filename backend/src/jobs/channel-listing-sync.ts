import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { loadSellerChannelProducts } from "../shared/channel-products"
import { CHANNEL_CONNECTOR_MODULE } from "../modules/channel-connector/module-key"
import type ChannelConnectorService from "../modules/channel-connector/service"
import type { ConnectionRow } from "../modules/channel-connector/service"
import { getChannelAdapter } from "../modules/channel-connector/adapters"
import { ChannelApiError } from "../modules/channel-connector/types"
import { classifyFailure } from "../modules/channel-connector/throttle"

const log = createLogger("jobs/channel-listing-sync")

export type ChannelSyncResult = {
  connections: number
  pushed: number
  updated: number
  created: number
  failed: number
  skipped: number
  /** Connections skipped because they are standing down. Phase 12. */
  throttled: number
}

/**
 * Push connected vendors' catalogues to their channels.
 *
 * The half of Phase 9 that makes the connector do something: without it a
 * vendor connects Faire and nothing happens, which is the same
 * declared-but-read-nowhere shape one layer up from the routes.
 *
 * The decisions that matter, in the order they bite:
 *
 * **A create is distinguished from an update by the stored external id, never
 * by SKU.** `channel_listing` exists for exactly this. Matching on SKU alone
 * means the first product a vendor renames appears twice in their wholesale
 * catalogue, and a duplicate listing on a live marketplace is not something an
 * apology fixes.
 *
 * **One product's failure never stops the rest.** A vendor with fifty products
 * and one bad SKU should get forty-nine listings and one legible error, not a
 * run that died on product three. The error is stored per product so the panel
 * can show it next to the offending item.
 *
 * **A rejection is not retried; a transport failure is.** `ChannelApiError`
 * carries the distinction. A 422 on a malformed listing will fail identically
 * forever, and retrying it burns the queue and delays everything behind it —
 * whereas a 502 is worth another attempt. Only a retryable failure aborts the
 * seller's run (so the next scheduled pass picks it up cleanly); a rejection is
 * recorded and the run continues.
 *
 * **Disabled connections are skipped, not deleted.** A vendor pausing a channel
 * keeps their credentials and their listing map, which is what makes resuming
 * safe rather than a catalogue full of duplicates.
 */
export async function processChannelListingSync(
  container: MedusaContainer,
  options: { sellerId?: string; now?: Date } = {}
): Promise<ChannelSyncResult> {
  const now = options.now ?? new Date()
  const result: ChannelSyncResult = {
    connections: 0,
    pushed: 0,
    updated: 0,
    created: 0,
    failed: 0,
    skipped: 0,
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

    // Phase 12. Checked before the catalogue is loaded: a standing-down
    // connection should cost nothing, and `loadSellerChannelProducts` is the
    // expensive part of this loop.
    if (!service.mayAttempt(connection, now)) {
      result.throttled++
      continue
    }

    const adapter = getChannelAdapter(connection.channel_id)
    // A connection naming a channel this build no longer ships is a real state
    // after a rollback. Skip it rather than crashing the run for everyone else.
    if (!adapter?.supports("push_listing") || !adapter.pushListing) continue

    result.connections++

    const { products, skipped } = await loadSellerChannelProducts(
      container,
      connection.seller_id
    )
    result.skipped += skipped.length

    const credentials = service.toCredentials(connection)
    const errors: { product_id: string; reason: string }[] = [...skipped]
    let aborted: string | null = null
    let pushedAny = false

    for (const product of products) {
      try {
        const existing = await service.getListing(
          connection.seller_id,
          connection.channel_id,
          product.id
        )

        const push = await adapter.pushListing(
          product,
          credentials,
          existing?.external_id ?? null
        )

        if (push.external_id) {
          await service.recordListing({
            seller_id: connection.seller_id,
            channel_id: connection.channel_id,
            product_id: product.id,
            external_id: push.external_id,
            sku: product.sku,
          })
        }

        result.pushed++
        pushedAny = true
        if (push.created) result.created++
        else result.updated++
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown channel error"

        if (err instanceof ChannelApiError) {
          // Only failures that say something about the *connection*. A 422 is a
          // fact about one product, already recorded against that listing by
          // `recordListingError` below — writing it here too would overwrite the
          // connection's error with a per-product one and cost a database round
          // trip for every bad SKU in the catalogue.
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
            // Worth another attempt, and likely to affect every remaining
            // product too — stop this seller and let the stored backoff decide
            // when to come back, rather than hammering a channel that is
            // rate-limiting or down.
            aborted = message
            break
          }
        }

        result.failed++
        errors.push({ product_id: product.id, reason: message })
        await service
          .recordListingError(
            connection.seller_id,
            connection.channel_id,
            product.id,
            message
          )
          // Best-effort: failing to record why a product failed must not itself
          // fail the run.
          .catch(() => undefined)
      }
    }

    await service.recordSync({
      id: connection.id,
      report: {
        products: products.length,
        pushed: result.pushed,
        skipped: skipped.length,
        errors: errors.slice(0, 50),
      },
      error: aborted,
    })

    // Only when the channel accepted something. A run that aborted on a
    // retryable error has just set a backoff, and clearing it here would undo
    // it before the next tick ever read it.
    if (!aborted && pushedAny) {
      await service.recordSuccess(connection.id, now).catch(() => undefined)
    }
  }

  if (result.pushed || result.failed || result.skipped || result.throttled) {
    log.info(
      `[channel-sync] ${result.connections} connections: ${result.created} created, ` +
        `${result.updated} updated, ${result.failed} failed, ${result.skipped} skipped, ` +
        `${result.throttled} standing down`
    )
  }

  return result
}

export default async function channelListingSync(container: MedusaContainer) {
  await processChannelListingSync(container)
}

export const config = {
  name: "channel-listing-sync",
  // Hourly. Frequent enough that a price or stock change reaches buyers the
  // same day. It is no longer the only limit: Phase 12 added per-request
  // spacing inside a run (`shared/channel-pacer.ts`) and a durable per-
  // connection backoff that can outlast this interval.
  schedule: "0 * * * *",
}
