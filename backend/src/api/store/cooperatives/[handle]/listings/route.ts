import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"
import type CooperativeService from "../../../../../modules/cooperative/service"

/**
 * GET /store/cooperatives/:handle/listings
 * Coalition storefront — the products a coalition hosts/displays. The product
 * lives in FBM and checkout stays in FBM; the coalition only contextualizes it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { handle } = req.params
  const cooperativeService =
    req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)

  const coops = await cooperativeService.listCooperatives({ handle })
  const coop = coops[0]
  if (!coop) {
    return res.status(404).json({ message: "Cooperative not found" })
  }

  const listings = await cooperativeService.listCooperativeListings({
    cooperative_id: coop.id,
    is_active: true,
  })

  return res.status(200).json({
    cooperative: {
      id: coop.id,
      handle: coop.handle,
      name: coop.name,
      description: coop.description,
      cover_image: coop.cover_image,
    },
    listings: listings.map((l: any) => ({
      id: l.id,
      name: l.name,
      product_id: l.product_id,
      unified_price: l.unified_price,
      currency_code: l.currency_code,
      featured: l.featured,
      launch_id: (l.metadata as any)?.launch_id ?? null,
    })),
    count: listings.length,
  })
}
