import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { actorMayManage, actorOwnsResource } from "../../../../shared/actor-scope"
import {
  actorOwnsCourier,
  forbidden,
} from "../../../../shared/community-read-access"
import {
  publicCourierView,
  redactDeliveries,
} from "../../../../modules/food-distribution/public-view"
import { nullIfNotFound } from "../../../../shared/null-if-not-found"
import { deliveriesActorMayBatch } from "../batchable-deliveries"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateBatchSchema = z.object({
  status: z.enum(["PLANNING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  courier_id: z.string().optional(),
  notes: z.string().max(500).optional(),
  optimized_route: z.array(z.object({
    delivery_id: z.string(),
    sequence: z.number().int().min(1),
    estimated_arrival: z.string().datetime().optional(),
  })).optional(),
})

const addDeliveriesSchema = z.object({
  delivery_ids: z.array(z.string()).min(1).max(10),
})

// ===========================================
// GET /delivery-batches/:id
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // D10-5. A batch is a courier's run: the account that planned it and the
  // courier driving it. Everyone else is refused, and refused identically
  // whether the batch is missing or merely not theirs — batch ids are
  // enumerable and the payload is a list of people's delivery addresses.
  //
  // `nullIfNotFound`: the module's retrieve throws for a missing batch, so
  // read bare it answered 404 where a real batch answered 403, and the
  // `!batch` below was never reached.
  const batch = await nullIfNotFound(foodDistribution.retrieveDeliveryBatch(id))

  // `actorOwnsResource`, not the `actorMayManage` the write verbs below use:
  // that one grandfathers a null `owner_id` so pre-ownership batches stay
  // manageable, which is defensible for a write behind the authenticated
  // prefix matcher and is not defensible for a read of a third party's
  // address. A legacy batch is unreadable until an owner is backfilled.
  if (
    !batch ||
    !(
      actorOwnsResource(req, (batch as { owner_id?: string | null }).owner_id) ||
      (await actorOwnsCourier(req, batch.courier_id))
    )
  ) {
    return forbidden(res)
  }

  // Get deliveries in batch
  const deliveries = await foodDistribution.listFoodDeliveries(
    { batch_id: id },
    { order: { batch_sequence: "ASC" } }
  )
  
  // Get courier info if assigned
  let courier: any = null
  if (batch.courier_id) {
    courier = await foodDistribution.retrieveCourier(batch.courier_id)
  }
  
  res.json({
    batch: {
      ...batch,
      deliveries: redactDeliveries(deliveries as unknown as Record<string, unknown>[]),
      // D10-5. This route is unauthenticated and hand-built a courier
      // object carrying their full legal name and phone number — more than
      // `/food-deliveries/:id/track` gives even to the customer whose
      // delivery is in flight. The same declared public projection applies
      // here; see `publicCourierView`.
      //
      // Who may read a batch at all is now settled above; the projection
      // still applies, because the courier's own phone number is not the
      // planner's to read either.
      courier: courier
        ? publicCourierView(courier as unknown as Record<string, unknown>)
        : null,
    },
  })
}

// ===========================================
// PUT /delivery-batches/:id
//
// The three write verbs below refuse a batch that does not exist exactly as
// they refuse someone else's (SD-107). Each read the batch bare, which throws
// for a missing id, so a signed-in stranger got 404 for a missing batch and
// 403 "This batch is not yours to manage" for a real one.
//
// Two things this verb did beyond the batch itself:
//   - `optimized_route` wrote a sequence and an arrival time onto whatever
//     delivery id each entry named, in this batch or not, and answered 200
//     for a real id and 404 for a missing one. Every entry must now name a
//     delivery in this batch.
//   - `courier_id` decides who else reads the batch: its courier's owner is
//     served every address in it by the GET above.
//
// And on a batch with no owner on record, which `actorMayManage` lets any
// signed-in account write (grandfathered), nothing here tells that account
// about the deliveries in it. The GET above refuses them the batch, and this
// verb was their way round it (each seen on Postgres):
//   - the 200 echoed the batch row, whose `optimized_route` lists the id of
//     every delivery in the run. The row is echoed to the recorded owner
//     only; a write let through on an unknown owner is acknowledged with
//     `{ id, status }`.
//   - a route entry answered 200 for a delivery in the batch and 403 for one
//     outside it, and rewrote the sequence and arrival time of deliveries the
//     caller may not read. Route entries are the recorded owner's.
//   - naming their own courier made them a reader of the run. A courier is
//     assigned by the recorded owner only.
// Status and notes on such a batch, and DELETE, are still theirs to write:
// ending the grandfathering is the operator's call, not made here.
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateBatchSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const existing = await nullIfNotFound(foodDistribution.retrieveDeliveryBatch(id))
    const ownerId = (existing as { owner_id?: string | null } | null)?.owner_id
    if (!existing || !actorMayManage(req, ownerId)) {
      return forbidden(res)
    }
    const isRecordedOwner = actorOwnsResource(req, ownerId)
    if ((data.courier_id || data.optimized_route) && !isRecordedOwner) {
      return forbidden(res)
    }
    if (data.optimized_route) {
      const inBatch = new Set(
        (await foodDistribution.listFoodDeliveries({ batch_id: id }, { select: ["id"] })).map(
          (delivery) => delivery.id
        )
      )
      if (data.optimized_route.some((item) => !inBatch.has(item.delivery_id))) {
        return forbidden(res)
      }
    }

    // Update batch
    const updateData: Record<string, any> = { id }
    
    if (data.status) {
      updateData.status = data.status
      if (data.status === "IN_PROGRESS" && !existing.started_at) {
        updateData.started_at = new Date()
      }
      if (data.status === "COMPLETED" && !existing.completed_at) {
        updateData.completed_at = new Date()
      }
    }
    
    if (data.courier_id) {
      updateData.courier_id = data.courier_id
      updateData.status = "ASSIGNED"
    }
    
    if (data.notes !== undefined) {
      updateData.notes = data.notes
    }
    
    if (data.optimized_route) {
      updateData.optimized_route = data.optimized_route
      
      // Update delivery sequences
      for (const item of data.optimized_route) {
        await foodDistribution.updateFoodDeliveries({
          id: item.delivery_id,
          batch_sequence: item.sequence,
          estimated_delivery_at: item.estimated_arrival ? new Date(item.estimated_arrival) : undefined,
        } as any)
      }
    }
    
    const batch = await foodDistribution.updateDeliveryBatches(updateData)
    
    res.json({
      batch: isRecordedOwner ? batch : { id: batch.id, status: batch.status },
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
// POST /delivery-batches/:id/deliveries
// Add deliveries to batch
//
// Same interim rule as creating a batch: only deliveries the caller may
// already read, a missing one refused as someone else's is, and nothing is
// written until every delivery named has passed (the loop used to write each
// delivery before it looked at the next).
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = addDeliveriesSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const batch = await nullIfNotFound(foodDistribution.retrieveDeliveryBatch(id))
    if (!batch || !actorMayManage(req, (batch as { owner_id?: string | null }).owner_id)) {
      return forbidden(res)
    }

    if (batch.status !== "PLANNING") {
      res.status(400).json({ message: "Can only add deliveries to batches in PLANNING status" })
      return
    }

    const batchable = await deliveriesActorMayBatch(req, foodDistribution, data.delivery_ids)
    if (!batchable) {
      return forbidden(res)
    }
    const taken = batchable.find((delivery) => delivery.batch_id)
    if (taken) {
      res.status(400).json({
        message: `Delivery ${taken.id} is already in a batch`,
      })
      return
    }
    
    // Get current deliveries count
    const existingDeliveries = await foodDistribution.listFoodDeliveries({ batch_id: id })
    let currentSequence = existingDeliveries.length
    
    // Add new deliveries
    for (const delivery of batchable) {
      currentSequence++
      await foodDistribution.updateFoodDeliveries({
        id: delivery.id,
        batch_id: id,
        batch_sequence: currentSequence,
      } as any)
    }
    
    // Update batch total
    await foodDistribution.updateDeliveryBatches({
      id,
      total_deliveries: currentSequence,
    })
    
    res.json({ success: true, total_deliveries: currentSequence })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}

// ===========================================
// DELETE /delivery-batches/:id
// ===========================================

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const batch = await nullIfNotFound(foodDistribution.retrieveDeliveryBatch(id))
  if (!batch || !actorMayManage(req, (batch as { owner_id?: string | null }).owner_id)) {
    return forbidden(res)
  }

  if (batch.status === "IN_PROGRESS") {
    res.status(400).json({ message: "Cannot delete batch that is in progress" })
    return
  }
  
  // Remove deliveries from batch
  const deliveries = await foodDistribution.listFoodDeliveries({ batch_id: id })
  for (const delivery of deliveries) {
    await foodDistribution.updateFoodDeliveries({
      id: delivery.id,
      batch_id: null,
      batch_sequence: null,
    } as any)
  }
  
  // Mark batch as cancelled
  await foodDistribution.updateDeliveryBatches({
    id,
    status: "CANCELLED",
  })
  
  res.json({ success: true, id })
}
