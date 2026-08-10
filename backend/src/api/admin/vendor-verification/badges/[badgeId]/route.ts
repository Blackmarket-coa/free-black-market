import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

import { VENDOR_VERIFICATION_MODULE } from "../../../../../modules/vendor-verification"
import type VendorVerificationService from "../../../../../modules/vendor-verification/service"
import { BadgeStatus } from "../../../../../modules/vendor-verification/models"

const Schema = z.object({
  status: z.enum([
    BadgeStatus.ACTIVE,
    BadgeStatus.SUSPENDED,
    BadgeStatus.REVOKED,
  ]),
  reason: z.string().max(2000).optional(),
})

/**
 * POST /admin/vendor-verification/badges/:badgeId
 *
 * Suspend, revoke, or reinstate a granted badge.
 *
 * A grant path without a withdrawal path would make badges unsafe to display:
 * certifications lapse, and documentation sometimes turns out to be wrong
 * after the fact. SUSPENDED is reversible, REVOKED is not; both remove the
 * badge from what buyers see, since `getActiveBadges` filters on ACTIVE.
 *
 * The previous status, the actor, and the reason are recorded on the badge's
 * metadata, so a withdrawal is auditable rather than a silent disappearance.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const badgeId = (req.params as { badgeId?: string })?.badgeId
  if (!badgeId) {
    return res
      .status(400)
      .json({ message: "Missing badge id", type: "invalid_request" })
  }

  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid badge status payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const changedBy =
    (req as MedusaRequest & { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id || "admin"

  const badge = await service.setBadgeStatus(badgeId, parsed.data.status, {
    changed_by: changedBy,
    reason: parsed.data.reason,
  })

  res.json({ badge })
}
