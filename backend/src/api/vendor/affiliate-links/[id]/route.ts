import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../modules/creator-attribution"
import { AffiliateLinkStatus } from "../../../../modules/creator-attribution/models/affiliate-link"
import type CreatorAttributionService from "../../../../modules/creator-attribution/service"
import { sellerIdForVendorActor } from "../../../../shared/seller-actor"

async function loadOwned(
  service: CreatorAttributionService,
  sellerId: string,
  id: string
) {
  const [link] = await service.listAffiliateLinks({ id })
  if (!link) return { link: null, owned: false }
  return { link, owned: link.creator_seller_id === sellerId }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await sellerIdForVendorActor(req.scope, actorId)
  const { id } = req.params
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })
  if (!id) return res.status(400).json({ message: "id is required" })

  const service = req.scope.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const { link, owned } = await loadOwned(service, sellerId, id)
  if (!link) return res.status(404).json({ message: "Not found" })
  if (!owned) return res.status(403).json({ message: "Not your link" })
  return res.json({ link })
}

type PatchBody = {
  status?: AffiliateLinkStatus
  destination_path?: string
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  metadata?: Record<string, unknown>
}

export async function PATCH(req: MedusaRequest<PatchBody>, res: MedusaResponse) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await sellerIdForVendorActor(req.scope, actorId)
  const { id } = req.params
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })
  if (!id) return res.status(400).json({ message: "id is required" })

  const service = req.scope.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const { link, owned } = await loadOwned(service, sellerId, id)
  if (!link) return res.status(404).json({ message: "Not found" })
  if (!owned) return res.status(403).json({ message: "Not your link" })

  const body = (req.validatedBody || req.body || {}) as PatchBody
  const update: Record<string, unknown> = { id }
  if (body.status) update.status = body.status
  if (body.destination_path !== undefined) update.destination_path = body.destination_path
  if (body.utm_medium !== undefined) update.utm_medium = body.utm_medium
  if (body.utm_campaign !== undefined) update.utm_campaign = body.utm_campaign
  if (body.utm_content !== undefined) update.utm_content = body.utm_content
  if (body.metadata !== undefined) update.metadata = body.metadata
  const [updated] = await service.updateAffiliateLinks([update])
  return res.json({ link: updated })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await sellerIdForVendorActor(req.scope, actorId)
  const { id } = req.params
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })
  if (!id) return res.status(400).json({ message: "id is required" })

  const service = req.scope.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const { link, owned } = await loadOwned(service, sellerId, id)
  if (!link) return res.status(404).json({ message: "Not found" })
  if (!owned) return res.status(403).json({ message: "Not your link" })

  // Soft revoke instead of hard delete to preserve historical attribution.
  const [updated] = await service.updateAffiliateLinks([
    { id, status: AffiliateLinkStatus.REVOKED },
  ])
  return res.json({ link: updated, revoked: true })
}
