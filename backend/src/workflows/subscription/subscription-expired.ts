import { createLogger } from "../../shared/logger"
const log = createLogger("workflows/subscription/subscription-expired")
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService, MedusaContainer } from "@medusajs/framework/types"
import { featureFlagState } from "../../shared/feature-flags"
import { sequenceFrom } from "../../modules/marketplace-webhooks/black-mask"

/**
 * `subscription.expired` (BM-5): published by process-subscription-renewals
 * after it writes a subscription EXPIRED, at every expiry site in that job
 * (the per-subscription expire, the ACTIVE sweep, and the paused-past-paid-
 * period sweep).
 *
 * Its only consumer is the Black Mask provisioning channel, so it is published
 * only while FF_BLACK_MASK_PROVISIONING_V1 is on, read at the moment of each
 * emit (per run, never cached at import). Flag off, nothing is resolved and
 * nothing is published.
 *
 * `occurred_at` is the ROW's `expiration_date`: the end of the term the
 * customer paid for. It is the same value on every run and every redelivery,
 * so the provisioning lib computes the same `event_id` and dedupes. It is
 * never now() (two runs would mint two ids) and never `updated_at` (it moves
 * on any later write). A row with no usable `expiration_date` publishes
 * nothing and logs; the job never expires such a row today, so reaching that
 * branch means a caller changed.
 *
 * Never throws: a publish failure is logged and swallowed, so it cannot undo
 * or block the expiry write that precedes it.
 */

export const SUBSCRIPTION_EXPIRED_EVENT = "subscription.expired"

export type SubscriptionExpiredPayload = {
  subscription_id: string
  occurred_at: string
}

export type ExpiredRow = {
  id: string
  expiration_date?: Date | string | null
}

/** The event body for an expired row, or null when the row has no usable expiration_date. */
export function subscriptionExpiredPayload(row: ExpiredRow): SubscriptionExpiredPayload | null {
  const ms = sequenceFrom(row.expiration_date ?? null)
  if (ms === null) return null
  return { subscription_id: row.id, occurred_at: new Date(ms).toISOString() }
}

export type SubscriptionExpiredEmitOutcome = "emitted" | "flag_off" | "no_expiration_date" | "emit_failed"

export async function emitSubscriptionExpired(
  container: MedusaContainer,
  row: ExpiredRow
): Promise<SubscriptionExpiredEmitOutcome> {
  if (!featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")) return "flag_off"

  const payload = subscriptionExpiredPayload(row)
  if (!payload) {
    log.warn(
      `[subscription-expired] ${row.id} was expired without a usable expiration_date; ` +
        `no ${SUBSCRIPTION_EXPIRED_EVENT} published (no stable occurred_at)`
    )
    return "no_expiration_date"
  }

  try {
    const eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({ name: SUBSCRIPTION_EXPIRED_EVENT, data: payload })
    return "emitted"
  } catch (error) {
    // Never let a notification failure undo the expiry write.
    log.error(`[subscription-expired] failed to publish ${SUBSCRIPTION_EXPIRED_EVENT} for ${row.id}:`, error)
    return "emit_failed"
  }
}
