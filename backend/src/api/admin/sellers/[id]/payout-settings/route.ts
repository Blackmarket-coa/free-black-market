import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { resolveSellerPlatformFee } from "../../../../../shared/platform-fee"
import { PAYOUT_BREAKDOWN_MODULE } from "../../../../../modules/payout-breakdown"
import type PayoutBreakdownService from "../../../../../modules/payout-breakdown/service"

const log = createLogger("api/admin/sellers/payout-settings")

type OverrideBody = {
  /**
   * Percentage, e.g. `2.5`. `null` clears the override and returns the seller
   * to their plan's rate — distinct from `0`, which is a real "this seller pays
   * nothing" concession.
   */
  custom_platform_fee_percent?: number | null
  reason?: string | null
  /** ISO date. `null` means the concession does not expire. */
  expires_at?: string | null
}

function serialize(
  fee: Awaited<ReturnType<typeof resolveSellerPlatformFee>>,
  settings: { custom_platform_fee_percent?: number | null; fee_reduction_reason?: string | null; fee_reduction_expires_at?: Date | null } | null
) {
  return {
    effective: {
      percent: fee.percent,
      // The whole point of this endpoint: an operator setting a rate has to be
      // able to see which of the three sources actually won.
      source: fee.source,
      override_expired: fee.override_expired,
      override_reason: fee.override_reason,
    },
    plan: { code: fee.plan_code, percent: fee.plan_percent },
    override: settings
      ? {
          percent: settings.custom_platform_fee_percent ?? null,
          reason: settings.fee_reduction_reason ?? null,
          expires_at: settings.fee_reduction_expires_at ?? null,
        }
      : null,
  }
}

/**
 * GET /admin/sellers/:id/payout-settings
 *
 * What platform fee applies to this seller and why: the negotiated override (if
 * any), the plan's rate, and which one won.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  try {
    const payouts = req.scope.resolve<PayoutBreakdownService>(
      PAYOUT_BREAKDOWN_MODULE
    )
    const [fee, settings] = await Promise.all([
      resolveSellerPlatformFee(req.scope, sellerId),
      payouts.getSellerSettings(sellerId),
    ])

    return res.json(serialize(fee, settings))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /admin/sellers/:id/payout-settings] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load payout settings" })
  }
}

/**
 * POST /admin/sellers/:id/payout-settings
 *
 * Set or clear a seller's negotiated platform-fee override.
 *
 * This is the writer `custom_platform_fee_percent` never had:
 * `getEffectivePlatformFee` has always read that column, but
 * `createSellerPayoutSettings` had no call site anywhere in the codebase, so
 * nothing could ever set it.
 *
 * Deliberately operator-only and deliberately NOT written from a plan change —
 * this column means "a human negotiated this rate with this seller". If plan
 * transitions wrote here too, nothing downstream could tell a concession from a
 * plan rate, and a later plan change would silently overwrite an agreement.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  const body = (req.body ?? {}) as OverrideBody

  if (!("custom_platform_fee_percent" in body)) {
    return res.status(400).json({
      type: "invalid_data",
      message: "custom_platform_fee_percent is required (null to clear)",
    })
  }

  const raw = body.custom_platform_fee_percent
  let percent: number | null = null

  if (raw !== null && raw !== undefined) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return res.status(400).json({
        type: "invalid_data",
        message: "custom_platform_fee_percent must be a number or null",
      })
    }
    if (raw < 0 || raw > 100) {
      // A negative fee would pay a seller more than the customer paid; over 100
      // would make their payout negative. Neither is a rate anyone means.
      return res.status(400).json({
        type: "invalid_data",
        message: "custom_platform_fee_percent must be between 0 and 100",
      })
    }
    percent = raw
  }

  let expiresAt: Date | null = null
  if (body.expires_at !== null && body.expires_at !== undefined) {
    const parsed = new Date(body.expires_at)
    if (Number.isNaN(parsed.getTime())) {
      return res
        .status(400)
        .json({ type: "invalid_data", message: "expires_at must be a date" })
    }
    expiresAt = parsed
  }

  try {
    const payouts = req.scope.resolve<PayoutBreakdownService>(
      PAYOUT_BREAKDOWN_MODULE
    )

    if (percent === null) {
      await payouts.clearSellerFeeOverride(sellerId)
    } else {
      await payouts.upsertSellerSettings(sellerId, {
        custom_platform_fee_percent: percent,
        fee_reduction_reason: body.reason ?? null,
        fee_reduction_expires_at: expiresAt,
      })
    }

    // Re-resolve so the response shows what now actually applies, not what was
    // asked for — an override with a past expiry, for instance, changes nothing.
    const [fee, settings] = await Promise.all([
      resolveSellerPlatformFee(req.scope, sellerId),
      payouts.getSellerSettings(sellerId),
    ])

    return res.json(serialize(fee, settings))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /admin/sellers/:id/payout-settings] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to save payout settings" })
  }
}
