import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { getSellerPlanSnapshot } from "./seller-plan"
import { getPlanDefinition } from "../modules/vendor-plan/catalog"
import { PAYOUT_BREAKDOWN_MODULE } from "../modules/payout-breakdown"
import type PayoutBreakdownService from "../modules/payout-breakdown/service"
import type { ResolvedPlatformFee } from "../modules/payout-breakdown/fee-resolution"

const log = createLogger("shared/platform-fee")

/**
 * The composition point for the platform-fee precedence chain.
 *
 * `payout-breakdown` is a Medusa module service and cannot resolve `vendor-plan`
 * across the module boundary, and `vendor-plan` has no business knowing about
 * payout config. This helper holds both: it reads the seller's plan rate and
 * hands it to `getPlatformFeeDetail`, which applies the ordering
 * (seller override → plan → platform default).
 *
 * Anything holding a container — subscribers, jobs, API routes — should call
 * this rather than `getEffectivePlatformFee` directly, or the plan tier silently
 * stops applying.
 */

export type SellerPlatformFee = ResolvedPlatformFee & {
  /** The plan the rate was read from, or null when the plan could not be read. */
  plan_code: string | null
  /** The plan's own rate, for display. Null means the plan has no opinion. */
  plan_percent: number | null
}

/**
 * The plan rate for a seller, or null.
 *
 * Never throws: a plan-service problem must not stop an order settling. It
 * degrades to "no plan opinion", which lands on the platform default — the
 * behaviour before plans existed.
 */
async function planFeePercent(
  container: MedusaContainer,
  sellerId: string
): Promise<{ plan_code: string | null; percent: number | null }> {
  try {
    const snapshot = await getSellerPlanSnapshot(container, sellerId)
    const definition = getPlanDefinition(snapshot.plan_code)
    return {
      plan_code: snapshot.plan_code,
      percent: definition?.platform_fee_percent ?? null,
    }
  } catch (err) {
    log.warn(
      `[platform-fee] plan lookup failed for ${sellerId}; using platform default`,
      err
    )
    return { plan_code: null, percent: null }
  }
}

/** Full provenance of the fee applying to a seller. For admin screens. */
export async function resolveSellerPlatformFee(
  container: MedusaContainer,
  sellerId: string
): Promise<SellerPlatformFee> {
  const payouts = container.resolve<PayoutBreakdownService>(
    PAYOUT_BREAKDOWN_MODULE
  )
  const plan = await planFeePercent(container, sellerId)
  const resolved = await payouts.getPlatformFeeDetail(sellerId, plan.percent)

  return { ...resolved, plan_code: plan.plan_code, plan_percent: plan.percent }
}

/**
 * Just the percentage. The drop-in replacement for
 * `payoutService.getEffectivePlatformFee(sellerId)` on any call path that has a
 * container.
 */
export async function resolveSellerPlatformFeePercent(
  container: MedusaContainer,
  sellerId: string
): Promise<number> {
  const { percent } = await resolveSellerPlatformFee(container, sellerId)
  return percent
}
