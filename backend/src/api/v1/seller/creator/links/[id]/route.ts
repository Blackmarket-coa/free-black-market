import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../../modules/creator-attribution/service"
import { AffiliateLinkStatus } from "../../../../../../modules/creator-attribution/models"

const UpdateLinkSchema = z.object({
  status: z.nativeEnum(AffiliateLinkStatus).optional(),
  utm_medium: z.string().min(1).max(64).optional().nullable(),
  utm_campaign: z.string().min(1).max(128).optional().nullable(),
  utm_content: z.string().min(1).max(128).optional().nullable(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const linkId = (req.params as { id?: string })?.id
  if (!linkId) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const links = await service.listAffiliateLinks({ id: linkId, creator_seller_id: sellerId })
  if (links.length === 0) {
    return res.status(404).json({ message: "Link not found", type: "not_found" })
  }
  return res.status(200).json({ link: links[0] })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const linkId = (req.params as { id?: string })?.id
  if (!linkId) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const parsed = UpdateLinkSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid update",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const links = await service.listAffiliateLinks({ id: linkId, creator_seller_id: sellerId })
  if (links.length === 0) {
    return res.status(404).json({ message: "Link not found", type: "not_found" })
  }

  const updated = await service.updateAffiliateLinks({
    id: linkId,
    ...parsed.data,
  })
  return res.status(200).json({ link: updated })
}
