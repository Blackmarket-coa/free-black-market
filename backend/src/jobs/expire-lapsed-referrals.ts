import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { REFERRAL_MODULE } from "../modules/referral"
import type ReferralService from "../modules/referral/service"

const log = createLogger("jobs/expire-lapsed-referrals")

/**
 * Flip referrals whose earning window has closed from `active` to `expired`.
 *
 * Housekeeping only, not a money gate: `isReferralEarning` already refuses to
 * pay a referral past its window the instant an order settles, so nothing is
 * ever over-paid whether or not this has run. What it keeps honest is the
 * stored `status` — so operator screens and reporting do not show a lapsed
 * referral as still active.
 *
 * Daily rather than hourly: the window is measured in months, so the exact
 * minute a status flips is immaterial, and a lighter cadence is plenty.
 */
export default async function expireLapsedReferrals(container: MedusaContainer) {
  try {
    const referral = container.resolve<ReferralService>(REFERRAL_MODULE)
    const flipped = await referral.expireLapsedReferrals()
    if (flipped > 0) {
      log.info(`[referrals] expired ${flipped} lapsed referral(s)`)
    }
  } catch (err) {
    // Housekeeping must never take down the worker; the earning rule holds
    // regardless of whether the stored status was refreshed.
    log.warn("[referrals] expire sweep failed", err)
  }
}

export const config = {
  name: "expire-lapsed-referrals",
  schedule: "0 3 * * *",
}
