import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { BADGE_CONFIG } from "../../../modules/vendor-verification/service"
import {
  VerificationLevel,
  VerificationType,
} from "../../../modules/vendor-verification/models"

/**
 * GET /store/verification-criteria
 *
 * The published rules behind every badge and verification level.
 *
 * A badge that cannot be looked up is decoration. This serves the same
 * `BADGE_CONFIG` table the admin grant picker reads and `getTrustSummary`
 * renders from, so what a buyer is told a badge means is definitionally what
 * the reviewer granted.
 */

/**
 * What each level requires, in the language a vendor or buyer would use.
 *
 * The score thresholds mirror `recalculateTrustScore`. They are restated here
 * rather than imported because the service computes them from summed check
 * weights, and a public page needs the plain-English version — but they must be
 * kept in step, which `verification-criteria.unit.spec.ts` asserts.
 */
const LEVEL_CRITERIA: Record<
  VerificationLevel,
  { label: string; min_trust_score: number; summary: string }
> = {
  [VerificationLevel.UNVERIFIED]: {
    label: "New Provider",
    min_trust_score: 0,
    summary:
      "No checks completed yet. New sellers start here — it is a starting point, not a warning.",
  },
  [VerificationLevel.SELF_REPORTED]: {
    label: "Self-Reported",
    min_trust_score: 20,
    summary:
      "The seller has told us who they are and we have confirmed enough to open a storefront. Their claims about practices are their own, not ours.",
  },
  [VerificationLevel.VERIFIED]: {
    label: "Verified",
    min_trust_score: 50,
    summary:
      "Identity and payout details confirmed by our team against documentation the seller supplied.",
  },
  [VerificationLevel.AUDITED]: {
    label: "Audited",
    min_trust_score: 70,
    summary:
      "Everything in Verified, plus their production location or process has been reviewed rather than taken on trust.",
  },
  [VerificationLevel.CERTIFIED]: {
    label: "Certified",
    min_trust_score: 80,
    summary:
      "Everything in Audited, plus at least one external certification confirmed with the body that issued it.",
  },
}

/** What each check actually examines. */
const CHECK_CRITERIA: Record<VerificationType, string> = {
  [VerificationType.IDENTITY]:
    "Legal name or registered business name matched against government or registry documentation.",
  [VerificationType.LOCATION]:
    "The address the seller operates from, confirmed against documentation or a visit.",
  [VerificationType.PRODUCTION]:
    "The facility or land where goods are actually made or grown.",
  [VerificationType.PRACTICES]:
    "Growing, sourcing, or production methods the seller advertises.",
  [VerificationType.CERTIFICATION]:
    "An external certification confirmed with the issuing body, not just a certificate we were shown.",
  [VerificationType.BANK_ACCOUNT]:
    "Payout account ownership, verified through Stripe.",
  [VerificationType.TAX_INFO]:
    "Tax registration details required to trade lawfully.",
}

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  res.json({
    levels: Object.entries(LEVEL_CRITERIA).map(([level, criteria]) => ({
      level,
      ...criteria,
    })),
    checks: Object.entries(CHECK_CRITERIA).map(([check_type, description]) => ({
      check_type,
      description,
    })),
    badges: Object.entries(BADGE_CONFIG).map(([badge_type, config]) => ({
      badge_type,
      ...config,
    })),
  })
}

export { LEVEL_CRITERIA, CHECK_CRITERIA }
