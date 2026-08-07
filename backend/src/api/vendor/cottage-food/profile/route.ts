import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE } from "../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../modules/cottage-food/service"
import { getSellerId } from "../../quests/_helpers"
import { sanitizeProfileInput } from "../_helpers"

/**
 * GET /vendor/cottage-food/profile
 * The seller's self-declared cottage-food profile, or `{ profile: null }` if
 * they haven't set one up. Absence is a normal state, not an error — the
 * module is opt-in.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const profile = await service.getProfileForSeller(sellerId)

  res.json({ profile })
}

/**
 * POST /vendor/cottage-food/profile
 * Create or update the profile. Every field is optional: a seller can save a
 * profile with nothing declared and fill it in over time, and clearing a limit
 * (sending explicit null) is how they stop tracking it.
 *
 * Nothing here is validated against a legal standard — FBM ships no state-law
 * table and records what the seller tells it.
 */
export const POST = async (
  req: MedusaRequest<Record<string, unknown>>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const patch = sanitizeProfileInput(req.body ?? {})

  await service.upsertProfileForSeller(sellerId, patch)
  const profile = await service.getProfileForSeller(sellerId)

  res.json({ profile })
}

/** PATCH behaves identically to POST — the route is an upsert either way. */
export const PATCH = POST
