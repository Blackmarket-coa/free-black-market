import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../modules/creator-attribution/service"

const CreateLinkSchema = z.object({
  product_id: z.string().min(1).max(128).optional().nullable(),
  collection_id: z.string().min(1).max(128).optional().nullable(),
  destination_path: z.string().min(1).max(2048).optional(),
  utm_medium: z.string().min(1).max(64).optional().nullable(),
  utm_campaign: z.string().min(1).max(128).optional().nullable(),
  utm_content: z.string().min(1).max(128).optional().nullable(),
  deal_id: z.string().min(1).max(64).optional().nullable(),
  program_id: z.string().min(1).max(64).optional().nullable(),
  vendor_id: z.string().min(1).max(64).optional().nullable(),
  allowed_origins: z.array(z.string().url()).max(16).optional().nullable(),
})

/**
 * GET /v1/seller/creator/links — list this creator's affiliate links.
 * POST /v1/seller/creator/links — generate a new affiliate link.
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1), 200)
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const links = await service.listAffiliateLinks(
    { creator_seller_id: sellerId },
    { take: limit, skip: offset, order: { created_at: "DESC" } as const }
  )
  return res.status(200).json({ links, limit, offset })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = CreateLinkSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid link payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const link = await service.generateLink({
    creatorSellerId: sellerId,
    productId: parsed.data.product_id ?? null,
    collectionId: parsed.data.collection_id ?? null,
    destinationPath: parsed.data.destination_path,
    utmMedium: parsed.data.utm_medium ?? null,
    utmCampaign: parsed.data.utm_campaign ?? null,
    utmContent: parsed.data.utm_content ?? null,
    dealId: parsed.data.deal_id ?? null,
    programId: parsed.data.program_id ?? null,
    vendorId: parsed.data.vendor_id ?? null,
    allowedOrigins: parsed.data.allowed_origins ?? null,
  })

  return res.status(201).json({ link })
}
