import { createLogger } from "../../../../../../../../shared/logger"
const log = createLogger("api/v1/seller/programs/[id]/applications/[appId]/decide")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../../../../modules/creator-program/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../../../../../modules/creator-attribution/service"
import { VENDOR_VERIFICATION_MODULE } from "../../../../../../../../modules/vendor-verification"
import { VerificationLevel } from "../../../../../../../../modules/vendor-verification/models/verification"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../../modules/marketplace-webhooks/service"

const DecideSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional().nullable(),
})

const LEVEL_RANK: Record<string, number> = {
  UNVERIFIED: 0,
  SELF_REPORTED: 1,
  VERIFIED: 2,
  AUDITED: 3,
  CERTIFIED: 4,
}

/**
 * POST /v1/seller/programs/:id/applications/:appId/decide
 *
 * The vendor approves or rejects a creator's application. On approval:
 *   1. KYC gating runs against the program's `min_verification_level` if
 *      `requires_kyc` is true. Block with 412 if the creator falls short.
 *   2. The application transitions to `approved`.
 *   3. A `CreatorDeal` is opened with a frozen `terms_snapshot`.
 *   4. A default `AffiliateLink` is auto-generated and back-referenced on the
 *      deal so the creator has an immediately shareable URL.
 *   5. `creator.deal.opened` webhook is dispatched to both vendor and creator.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  const appId = (req.params as { appId?: string })?.appId
  if (!programId || !appId) {
    return res.status(400).json({ message: "Missing ids", type: "invalid_request" })
  }

  const parsed = DecideSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid decide payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const programService = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)

  // Ownership check: this vendor must own the program.
  const programs = await programService.listCreatorPrograms({
    id: programId,
    vendor_id: sellerId,
  })
  const program = programs[0]
  if (!program) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }

  const apps = await programService.listCreatorApplications({
    id: appId,
    program_id: programId,
  })
  const application = apps[0]
  if (!application) {
    return res.status(404).json({ message: "Application not found", type: "not_found" })
  }

  // KYC gate (only on approval)
  if (parsed.data.decision === "approve" && program.requires_kyc) {
    try {
      const verificationSvc = req.scope.resolve<any>(VENDOR_VERIFICATION_MODULE)
      const verification = await verificationSvc.getOrCreateVerification(
        application.creator_seller_id
      )
      const required = program.min_verification_level ?? VerificationLevel.VERIFIED
      const requiredRank = LEVEL_RANK[required] ?? LEVEL_RANK.VERIFIED
      const actualRank = LEVEL_RANK[verification.level] ?? LEVEL_RANK.UNVERIFIED
      if (actualRank < requiredRank) {
        return res.status(412).json({
          message: `Creator KYC level (${verification.level}) below required (${required})`,
          type: "kyc_insufficient",
          creator_level: verification.level,
          required_level: required,
        })
      }
    } catch (err) {
      log.error("[program/decide] KYC check failed", err)
      return res.status(500).json({
        message: "KYC verification check failed",
        type: "kyc_check_failed",
      })
    }
  }

  let updatedApp
  try {
    updatedApp = await programService.decideApplication({
      applicationId: appId,
      decision: parsed.data.decision,
      decidedBy: sellerId,
      reason: parsed.data.reason ?? null,
    })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }

  let deal: any | null = null
  if (parsed.data.decision === "approve") {
    deal = await programService.openDealForApprovedApp(appId)

    // Auto-generate the default affiliate link for the creator.
    try {
      const attributionSvc = req.scope.resolve<CreatorAttributionService>(
        CREATOR_ATTRIBUTION_MODULE
      )
      const productIds = Array.isArray(program.product_ids) ? program.product_ids : []
      const link = (await attributionSvc.generateLink({
        creatorSellerId: application.creator_seller_id,
        vendorId: sellerId,
        dealId: deal.id,
        programId: programId,
        productId: productIds.length === 1 ? productIds[0] : null,
        utmCampaign: program.slug,
      })) as any
      deal = await programService.attachDefaultLinkToDeal(deal.id, link.id)
    } catch (err) {
      log.error("[program/decide] auto-link generation failed", err)
    }

    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
      const payload = {
        deal_id: deal.id,
        program_id: programId,
        application_id: appId,
        creator_seller_id: application.creator_seller_id,
        vendor_id: sellerId,
        terms_snapshot: deal.terms_snapshot,
        default_affiliate_link_id: deal.default_affiliate_link_id ?? null,
      }
      await webhooks.dispatch("creator.deal.opened", sellerId, payload)
      await webhooks.dispatch("creator.deal.opened", application.creator_seller_id, payload)
      await webhooks.dispatch("creator.application.approved", application.creator_seller_id, {
        application_id: appId,
        program_id: programId,
        deal_id: deal.id,
      })
    } catch (err) {
      log.error("[program/decide] webhook dispatch failed", err)
    }
  } else {
    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
      await webhooks.dispatch("creator.application.rejected", application.creator_seller_id, {
        application_id: appId,
        program_id: programId,
        reason: parsed.data.reason ?? null,
      })
    } catch (err) {
      log.error("[program/decide] reject webhook dispatch failed", err)
    }
  }

  return res.status(200).json({ application: updatedApp, deal })
}
