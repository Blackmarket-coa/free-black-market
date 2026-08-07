import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE } from "../../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../../modules/cottage-food/service"
import { getSellerId } from "../../../quests/_helpers"
import { sanitizeIngredients, sanitizeAllergens } from "../../_helpers"

/**
 * Fetch a label only if it belongs to this seller.
 *
 * Ownership is checked by filtering on `seller_id` rather than retrieving and
 * comparing, so a miss is indistinguishable from a nonexistent id — another
 * seller's label id shouldn't be confirmable by probing.
 */
async function loadOwnedLabel(
  service: CottageFoodModuleService,
  sellerId: string,
  labelId: string
) {
  const [label] = await service.listCottageFoodLabels({
    id: labelId,
    seller_id: sellerId,
  })
  return label ?? null
}

/**
 * GET /vendor/cottage-food/labels/:id
 * The composed label — structured pieces, printable text, and a checklist of
 * what's still missing.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const owned = await loadOwnedLabel(service, sellerId, req.params.id)
  if (!owned) return res.status(404).json({ message: "Label not found" })

  res.json(await service.renderLabel(req.params.id))
}

interface UpdateLabelBody {
  product_name?: string
  net_weight_text?: string | null
  ingredients?: unknown
  allergens?: unknown
  allergen_cross_contact_note?: string | null
  /** Seller confirming they've read the composed label. */
  reviewed?: boolean
  /** Re-snapshot the producer/disclosure lines from the current profile. */
  refresh_profile_snapshot?: boolean
}

/**
 * PATCH /vendor/cottage-food/labels/:id
 *
 * Update label content, mark it reviewed, or re-pull the producer lines from
 * the profile.
 *
 * `reviewed` is the seller's own confirmation that the label says what their
 * jurisdiction requires. FBM never sets it on their behalf and never marks a
 * label "approved" — that isn't a judgment the platform is in a position to
 * make.
 */
export const PATCH = async (
  req: MedusaRequest<UpdateLabelBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const owned = await loadOwnedLabel(service, sellerId, req.params.id)
  if (!owned) return res.status(404).json({ message: "Label not found" })

  const body = req.body ?? {}
  const patch: Record<string, unknown> = { id: req.params.id }

  if (typeof body.product_name === "string" && body.product_name.trim()) {
    patch.product_name = body.product_name.trim().slice(0, 300)
  }
  if ("net_weight_text" in body) {
    patch.net_weight_text =
      typeof body.net_weight_text === "string"
        ? body.net_weight_text.trim().slice(0, 100) || null
        : null
  }
  if ("ingredients" in body) {
    patch.ingredients = sanitizeIngredients(body.ingredients) ?? null
  }
  if ("allergens" in body) {
    patch.allergens = sanitizeAllergens(body.allergens) ?? null
  }
  if ("allergen_cross_contact_note" in body) {
    patch.allergen_cross_contact_note =
      typeof body.allergen_cross_contact_note === "string"
        ? body.allergen_cross_contact_note.trim().slice(0, 500) || null
        : null
  }
  if (typeof body.reviewed === "boolean") {
    patch.seller_reviewed_at = body.reviewed ? new Date() : null
  }

  if (body.refresh_profile_snapshot) {
    const profile = await service.getProfileForSeller(sellerId)
    patch.disclosure_text_snapshot = profile?.label_disclosure_text ?? null
    patch.business_name_snapshot = profile?.label_business_name ?? null
    patch.address_snapshot = profile?.label_address ?? null
    patch.permit_number_snapshot = profile?.permit_number ?? null
  }

  await service.updateCottageFoodLabels(patch)
  res.json(await service.renderLabel(req.params.id))
}

/**
 * DELETE /vendor/cottage-food/labels/:id
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const owned = await loadOwnedLabel(service, sellerId, req.params.id)
  if (!owned) return res.status(404).json({ message: "Label not found" })

  await service.deleteCottageFoodLabels(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
