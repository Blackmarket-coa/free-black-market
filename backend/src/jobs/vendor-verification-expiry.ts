import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { VENDOR_VERIFICATION_MODULE } from "../modules/vendor-verification"
import type VendorVerificationService from "../modules/vendor-verification/service"

const log = createLogger("jobs/vendor-verification-expiry")

/**
 * Daily: expire lapsed vendor badges and verification checks.
 *
 * `VendorVerificationService.processExpirations()` has been written and
 * correct since the module shipped — flip lapsed ACTIVE badges to EXPIRED,
 * flip lapsed PASSED checks to EXPIRED and recalculate the trust score. It
 * was never scheduled. `backend/src/jobs/` had 35 job files and none
 * referenced it; the only other mention in the repo was a comment in the
 * admin badge route promising that it reads `expires_at`.
 *
 * The consequence was live and buyer-facing. `getActiveBadges` filters on
 * `status: ACTIVE` and never looks at `expires_at`, and it feeds
 * `getTrustSummary` → `GET /store/sellers/:handle/trust` → the storefront's
 * TrustIndicators on the seller page header and every product detail page.
 * So a "Certified Organic" badge whose `expires_at` passed last month was
 * being shown to buyers as current, and a lapsed CERTIFICATION check kept
 * contributing its points and holding the seller at level CERTIFIED.
 *
 * This job is the missing line. The 2026-09-03 audit found it while mapping
 * Tier 2.4 (document expiry) and concluded the roadmap had scoped that item
 * to the module where expiry was merely unused, and skipped the one where it
 * was actively lying to buyers.
 */
export default async function vendorVerificationExpiry(container: MedusaContainer) {
  const service = container.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  try {
    await service.processExpirations()
    log.info("[vendor-verification-expiry] sweep complete")
  } catch (err) {
    log.error("[vendor-verification-expiry] sweep failed", err)
    throw err
  }
}

export const config = {
  name: "vendor-verification-expiry",
  // Shortly after the AR dunning sweep, once the calendar day has turned over
  // in every US timezone, so a badge expiring "today" is not pulled early.
  schedule: "15 9 * * *",
}
