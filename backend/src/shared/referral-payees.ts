import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { REFERRAL_MODULE } from "../modules/referral"
import type ReferralService from "../modules/referral/service"

const log = createLogger("shared/referral-payees")

/**
 * The seller currently owed a referral share on a seller's order, or null.
 *
 * The attribution and its earning window live in `modules/referral`, which
 * `payout-breakdown` cannot resolve across the module boundary — so this
 * composition point holds the container and hands the payout service a plain
 * `{ referrer_seller_id }`, the same way `plugin-payees.ts` hands it plugin
 * authors.
 *
 * Never throws: a referral lookup must never be able to fail an order
 * settlement. On any problem it returns null — no referral share for this
 * order, which is the behaviour before this existed.
 */
export async function resolveSellerReferralPayee(
  container: MedusaContainer,
  sellerId: string,
  now: Date = new Date()
): Promise<{ referrer_seller_id: string } | null> {
  try {
    const referral = container.resolve<ReferralService>(REFERRAL_MODULE)
    const active = await referral.getActiveReferrer(sellerId, now)
    if (!active) return null
    return { referrer_seller_id: active.referrer_seller_id }
  } catch (err) {
    log.warn(
      `[referral-payees] lookup failed for ${sellerId}; no referral share applied`,
      err
    )
    return null
  }
}
