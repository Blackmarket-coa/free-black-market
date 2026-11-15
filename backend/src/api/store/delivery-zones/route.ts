import { z } from "zod"
import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { requireSellerActor } from "../../../shared/community-write-access"
import { POST as createVendorZone } from "../../vendor/delivery-zones/route"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

// Writes validate with /vendor's schema (api/delivery-zones/contracts.ts).

const listZonesQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /delivery-zones
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listZonesQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {}
    if (query.active !== undefined) filters.active = query.active
    
    const zones = await foodDistribution.listDeliveryZones(filters, {
      take: query.limit,
      skip: query.offset,
      order: { priority: "DESC", name: "ASC" },
    })
    
    const count = await foodDistribution
      .listDeliveryZones(filters, { select: ["id"] })
      .then((z) => z.length)
    
    res.json({
      zones,
      count,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}

// ===========================================
// POST /delivery-zones
//
// Sellers only, and the write is /vendor/delivery-zones' own handler. That
// route is the seller surface for zones: it refuses a zone that overlaps an
// active one (409 DELIVERY_ZONE_CONFLICT), stores fees in cents from the
// dollars it is sent, and stamps `created_by_seller_id`, the column edits are
// authorized against. A second seller write path here without the overlap
// check and the unit conversion would let a seller create a zone /vendor
// refuses, priced in whichever unit it chose; so this one delegates.
// Customers and drivers get the shared 403 before it is reached.
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerActor(req, res)
  if (!sellerId) return
  return createVendorZone(req as AuthenticatedMedusaRequest, res)
}
