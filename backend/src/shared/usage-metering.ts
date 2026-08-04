import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { VENDOR_USAGE_MODULE } from "../modules/vendor-usage/module-key"
import type VendorUsageService from "../modules/vendor-usage/service"
import { usagePeriodFor } from "../modules/vendor-plan/overage"

const log = createLogger("shared/usage-metering")

/**
 * Record one metered embed request against the seller's current period.
 *
 * Called from the embed request path, which is the hottest path in the system,
 * so two properties matter more than completeness:
 *
 * 1. **It never throws.** A metering failure must not fail a vendor's
 *    storefront traffic. An undercount is a billing inaccuracy; a 500 on a
 *    shopper's page is an outage.
 * 2. **It is not awaited by the caller.** `meterEmbedRequest` is fire-and-forget
 *    from the middleware's perspective — a request should not wait on a write
 *    that exists only to bill for it later.
 *
 * The period is derived from the clock alone (`usagePeriodFor`), so the hot
 * path never reads the seller's plan assignment just to know which counter to
 * bump. Allowances are applied later, at close.
 */
export function meterEmbedRequest(
  container: MedusaContainer,
  sellerId: string,
  now: Date = new Date()
): void {
  if (!sellerId) return

  const { start, end } = usagePeriodFor(now)

  // Deliberately not awaited: see (2) above.
  void (async () => {
    try {
      const usage = container.resolve<VendorUsageService>(VENDOR_USAGE_MODULE)
      await usage.recordUsage({
        seller_id: sellerId,
        metric: "embed_requests",
        period_start: start,
        period_end: end,
        delta: 1,
      })
    } catch (err) {
      log.warn(`[usage] embed meter failed for ${sellerId}`, err)
    }
  })()
}
