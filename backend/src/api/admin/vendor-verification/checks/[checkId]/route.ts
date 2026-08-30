import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

import { VENDOR_VERIFICATION_MODULE } from "../../../../../modules/vendor-verification"
import type VendorVerificationService from "../../../../../modules/vendor-verification/service"
import { CheckStatus } from "../../../../../modules/vendor-verification/models"
import { grantKarmaBestEffort } from "../../../../../lib/karma-grants"

const Schema = z.object({
  status: z.enum([CheckStatus.PASSED, CheckStatus.FAILED, CheckStatus.WAIVED]),
  notes: z.string().max(2000).optional(),
  /** ISO date. Set on checks that lapse — a certification, an inspection. */
  expires_at: z.string().datetime().optional(),
  /**
   * Overrides the default weight for this check type. Reviewers need this for
   * partial credit (a location verified from photos rather than a site visit),
   * but it is capped so a single check cannot fabricate a CERTIFIED level.
   */
  score_contribution: z.number().min(0).max(100).optional(),
})

/**
 * POST /admin/vendor-verification/checks/:checkId
 *
 * Decide a submitted verification check: pass, fail, or waive it.
 *
 * This is the write path the verification system shipped without. Vendors
 * could submit checks and the service could score them, but nothing in the
 * admin panel could actually record a decision — so every seller stayed
 * UNVERIFIED regardless of what they filed. Displaying a "verified maker"
 * badge on the storefront is only honest once this exists.
 *
 * Passing a check recalculates the seller's trust score and may move their
 * verification level; the service owns that arithmetic
 * (`recalculateTrustScore`), so the route does not duplicate the thresholds.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const checkId = (req.params as { checkId?: string })?.checkId
  if (!checkId) {
    return res
      .status(400)
      .json({ message: "Missing check id", type: "invalid_request" })
  }

  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid verification decision payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const reviewerId =
    (req as MedusaRequest & { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id || "admin"

  const check = await service.processVerificationCheck(checkId, {
    status: parsed.data.status,
    verified_by: reviewerId,
    notes: parsed.data.notes,
    expires_at: parsed.data.expires_at
      ? new Date(parsed.data.expires_at)
      : undefined,
    score_contribution: parsed.data.score_contribution,
  })

  // Return the recomputed record so the panel can show the new level without
  // a second round trip — the decision's whole point is what it moved.
  const checkRow = Array.isArray(check) ? check[0] : check
  const verification = await service.retrieveVendorVerification(
    checkRow.vendor_verification_id
  )

  // Reputation: a passed check lands on the canonical karma log (W4) —
  // trust_score itself stays the derived projection recomputed above.
  if (parsed.data.status === CheckStatus.PASSED && verification?.seller_id) {
    const contribution = Math.max(
      1,
      Math.round(Number(checkRow.score_contribution ?? 0)) || 1
    )
    await grantKarmaBestEffort(req.scope, {
      member_id: String(verification.seller_id),
      delta: contribution,
      reason: "verification:check_passed",
      source_module: "vendor_verification",
      source_id: String(checkRow.id),
      metadata: { check_type: checkRow.check_type ?? null },
    })
  }

  res.json({ check, verification })
}
