import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { sweepExpiredPromotions } from "../shared/promoted-listing-service"

const log = createLogger("jobs/expire-promoted-listings")

/**
 * Take down promoted placement once the promotion behind it has expired.
 *
 * `seller_metadata.featured` is a denormalized copy of "this seller holds a
 * live promotion entitlement" — the public directory sorts on it inside its
 * hottest query, so it is kept as a column rather than joined at read time.
 * A denormalized copy needs something to expire it; this is that something.
 *
 * Hourly is deliberate. Promotions are sold in units of days, so an hour of
 * overrun costs the platform a rounding error and is invisible to the vendor,
 * while a per-minute sweep would re-read every featured seller 1,440 times a
 * day to change nothing.
 *
 * Sellers featured with no promotion on record are counted and named, never
 * cleared: every `featured` row predating promotions was set by hand, and a
 * job that demoted them would silently rewrite the public directory. Run
 * `scripts/backfill-promoted-listings.ts` to convert those into open-ended
 * operator promotions; until then they show up here.
 */
export default async function expirePromotedListings(container: MedusaContainer) {
  const result = await sweepExpiredPromotions(container)

  if (result.cleared || result.set || result.failed) {
    log.info(
      `[promotions] swept ${result.checked}: cleared ${result.cleared}, set ${result.set}, failed ${result.failed}`
    )
  }

  if (result.unbacked.length) {
    log.warn(
      `[promotions] ${result.unbacked.length} seller(s) featured with no promotion on record; run backfill-promoted-listings to adopt them: ${result.unbacked
        .slice(0, 20)
        .join(", ")}${result.unbacked.length > 20 ? " …" : ""}`
    )
  }
}

export const config = {
  name: "expire-promoted-listings",
  schedule: "0 * * * *",
}
