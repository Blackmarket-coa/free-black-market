import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { VENDOR_USAGE_MODULE } from "../modules/vendor-usage/module-key"
import type VendorUsageService from "../modules/vendor-usage/service"
import { VENDOR_BILLING_MODULE } from "../modules/vendor-billing"
import type VendorBillingService from "../modules/vendor-billing/service"
import { VendorChargeKind } from "../modules/vendor-billing/charges"
import { getSellerPlanLimits } from "../shared/seller-plan"
import { executeCharge } from "../shared/vendor-charge-execution"
import {
  computeOverage,
  previousUsagePeriod,
  usagePeriodKey,
} from "../modules/vendor-plan/overage"

const log = createLogger("jobs/vendor-usage-billing")

export type UsageBillingResult = {
  examined: number
  charged: number
  within_allowance: number
  failed: number
}

/**
 * Close the previous month's meters and bill any overage.
 *
 * `VendorChargeKind.USAGE` has existed since the charge ledger landed and has
 * had no writer — the same "declared but read nowhere" shape as the fee columns
 * this roadmap has been closing out. This is its writer.
 *
 * Ordering and idempotency, in the same spirit as the renewal cron:
 *
 * - The counter is stamped `billed_at` **after** the charge row exists, so a
 *   crash between the two re-runs and replays onto the same charge rather than
 *   silently skipping a period nobody would ever notice was unbilled.
 * - The charge's discriminator is `${metric}:${YYYY-MM}`, derived from the
 *   period rather than the clock, so a re-fired job produces the same
 *   idempotency key and collides instead of double-billing.
 * - Sellers within their allowance are stamped billed with no charge at all. A
 *   zero-amount charge row would be noise in a vendor's history and would imply
 *   we tried to collect nothing.
 *
 * Runs on the 2nd of the month rather than the 1st: the meter is written
 * fire-and-forget from the request path, so a small tail of late writes can
 * land just after midnight UTC. A day of slack costs nothing and avoids
 * billing a period that is still settling.
 */
export async function processUsageBilling(
  container: MedusaContainer,
  now: Date = new Date()
): Promise<UsageBillingResult> {
  const result: UsageBillingResult = {
    examined: 0,
    charged: 0,
    within_allowance: 0,
    failed: 0,
  }

  const usage = container.resolve<VendorUsageService>(VENDOR_USAGE_MODULE)
  const billing = container.resolve<VendorBillingService>(VENDOR_BILLING_MODULE)

  const period = previousUsagePeriod(now)
  const periodKey = usagePeriodKey(period.start)
  const metric = "embed_requests"

  const records = await usage.listUnbilledForPeriod(metric, period.start)
  result.examined = records.length

  for (const record of records) {
    try {
      const { limits } = await getSellerPlanLimits(container, record.seller_id)
      const overage = computeOverage({
        recorded: Number(record.quantity),
        included: limits.included_embed_requests,
      })

      if (!overage.billable) {
        await usage.markBilled(record.id, null)
        result.within_allowance++
        continue
      }

      const { charge } = await billing.createCharge({
        seller_id: record.seller_id,
        kind: VendorChargeKind.USAGE,
        amount: overage.amount_cents,
        description: `Embed request overage — ${periodKey}`,
        discriminator: `${metric}:${periodKey}`,
        period_start: record.period_start,
        period_end: record.period_end,
        metadata: {
          metric,
          period: periodKey,
          recorded: overage.recorded,
          included: overage.included,
          blocks: overage.blocks,
        },
      })

      // Stamp only after the charge row exists — see the ordering note above.
      await usage.markBilled(record.id, charge.id)

      // Present it if collection is configured; an unconfigured deployment
      // leaves it pending and visible, which is the intended fail-safe.
      await executeCharge(container, charge.id)
      result.charged++
    } catch (err) {
      // One seller's failure must not abandon the rest of the batch.
      result.failed++
      log.warn(
        `[usage-billing] failed to bill ${record.seller_id} for ${periodKey}`,
        err
      )
    }
  }

  if (result.charged || result.failed) {
    log.info(
      `[usage-billing] ${periodKey}: examined ${result.examined}, charged ${result.charged}, within allowance ${result.within_allowance}, failed ${result.failed}`
    )
  }

  return result
}

export default async function vendorUsageBilling(container: MedusaContainer) {
  await processUsageBilling(container)
}

export const config = {
  name: "vendor-usage-billing",
  // 02:00 UTC on the 2nd — see the note above on why not the 1st.
  schedule: "0 2 2 * *",
}
