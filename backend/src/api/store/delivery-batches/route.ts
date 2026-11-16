import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import {
  actorId,
  actorOwnsCourier,
  forbidden,
} from "../../../shared/community-read-access"
import { redactDeliveries } from "../../../modules/food-distribution/public-view"
import { deliveriesActorMayBatch } from "./batchable-deliveries"

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

/**
 * The caller's own batches: the ones they planned, or, when they name a
 * courier they own, that courier's runs. The same two principals
 * `GET /store/delivery-batches/:id` serves, and nobody else (SD-107).
 *
 * This listed every batch to a caller with no account. A batch row names its
 * planner (`owner_id`), its courier, and in `optimized_route` the id and
 * arrival time of every delivery in it, so the per-batch refusal next door
 * told a stranger nothing this list had not already.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listBatchesQuerySchema.parse(req.query)

    const actor = actorId(req)
    if (!actor) {
      return forbidden(res)
    }
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {}
    if (query.status) filters.status = query.status
    if (query.courier_id) filters.courier_id = query.courier_id
    if (query.is_community_run !== undefined) filters.is_community_run = query.is_community_run
    // A courier's own runs whoever planned them; otherwise only what the
    // caller planned (a `courier_id` they do not own narrows that, no more).
    if (!(query.courier_id && (await actorOwnsCourier(req, query.courier_id)))) {
      filters.owner_id = actor
    }
    
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
//
// Only deliveries the caller may already read (`deliveriesActorMayBatch`,
// the interim rule; who may batch a delivery is still the operator's
// ruling). A delivery that does not exist and someone else's are refused
// alike. The 201 is redacted like every other delivery response: it returned
// each delivery whole, proof PIN included.
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createBatchSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Every delivery must be one the caller may already read. Only then is
    // the caller told that one of them is taken.
    const batchable = await deliveriesActorMayBatch(req, foodDistribution, data.delivery_ids)
    if (!batchable) {
      return forbidden(res)
    }
    const taken = batchable.find((delivery) => delivery.batch_id)
    if (taken) {
      res.status(400).json({
        message: `Delivery ${taken.id} is already part of a batch`,
      })
      return
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
        deliveries: redactDeliveries(deliveries as unknown as Record<string, unknown>[]),
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
