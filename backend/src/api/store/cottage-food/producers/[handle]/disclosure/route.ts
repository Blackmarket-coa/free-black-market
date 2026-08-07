import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE, ALLERGEN_LABELS } from "../../../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../../../modules/cottage-food/service"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../../modules/food-distribution/service"
import type { MajorAllergen } from "../../../../../../modules/cottage-food"

/**
 * GET /store/cottage-food/producers/:handle/disclosure
 *
 * Buyer-facing home-kitchen disclosure for a food producer: the seller's own
 * disclosure sentence, their permit line, and the allergens declared across
 * their labels.
 *
 * Deliberately narrow. This returns only what the seller opted to publish:
 *
 *  - Nothing at all unless `public_disclosure_opt_in` is set.
 *  - The street address only when `show_address_publicly` is set. Home-based
 *    sellers are putting a *home* address on their labels; it belongs on the
 *    jar in the buyer's hand, not on a public page indexed by search engines.
 *
 * No compliance meters, ledger figures, or cap positions are exposed here —
 * a seller's revenue against their cap is nobody's business but theirs.
 */
/**
 * Resolve a handle to a seller id.
 *
 * Accepts either a food-producer handle or a seller handle, because the two
 * surfaces a buyer might be looking at — a food producer page and a seller
 * storefront — are keyed differently. Food producers are checked first since
 * that handle is the more specific of the two.
 */
async function resolveSellerId(
  req: MedusaRequest,
  handle: string
): Promise<string | null> {
  const foodService = req.scope.resolve<FoodDistributionService>(
    FOOD_DISTRIBUTION_MODULE
  )
  const [producer] = await foodService.listFoodProducers({ handle })
  if (producer?.seller_id) return producer.seller_id

  try {
    const query = req.scope.resolve("query") as {
      graph: (args: Record<string, unknown>) => Promise<{ data: any[] }>
    }
    const { data } = await query.graph({
      entity: "seller",
      fields: ["id"],
      filters: { handle },
    })
    return data?.[0]?.id ?? null
  } catch {
    return null
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = await resolveSellerId(req, req.params.handle)
  if (!sellerId) {
    return res.json({ disclosure: null })
  }

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const profile = await service.getProfileForSeller(sellerId)

  if (!profile || !profile.public_disclosure_opt_in) {
    return res.json({ disclosure: null })
  }

  const labels = await service.listCottageFoodLabels({
    seller_id: sellerId,
  })

  // Union of allergens the seller declared across their labels, so a buyer
  // with an allergy sees it on the producer page and not only per-product.
  const allergenKeys = new Set<string>()
  for (const label of labels) {
    if (!Array.isArray(label.allergens)) continue
    for (const a of label.allergens as string[]) allergenKeys.add(a)
  }
  const allergens = [...allergenKeys]
    .filter((a): a is MajorAllergen => a in ALLERGEN_LABELS)
    .map((a) => ({ key: a, label: ALLERGEN_LABELS[a] }))

  res.json({
    disclosure: {
      operation_type: profile.operation_type,
      disclosure_text: profile.label_disclosure_text,
      business_name: profile.label_business_name,
      // Withheld unless explicitly published.
      address: profile.show_address_publicly ? profile.label_address : null,
      jurisdiction_label: profile.jurisdiction_label,
      permit_number: profile.permit_number,
      permit_type_label: profile.permit_type_label,
      allergens,
      channels: {
        pickup: profile.allows_pickup,
        delivery: profile.allows_delivery,
        shipping: profile.allows_shipping,
      },
    },
  })
}
