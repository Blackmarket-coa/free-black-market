import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE } from "../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../modules/cottage-food/service"
import { getSellerId } from "../../quests/_helpers"
import { sanitizeIngredients, sanitizeAllergens } from "../_helpers"

/**
 * GET /vendor/cottage-food/labels
 * This seller's labels, newest first.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const labels = await service.listCottageFoodLabels(
    { seller_id: sellerId },
    { order: { created_at: "DESC" } }
  )

  res.json({ labels })
}

interface CreateLabelBody {
  product_name?: string
  product_id?: string
  botanical_formula_id?: string
  net_weight_text?: string
  ingredients?: unknown
  allergens?: unknown
  allergen_cross_contact_note?: string
}

/**
 * POST /vendor/cottage-food/labels
 *
 * Create a label. Only `product_name` is required — a seller can start a label
 * and come back to it, and a half-finished label is more useful than a blocked
 * form. The composed output omits whatever isn't filled in rather than
 * inventing a disclosure sentence or permit number.
 *
 * Producer and disclosure lines are snapshotted off the profile at creation
 * time so a label already printed and stuck on a jar keeps reading the way it
 * read when it was printed.
 */
export const POST = async (
  req: MedusaRequest<CreateLabelBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = req.body ?? {}
  const productName =
    typeof body.product_name === "string" ? body.product_name.trim() : ""
  if (!productName) {
    return res.status(400).json({ message: "product_name is required" })
  }

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const label = await service.createLabelForSeller(sellerId, {
    product_name: productName.slice(0, 300),
    product_id: body.product_id ?? null,
    botanical_formula_id: body.botanical_formula_id ?? null,
    net_weight_text:
      typeof body.net_weight_text === "string"
        ? body.net_weight_text.trim().slice(0, 100) || null
        : null,
    ingredients: sanitizeIngredients(body.ingredients) ?? null,
    allergens: sanitizeAllergens(body.allergens) ?? null,
    allergen_cross_contact_note:
      typeof body.allergen_cross_contact_note === "string"
        ? body.allergen_cross_contact_note.trim().slice(0, 500) || null
        : null,
  })

  const rendered = await service.renderLabel((label as { id: string }).id)
  res.status(201).json(rendered)
}
