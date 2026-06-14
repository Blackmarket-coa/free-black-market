import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { requireSellerId } from "../../../shared"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const DeliveryStatusEnum = z.enum([
  "PENDING",
  "ASSIGNED",
  "COURIER_EN_ROUTE_PICKUP",
  "COURIER_ARRIVED_PICKUP",
  "WAITING_FOR_ORDER",
  "ORDER_PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "ARRIVED_AT_DESTINATION",
  "ATTEMPTING_DELIVERY",
  "DELIVERED",
  "DELIVERED_TO_NEIGHBOR",
  "DELIVERED_TO_SAFE_PLACE",
  "DELIVERY_FAILED",
  "CUSTOMER_NOT_AVAILABLE",
  "WRONG_ADDRESS",
  "REFUSED",
  "RETURNED_TO_PRODUCER",
  "CANCELLED",
])

const listDeliveriesQuerySchema = z.object({
  status: DeliveryStatusEnum.optional(),
  priority: z.enum(["STANDARD", "EXPRESS", "SCHEDULED", "ASAP", "BATCH", "VOLUNTEER"]).optional(),
  from_date: z.string().datetime().optional(),
  to_date: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /vendor/deliveries
// List all deliveries for the vendor's producer/restaurant
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    // Get seller from auth context using shared helper
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const query = listDeliveriesQuerySchema.parse(req.query)
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Find the food producer linked to this seller via seller_id on food_producer
    const producers = await foodDistribution.listFoodProducers(
      { seller_id: sellerId },
      { select: ["id"], take: 1 }
    )

    if (!producers.length) {
      // No producer profile yet — return empty list instead of an error
      res.json({
        deliveries: [],
        count: 0,
        summary: { pending: 0, active: 0, completed: 0, failed: 0 },
        limit: query.limit,
        offset: query.offset,
      })
      return
    }

    const producerId = producers[0].id

    // Build filters
    const filters: Record<string, any> = {
      producer_id: producerId,
    }
    
    if (query.status) filters.status = query.status
    if (query.priority) filters.priority = query.priority

    // Get deliveries
    const deliveries = await foodDistribution.listFoodDeliveries(filters, {
      take: query.limit,
      skip: query.offset,
      order: { created_at: "DESC" },
    })

    // Get total count
    const allDeliveries = await foodDistribution.listFoodDeliveries(filters, { select: ["id"] })
    const count = allDeliveries.length

    // Group by status for dashboard summary
    const summary = {
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
    }

    for (const d of allDeliveries) {
      if (d.status === "PENDING") summary.pending++
      else if (["DELIVERED", "DELIVERED_TO_NEIGHBOR", "DELIVERED_TO_SAFE_PLACE"].includes(d.status)) summary.completed++
      else if (["DELIVERY_FAILED", "CUSTOMER_NOT_AVAILABLE", "WRONG_ADDRESS", "REFUSED", "RETURNED_TO_PRODUCER", "CANCELLED"].includes(d.status)) summary.failed++
      else summary.active++
    }

    res.json({
      deliveries,
      count,
      summary,
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
