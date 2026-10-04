import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  DEFAULT_PLAN_CODE,
  PLATFORM_DEFAULT_FEE_PERCENT,
  VENDOR_PLAN_CATALOG,
} from "../../../modules/vendor-plan/catalog"
import {
  resolvePlatformFee,
  ZERO_FEE_TRANSACTION_KINDS,
  type PlatformFeeTransactionKind,
} from "../../../modules/payout-breakdown/fee-resolution"
import { featureFlagState } from "../../../shared/feature-flags"

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
 *
 * `transaction_kinds` (only while `FF_NONPROFIT_PARITY_V1` is on) states the
 * platform's fee on kinds of charge that are not sales — today, 0% on a
 * donation and on a donation pledge. It is a separate field, not a plan row:
 * the `platform_fee_percent !== null` filter above is what keeps a 0 from ever
 * reading as a secret free tier, and the rule is about what FBM charges for,
 * not a rate a vendor can buy down to. The values are resolved through the
 * same chain that would charge them, so this page cannot quote a rule the
 * resolver does not apply. It states FBM's fee rule only; it says nothing
 * about any organisation's tax status (legal checkpoint L11).
 */

/**
 * The zero-fee kinds the public schedule publishes. `tip` is in the resolver's
 * set for completeness but is not a kind of charge FBM collects — tips are
 * kept out of the fee base by `calculateBreakdown` and no caller classifies
 * one — so advertising "tips 0%" here would describe a mechanism that does not
 * exist. `pool_contribution` (a contribution to a nonprofit-carried investment
 * pool, Decision 7) is published only while FF_INVESTMENT_POOLS_V1 is ALSO on:
 * the pool routes are dark without it, and a public fee page must not be the
 * first place an offering gated on counsel (L26) is mentioned.
 */
function publishedZeroFeeKinds(): readonly PlatformFeeTransactionKind[] {
  const poolsLive = featureFlagState.isEnabled("INVESTMENT_POOLS_V1")
  return [...ZERO_FEE_TRANSACTION_KINDS].filter(
    (kind) => kind !== "tip" && (kind !== "pool_contribution" || poolsLive)
  )
}

function publishedTransactionKinds(): Record<string, number> {
  return Object.fromEntries(
    publishedZeroFeeKinds().map((kind) => [
      kind,
      resolvePlatformFee({ platformDefault: PLATFORM_DEFAULT_FEE_PERCENT, kind })
        .percent,
    ])
  )
}

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
    ...(featureFlagState.isEnabled("NONPROFIT_PARITY_V1")
      ? { transaction_kinds: publishedTransactionKinds() }
      : {}),
  })
}
