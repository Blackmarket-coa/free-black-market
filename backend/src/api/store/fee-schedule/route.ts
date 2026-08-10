import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  DEFAULT_PLAN_CODE,
  PLATFORM_DEFAULT_FEE_PERCENT,
  VENDOR_PLAN_CATALOG,
} from "../../../modules/vendor-plan/catalog"

/**
 * GET /store/fee-schedule
 *
 * The public commission schedule, read straight off the billing catalog that
 * actually charges vendors (`modules/vendor-plan/catalog.ts`).
 *
 * This route exists so the public transparency page cannot quote a number the
 * platform does not charge. Before it, the storefront hardcoded `price * 0.03`
 * in `components/sections/FeeBreakdown.tsx` and "3%" in prose across five
 * pages — none of it connected to the catalog, so a pricing change would have
 * silently left the marketing copy lying.
 *
 * Only self-serve plans are exposed. `internal` carries a null rate (it means
 * "no plan-level opinion", not "free") and is an operator concept, so listing
 * it publicly would read as a secret cheaper tier.
 *
 * Per-seller negotiated rates (`seller_payout_settings.custom_platform_fee_percent`)
 * are deliberately NOT exposed — they are commercial terms between the
 * coalition and one vendor, and publishing them would leak that vendor's deal.
 * `default_fee_percent` is what a vendor pays with no plan and no override,
 * which is the number the public page should lead with.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const plans = VENDOR_PLAN_CATALOG.filter(
    (plan) => plan.platform_fee_percent !== null
  ).map((plan) => ({
    code: plan.code,
    display_name: plan.display_name,
    description: plan.description,
    price_amount: plan.price_amount,
    currency_code: plan.currency_code,
    interval: plan.interval,
    platform_fee_percent: plan.platform_fee_percent,
    is_default: plan.code === DEFAULT_PLAN_CODE,
  }))

  res.json({
    default_plan_code: DEFAULT_PLAN_CODE,
    default_fee_percent: PLATFORM_DEFAULT_FEE_PERCENT,
    plans,
  })
}
