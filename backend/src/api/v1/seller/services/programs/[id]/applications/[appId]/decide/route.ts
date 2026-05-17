import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../../../../middlewares/seller-context-v1"
import { SERVICE_PROGRAM_MODULE } from "../../../../../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../../../../../modules/service-program/service"
import { VENDOR_VERIFICATION_MODULE } from "../../../../../../../../../modules/vendor-verification"
import { VerificationLevel } from "../../../../../../../../../modules/vendor-verification/models/verification"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../../../modules/marketplace-webhooks/service"

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
 * POST /v1/seller/services/programs/:id/applications/:appId/decide
 *
 * Vendor approves/rejects a service-vendor application. On approval:
 *   1. Optional KYC gating against `min_verification_level`.
 *   2. Application -> approved.
 *   3. Service contract opened with frozen `terms_snapshot`.
 *   4. `service.contract.opened` webhook dispatched to both parties.
 *
 * Note: this endpoint does NOT auto-fund escrow — the buyer-vendor opens
 * a separate subcontract (which carries the escrow) when assigning work.
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

  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const programs = await service.listServicePrograms({
    id: programId,
    vendor_id: sellerId,
  })
  const program = programs[0]
  if (!program) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const apps = await service.listServiceApplications({
    id: appId,
    program_id: programId,
  })
  const app = apps[0]
  if (!app) {
    return res.status(404).json({ message: "Application not found", type: "not_found" })
  }

  // KYC gate
  if (parsed.data.decision === "approve" && program.requires_kyc) {
    try {
      const verificationSvc = req.scope.resolve<any>(VENDOR_VERIFICATION_MODULE)
      const verification = await verificationSvc.getOrCreateVerification(
        app.service_seller_id
      )
      const required = program.min_verification_level ?? VerificationLevel.VERIFIED
      const requiredRank = LEVEL_RANK[required] ?? LEVEL_RANK.VERIFIED
      const actualRank = LEVEL_RANK[verification.level] ?? LEVEL_RANK.UNVERIFIED
      if (actualRank < requiredRank) {
        return res.status(412).json({
          message: `Service vendor KYC level (${verification.level}) below required (${required})`,
          type: "kyc_insufficient",
          service_seller_level: verification.level,
          required_level: required,
        })
      }
    } catch (err) {
      console.error("[service-decide] KYC check failed", err)
      return res.status(500).json({
        message: "KYC verification check failed",
        type: "kyc_check_failed",
      })
    }
  }

  let updatedApp
  try {
    updatedApp = await service.decideApplication({
      applicationId: appId,
      decision: parsed.data.decision,
      decidedBy: sellerId,
      reason: parsed.data.reason ?? null,
    })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }

  let contract: any | null = null
  if (parsed.data.decision === "approve") {
    contract = await service.openContractForApprovedApp(appId)
    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
      const payload = {
        contract_id: contract.id,
        program_id: programId,
        application_id: appId,
        service_seller_id: app.service_seller_id,
        vendor_id: sellerId,
        terms_snapshot: contract.terms_snapshot,
      }
      await webhooks.dispatch("service.contract.opened", sellerId, payload)
      await webhooks.dispatch("service.contract.opened", app.service_seller_id, payload)
      await webhooks.dispatch(
        "service.application.approved",
        app.service_seller_id,
        {
          application_id: appId,
          program_id: programId,
          contract_id: contract.id,
        }
      )
    } catch (err) {
      console.error("[service-decide] webhook dispatch failed", err)
    }
  } else {
    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
      await webhooks.dispatch(
        "service.application.rejected",
        app.service_seller_id,
        {
          application_id: appId,
          program_id: programId,
          reason: parsed.data.reason ?? null,
        }
      )
    } catch (err) {
      console.error("[service-decide] reject webhook dispatch failed", err)
    }
  }

  return res.status(200).json({ application: updatedApp, contract })
}
