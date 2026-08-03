import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { REFERRAL_MODULE } from "../../../../../modules/referral"
import type ReferralService from "../../../../../modules/referral/service"
import {
  ReferralSource,
  isValidAttribution,
} from "../../../../../modules/referral/attribution"

const log = createLogger("api/admin/sellers/referral")

type RecordBody = {
  referrer_seller_id?: string
  /** Override the default earning window end. Omit for the default window. */
  expires_at?: string | null
  reason?: string | null
}

/**
 * GET /admin/sellers/:id/referral — who referred this seller, and are they
 * still earning?
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  try {
    const referral = req.scope.resolve<ReferralService>(REFERRAL_MODULE)
    const rows = await referral.listSellerReferrals({
      referred_seller_id: sellerId,
    })
    const active = await referral.getActiveReferrer(sellerId)
    return res.json({ referral: rows?.[0] ?? null, earning: active })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /admin/sellers/:id/referral] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load referral" })
  }
}

/**
 * POST /admin/sellers/:id/referral — record that another seller referred this
 * one onto the platform.
 *
 * Operator-recorded (`source = admin`). A seller is referred at most once, so a
 * second call is a replay that returns the existing attribution rather than
 * overwriting it — the first referrer stands. Self-referral is rejected 400.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const referredSellerId = String(req.params.id || "").trim()
  const body = (req.body ?? {}) as RecordBody
  const referrerSellerId = String(body.referrer_seller_id || "").trim()

  if (!referredSellerId || !referrerSellerId) {
    return res.status(400).json({
      type: "invalid_data",
      message: "seller id and referrer_seller_id are required",
    })
  }

  if (!isValidAttribution(referredSellerId, referrerSellerId)) {
    return res.status(400).json({
      type: "invalid_data",
      message: "a seller cannot be recorded as their own referrer",
    })
  }

  let expiresAt: Date | null | undefined
  if (body.expires_at === null) {
    expiresAt = null
  } else if (typeof body.expires_at === "string" && body.expires_at.trim()) {
    const parsed = new Date(body.expires_at)
    if (Number.isNaN(parsed.getTime())) {
      return res
        .status(400)
        .json({ type: "invalid_data", message: "expires_at is not a valid date" })
    }
    expiresAt = parsed
  }

  try {
    const referral = req.scope.resolve<ReferralService>(REFERRAL_MODULE)
    const { referral: row, created } = await referral.recordReferral({
      referred_seller_id: referredSellerId,
      referrer_seller_id: referrerSellerId,
      source: ReferralSource.ADMIN,
      expires_at: expiresAt,
      metadata: body.reason ? { reason: body.reason } : null,
    })
    return res.status(created ? 201 : 200).json({ referral: row, created })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /admin/sellers/:id/referral] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to record referral" })
  }
}

/**
 * DELETE /admin/sellers/:id/referral — end a referral early (fraud, dispute).
 *
 * Revokes rather than deletes, so the attribution stays on record while paying
 * nothing. Idempotent on an already-revoked referral.
 */
export async function DELETE(
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
    const referral = req.scope.resolve<ReferralService>(REFERRAL_MODULE)
    const revoked = await referral.revokeReferral(sellerId)
    return res.json({ revoked })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[DELETE /admin/sellers/:id/referral] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to revoke referral" })
  }
}
