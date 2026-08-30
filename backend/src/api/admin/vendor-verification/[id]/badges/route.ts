import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

import { VENDOR_VERIFICATION_MODULE } from "../../../../../modules/vendor-verification"
import type VendorVerificationService from "../../../../../modules/vendor-verification/service"
import { BADGE_CONFIG } from "../../../../../modules/vendor-verification/service"
import { BadgeType } from "../../../../../modules/vendor-verification/models"
import {
  grantKarmaBestEffort,
  KARMA_DELTAS,
} from "../../../../../lib/karma-grants"

const GrantSchema = z.object({
  badge_type: z.nativeEnum(BadgeType),
  description: z.string().max(2000).optional(),
  /** Where the supporting document lives. Required for certification badges. */
  documentation_url: z.string().url().optional(),
  certification_number: z.string().max(200).optional(),
  certifying_body: z.string().max(200).optional(),
  /** ISO date. Certifications lapse; `processExpirations` reads this. */
  expires_at: z.string().datetime().optional(),
})

/**
 * Badges that assert an external certification rather than something the
 * coalition observed itself. Granting one without a pointer to the issuing
 * document would be the platform vouching for a claim it has not seen — the
 * exact failure the badge is supposed to rule out.
 */
const REQUIRES_DOCUMENTATION: BadgeType[] = [
  BadgeType.ORGANIC_CERTIFIED,
  BadgeType.FAIR_TRADE,
  BadgeType.B_CORP,
  BadgeType.CARBON_NEUTRAL,
]

/**
 * GET /admin/vendor-verification/:id/badges
 *
 * Every badge on a seller, in any status, plus the catalog of grantable types
 * with their published meaning. The catalog is served from `BADGE_CONFIG` so
 * the admin picker, the public criteria page, and the badge a buyer sees all
 * read the same table.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const sellerId = (req.params as { id?: string })?.id
  if (!sellerId) {
    return res
      .status(400)
      .json({ message: "Missing seller id", type: "invalid_request" })
  }

  const badges = await service.listVendorBadges({ seller_id: sellerId })

  res.json({
    badges,
    catalog: Object.entries(BADGE_CONFIG).map(([type, config]) => ({
      badge_type: type,
      ...config,
      requires_documentation: REQUIRES_DOCUMENTATION.includes(
        type as BadgeType
      ),
    })),
  })
}

/**
 * POST /admin/vendor-verification/:id/badges
 *
 * Grant a badge to a seller. Reactivates a previously suspended or revoked
 * badge of the same type rather than creating a duplicate — that behaviour
 * lives in `grantBadge`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const sellerId = (req.params as { id?: string })?.id
  if (!sellerId) {
    return res
      .status(400)
      .json({ message: "Missing seller id", type: "invalid_request" })
  }

  const parsed = GrantSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid badge grant payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const { badge_type, expires_at, ...rest } = parsed.data

  if (
    REQUIRES_DOCUMENTATION.includes(badge_type) &&
    !rest.documentation_url &&
    !rest.certification_number
  ) {
    return res.status(400).json({
      message: `${BADGE_CONFIG[badge_type].name} asserts an external certification. Record the documentation URL or the certification number before granting it.`,
      type: "invalid_request",
    })
  }

  const grantedBy =
    (req as MedusaRequest & { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id || "admin"

  const badge = await service.grantBadge(sellerId, badge_type, {
    ...rest,
    granted_by: grantedBy,
    expires_at: expires_at ? new Date(expires_at) : undefined,
  })

  // Reputation: a granted badge lands on the canonical karma log (W4);
  // the badge row itself stays the projection the storefront reads.
  const badgeRow = Array.isArray(badge) ? badge[0] : badge
  await grantKarmaBestEffort(req.scope, {
    member_id: String(sellerId),
    delta: KARMA_DELTAS.verification_badge,
    reason: "verification:badge_granted",
    source_module: "vendor_verification",
    source_id: String(badgeRow.id),
    metadata: { badge_type },
  })

  res.status(201).json({ badge })
}
