import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createBatchSchema = z.object({
  delivery_ids: z.array(z.string()).min(1).max(20),
  courier_id: z.string().optional(),
  is_community_run: z.boolean().optional(),
  community_org_id: z.string().optional(),
  notes: z.string().max(500).optional(),
})

const listBatchesQuerySchema = z.object({
  status: z.enum(["PLANNING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  courier_id: z.string().optional(),
  is_community_run: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /delivery-batches
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listBatchesQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {}
    if (query.status) filters.status = query.status
    if (query.courier_id) filters.courier_id = query.courier_id
    if (query.is_community_run !== undefined) filters.is_community_run = query.is_community_run
    
    const batches = await foodDistribution.listDeliveryBatches(filters, {
      take: query.limit,
      skip: query.offset,
      order: { created_at: "DESC" },
    })
    
    const count = await foodDistribution
      .listDeliveryBatches(filters, { select: ["id"] })
      .then((b) => b.length)
    
    res.json({
      batches,
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
// POST /delivery-batches
// Create a new batch of deliveries
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createBatchSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify all deliveries exist and are available
    for (const deliveryId of data.delivery_ids) {
      const delivery = await foodDistribution.retrieveFoodDelivery(deliveryId)
      if (!delivery) {
        res.status(404).json({ message: `Delivery ${deliveryId} not found` })
        return
      }
      if (delivery.batch_id) {
        res.status(400).json({ 
          message: `Delivery ${deliveryId} is already part of a batch` 
        })
        return
      }
    }
    
    // If courier specified, verify they exist and are available
    if (data.courier_id) {
      const courier = await foodDistribution.retrieveCourier(data.courier_id)
      if (!courier) {
        res.status(404).json({ message: "Courier not found" })
        return
      }
      if (!courier.active) {
        res.status(400).json({ message: "Courier is not active" })
        return
      }
    }
    
    // Stamp the creating account as the owner so /store/delivery-batches/[id]
    // writes can be authorized to it. Server-side creation (no auth context)
    // leaves owner null (grandfathered).
    const authContext = (req as any).auth_context as
      | { actor_id?: string; actor_type?: string }
      | undefined

    const batch = await foodDistribution.createDeliveryBatch(
      data.delivery_ids,
      data.courier_id,
      data.is_community_run,
      data.community_org_id,
      { id: authContext?.actor_id ?? null, type: authContext?.actor_type ?? null }
    )
    
    // Get deliveries in batch
    const deliveries = await foodDistribution.listFoodDeliveries({
      batch_id: batch.id,
    })
    
    res.status(201).json({ 
      batch: {
        ...batch,
        deliveries,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
