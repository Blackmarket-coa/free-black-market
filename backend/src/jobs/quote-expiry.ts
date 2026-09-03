import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { QUOTE_MODULE } from "../modules/quote"
import type QuoteService from "../modules/quote/service"

const log = createLogger("jobs/quote-expiry")

export type QuoteExpiryResult = {
  considered: number
  expired: number
  failed: number
}

/**
 * The sweep's core, container-free so it unit-tests with fakes — the
 * `demand-pool-expiry` pattern.
 *
 * The sweep is bookkeeping, not enforcement. `canAccept` already refuses an
 * out-of-date quote by the clock, so a quote is unacceptable the moment its
 * deadline passes whether or not this job has run. What this does is make the
 * stored status agree with that, so vendor and buyer lists read correctly.
 */
export async function sweepExpiredQuotes(
  service: Pick<QuoteService, "findExpirable" | "markExpired">,
  emit: (payload: {
    quote_id: string
    seller_id: string
    customer_id: string
  }) => Promise<void>,
  now: Date = new Date()
): Promise<QuoteExpiryResult> {
  const expirable = await service.findExpirable(now)
  const result: QuoteExpiryResult = {
    considered: expirable.length,
    expired: 0,
    failed: 0,
  }

  for (const quote of expirable) {
    try {
      await service.markExpired(quote.id)
      await emit({
        quote_id: quote.id,
        seller_id: quote.seller_id,
        customer_id: quote.customer_id,
      })
      result.expired += 1
    } catch (err) {
      // Per-quote, so one bad row cannot abort the batch.
      result.failed += 1
      log.error(`[quote-expiry] failed for quote ${quote.id}`, err)
    }
  }

  return result
}

/**
 * Hourly sweep marking sent quotes past their `valid_until` as expired.
 *
 * Ordering here is the opposite of the dunning sweep's, on purpose. There, the
 * notification goes first because a missed reminder costs money. Here the
 * status write goes first because it is what stops a stale quote showing as
 * live; a crash before the event means one missed notification about a quote
 * that has correctly already lapsed, which is the cheaper failure.
 */
export default async function quoteExpiry(container: MedusaContainer) {
  const service = container.resolve<QuoteService>(QUOTE_MODULE)

  let eventBus: IEventBusModuleService | null = null
  try {
    eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
  } catch {
    eventBus = null
  }

  const result = await sweepExpiredQuotes(service, async (payload) => {
    if (!eventBus) return
    await eventBus.emit({ name: "quote.expired", data: payload })
  })

  if (result.considered > 0) {
    log.info(
      `[quote-expiry] considered=${result.considered} expired=${result.expired} failed=${result.failed}`
    )
  }

  return result
}

export const config = {
  name: "quote-expiry",
  // Hourly: validity has day granularity, so an hour of lag on the status
  // write is invisible, and `canAccept` is authoritative in the meantime.
  schedule: "0 * * * *",
}
