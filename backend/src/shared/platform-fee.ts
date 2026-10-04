import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { featureFlagState } from "./feature-flags"
import { getSellerPlanSnapshot } from "./seller-plan"
import { getPlanDefinition } from "../modules/vendor-plan/catalog"
import { PAYOUT_BREAKDOWN_MODULE } from "../modules/payout-breakdown"
import type PayoutBreakdownService from "../modules/payout-breakdown/service"
import {
  ZERO_FEE_TRANSACTION_KINDS,
  type PlatformFeeTransactionKind,
  type ResolvedPlatformFee,
} from "../modules/payout-breakdown/fee-resolution"

const log = createLogger("shared/platform-fee")

/**
 * The composition point for the platform-fee precedence chain.
 *
 * `payout-breakdown` is a Medusa module service and cannot resolve `vendor-plan`
 * across the module boundary, and `vendor-plan` has no business knowing about
 * payout config. This helper holds both: it reads the seller's plan rate and
 * hands it to `getPlatformFeeDetail`, which applies the ordering
 * (transaction kind → seller override → plan → platform default).
 *
 * Anything holding a container — subscribers, jobs, API routes — should call
 * this rather than `getEffectivePlatformFee` directly, or the plan tier silently
 * stops applying.
 *
 * This is also the one place `FF_NONPROFIT_PARITY_V1` touches the fee chain.
 * The pure resolver in `fee-resolution.ts` is unconditional; what the flag
 * gates is whether a caller holding a container may classify a charge as
 * anything other than a sale. Off, every kind is coerced to `sale` and this
 * file behaves exactly as it did before the kind existed.
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

/**
 * The kind a caller asked for, or `sale` while the nonprofit-parity flag is
 * off. Only the literal string "true" enables the flag (`feature-flags.ts`),
 * so a deploy with no env set never classifies anything as a donation.
 */
function effectiveKind(
  kind: PlatformFeeTransactionKind | undefined
): PlatformFeeTransactionKind {
  if (!featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return "sale"
  return kind ?? "sale"
}

/**
 * Full provenance of the fee applying to a charge of a given kind.
 *
 * For a zero-fee kind the plan is not read at all: the resolver would ignore
 * it anyway, and reading it would put a `plan_code` / `plan_percent` on a
 * donation's provenance that had nothing to do with the result. Both are null
 * in that case, which is also what they are when the plan could not be read —
 * "no plan opinion applied" is the honest statement either way.
 */
export async function resolveTransactionPlatformFee(
  container: MedusaContainer,
  input: { sellerId: string; kind?: PlatformFeeTransactionKind }
): Promise<SellerPlatformFee> {
  const payouts = container.resolve<PayoutBreakdownService>(
    PAYOUT_BREAKDOWN_MODULE
  )
  const kind = effectiveKind(input.kind)

  if (ZERO_FEE_TRANSACTION_KINDS.has(kind)) {
    const resolved = await payouts.getPlatformFeeDetail(
      input.sellerId,
      null,
      kind
    )
    return { ...resolved, plan_code: null, plan_percent: null }
  }

  const plan = await planFeePercent(container, input.sellerId)
  const resolved = await payouts.getPlatformFeeDetail(
    input.sellerId,
    plan.percent,
    kind
  )

  return { ...resolved, plan_code: plan.plan_code, plan_percent: plan.percent }
}

/**
 * Full provenance of the fee applying to a seller's sales. For admin screens.
 *
 * A thin wrapper over `resolveTransactionPlatformFee` with kind `sale`, so the
 * existing callers (the order.placed subscriber, grower payouts, the admin
 * payout-settings route, the Blackout fee quote) keep their signature and
 * their behaviour.
 */
export async function resolveSellerPlatformFee(
  container: MedusaContainer,
  sellerId: string
): Promise<SellerPlatformFee> {
  return resolveTransactionPlatformFee(container, { sellerId, kind: "sale" })
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
