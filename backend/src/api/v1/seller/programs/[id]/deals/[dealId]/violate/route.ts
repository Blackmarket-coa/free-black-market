import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../../../../modules/creator-program/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../../../../../modules/creator-attribution/service"
import { AffiliateLinkStatus } from "../../../../../../../../modules/creator-attribution/models"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../../modules/marketplace-webhooks/service"

const ViolateSchema = z.object({
  reason: z.string().min(2).max(2000),
  pause_links: z.boolean().optional(),
})

/**
 * POST /v1/seller/programs/:id/deals/:dealId/violate
 *
 * Vendor flags a creator deal as violated (e.g. brand-safety violation).
 * Optionally pauses all affiliate links generated under this deal so no
 * further attributions can land. Held attributions can still be reviewed
 * via admin moderation.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  const dealId = (req.params as { dealId?: string })?.dealId
  if (!programId || !dealId) {
    return res.status(400).json({ message: "Missing ids", type: "invalid_request" })
  }
  const parsed = ViolateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid violate payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)

  // Ownership check
  const programs = await service.listCreatorPrograms({ id: programId, vendor_id: sellerId })
  if (programs.length === 0) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const deals = await service.listCreatorDeals({ id: dealId, program_id: programId })
  const deal = deals[0]
  if (!deal) {
    return res.status(404).json({ message: "Deal not found", type: "not_found" })
  }

  const updated = await service.violateDeal(dealId, parsed.data.reason)

  if (parsed.data.pause_links) {
    try {
      const attributionSvc = req.scope.resolve<CreatorAttributionService>(
        CREATOR_ATTRIBUTION_MODULE
      )
      const links = await attributionSvc.listAffiliateLinks({ deal_id: dealId })
      for (const l of links) {
        await (attributionSvc as any).updateAffiliateLinks({
          id: l.id,
          status: AffiliateLinkStatus.PAUSED,
        })
      }
    } catch (err) {
      console.error("[deal/violate] failed to pause links", err)
    }
  }

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    const payload = {
      deal_id: dealId,
      program_id: programId,
      vendor_id: sellerId,
      creator_seller_id: deal.creator_seller_id,
      reason: parsed.data.reason,
      paused_links: !!parsed.data.pause_links,
    }
    await webhooks.dispatch("creator.deal.violated", sellerId, payload)
    await webhooks.dispatch("creator.deal.violated", deal.creator_seller_id, payload)
  } catch (err) {
    console.error("[deal/violate] webhook dispatch failed", err)
  }

  return res.status(200).json({ deal: updated })
}
