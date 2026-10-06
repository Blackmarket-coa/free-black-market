import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  DEFAULT_PLAN_CODE,
  PLATFORM_DEFAULT_FEE_PERCENT,
  allAccessPlanEnabled,
  offeredPlans,
} from "../../../modules/vendor-plan/catalog"
import {
  resolvePlatformFee,
  ZERO_FEE_TRANSACTION_KINDS,
  type PlatformFeeTransactionKind,
} from "../../../modules/payout-breakdown/fee-resolution"
import { featureFlagState } from "../../../shared/feature-flags"
import { feeFirstSplitEnabled } from "../../../shared/platform-fee"
import { PAYOUT_BREAKDOWN_MODULE } from "../../../modules/payout-breakdown"
import type PayoutBreakdownService from "../../../modules/payout-breakdown/service"
import { createLogger } from "../../../shared/logger"

const log = createLogger("api/store/fee-schedule")

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
 * Only the plans a vendor can actually select right now are exposed: the
 * offered ladder for the `FF_ALL_ACCESS_PLAN_V1` state (`offeredPlans`). Off,
 * that is free 3% / starter 2.5% / pro 2% / scale 1.5%, exactly as before; on,
 * it is free 3% / all_access 0%, so retired tiers vanish from the public page
 * the moment they stop being sold. `internal` is never listed: it carries a
 * null rate (it means "no plan-level opinion", not "free") and is an operator
 * concept, so listing it publicly would read as a secret cheaper tier.
 * `all_access` at 0% is the opposite case — a priced, public plan a vendor
 * buys — and is listed as one.
 *
 * `trial_days` is published per plan ONLY while `FF_ALL_ACCESS_PLAN_V1` is
 * on, so the storefront can render the all_access trial from data. Flag off,
 * the response is byte-identical to what it was before F8 (pinned in the
 * spec); the storefront then falls back to the trial sentence it always
 * printed for starter and pro.
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
 * a plan row is something a vendor buys (including the all_access 0% plan,
 * listed only while its flag is on), whereas this rule is about what FBM
 * charges for, not a rate a vendor can buy down to. The values are resolved through the
 * same chain that would charge them, so this page cannot quote a rule the
 * resolver does not apply. It states FBM's fee rule only; it says nothing
 * about any organisation's tax status (legal checkpoint L11).
 *
 * `processing` (only while `FF_FEE_FIRST_SPLIT_V1` is on, Black Mask F6)
 * states how card processing is handled: `model: "fee_first"` — the estimate
 * (`percent` + `fixed_cents`, read from the payout config that the settlement
 * deducts) comes off the sale first and the platform fee is taken on what is
 * left. It exists so the storefront's "we absorb processing" copy cannot
 * outlive the change; flag off, the field is absent and the response is
 * byte-identical (pinned in the spec), which the storefront reads as today's
 * absorbed model. If the config cannot be read the model is still published
 * (the flag, not the config, decides it) with null figures, so a page can say
 * processing comes off first without quoting a number it could not check.
 */

type PublishedProcessing = {
  model: "fee_first"
  percent: number | null
  fixed_cents: number | null
}

async function publishedProcessing(req: MedusaRequest): Promise<PublishedProcessing> {
  try {
    const payouts = req.scope.resolve<PayoutBreakdownService>(PAYOUT_BREAKDOWN_MODULE)
    const config = await payouts.getDefaultConfig()
    const percent = Number(config.payment_processing_percent)
    const fixed = Number(config.payment_processing_fixed)
    return {
      model: "fee_first",
      percent: Number.isFinite(percent) ? percent : null,
      fixed_cents: Number.isFinite(fixed) ? Math.round(fixed) : null,
    }
  } catch (error) {
    log.warn("[fee-schedule] payout config unreadable; publishing fee_first without figures", error)
    return { model: "fee_first", percent: null, fixed_cents: null }
  }
}

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

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const allAccessOn = allAccessPlanEnabled()
  const plans = offeredPlans(allAccessOn)
    .filter((plan) => plan.platform_fee_percent !== null)
    .map((plan) => ({
      code: plan.code,
      display_name: plan.display_name,
      description: plan.description,
      price_amount: plan.price_amount,
      currency_code: plan.currency_code,
      interval: plan.interval,
      platform_fee_percent: plan.platform_fee_percent,
      is_default: plan.code === DEFAULT_PLAN_CODE,
      ...(allAccessOn ? { trial_days: plan.trial_days } : {}),
    }))

  res.json({
    default_plan_code: DEFAULT_PLAN_CODE,
    default_fee_percent: PLATFORM_DEFAULT_FEE_PERCENT,
    plans,
    ...(featureFlagState.isEnabled("NONPROFIT_PARITY_V1")
      ? { transaction_kinds: publishedTransactionKinds() }
      : {}),
    ...(feeFirstSplitEnabled() ? { processing: await publishedProcessing(req) } : {}),
  })
}
