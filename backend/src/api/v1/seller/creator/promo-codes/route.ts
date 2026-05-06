import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../modules/creator-attribution/service"

const BindSchema = z.object({
  promotion_id: z.string().min(1).max(128),
  promotion_code: z.string().min(2).max(64),
  deal_id: z.string().min(1).max(64).optional().nullable(),
  program_id: z.string().min(1).max(64).optional().nullable(),
  vendor_id: z.string().min(1).max(64).optional().nullable(),
})

/**
 * GET /v1/seller/creator/promo-codes — list this creator's bound promo codes.
 * POST /v1/seller/creator/promo-codes — bind an existing Medusa promotion code
 * to this creator. When a customer applies the code at checkout, the
 * resulting order will be attributed to this creator.
 *
 * Note: ownership of the underlying Medusa promotion is enforced upstream by
 * the vendor that created it; this binding is creator-scoped so the *same*
 * promotion can be marketed by multiple creators only if each is given a
 * distinct code (which is what unique constraint on `promotion_code` enforces).
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const bindings = await service.listPromoCodeBindings({ creator_seller_id: sellerId })
  return res.status(200).json({ bindings })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = BindSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid binding payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const binding = await service.bindPromoCode({
    promotionId: parsed.data.promotion_id,
    promotionCode: parsed.data.promotion_code,
    creatorSellerId: sellerId,
    dealId: parsed.data.deal_id ?? null,
    programId: parsed.data.program_id ?? null,
    vendorId: parsed.data.vendor_id ?? null,
  })

  return res.status(201).json({ binding })
}
