import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../modules/creator-attribution/service"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const links = await service.listAffiliateLinks({ creator_seller_id: sellerId })
  return res.json({ links, count: links.length })
}

type Body = {
  product_id?: string
  collection_id?: string
  destination_path?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  vendor_id?: string
  deal_id?: string
  program_id?: string
  metadata?: Record<string, unknown>
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body || {}) as Body
  const service = req.scope.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const link = await service.generateLink({
    creatorSellerId: sellerId,
    vendorId: body.vendor_id ?? null,
    dealId: body.deal_id ?? null,
    programId: body.program_id ?? null,
    productId: body.product_id ?? null,
    collectionId: body.collection_id ?? null,
    destinationPath: body.destination_path,
    utmMedium: body.utm_medium ?? null,
    utmCampaign: body.utm_campaign ?? null,
    utmContent: body.utm_content ?? null,
    metadata: body.metadata ?? null,
  })
  return res.status(201).json({ link })
}
