import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { actorMayManage } from "../../../../shared/actor-scope"

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
  
  const batch = await foodDistribution.retrieveDeliveryBatch(id)
  
  if (!batch) {
    res.status(404).json({ message: "Batch not found" })
    return
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
      deliveries,
      courier: courier ? {
        id: courier.id,
        name: `${courier.first_name} ${courier.last_name}`,
        phone: courier.phone,
        vehicle_type: courier.vehicle_type,
      } : null,
    },
  })
}

// ===========================================
// PUT /delivery-batches/:id
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateBatchSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check batch exists
    const existing = await foodDistribution.retrieveDeliveryBatch(id)
    if (!existing) {
      res.status(404).json({ message: "Batch not found" })
      return
    }
    if (!actorMayManage(req, (existing as any).owner_id)) {
      res.status(403).json({ message: "This batch is not yours to manage" })
      return
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
    
    res.json({ batch })
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
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = addDeliveriesSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check batch exists
    const batch = await foodDistribution.retrieveDeliveryBatch(id)
    if (!batch) {
      res.status(404).json({ message: "Batch not found" })
      return
    }
    if (!actorMayManage(req, (batch as any).owner_id)) {
      res.status(403).json({ message: "This batch is not yours to manage" })
      return
    }

    if (batch.status !== "PLANNING") {
      res.status(400).json({ message: "Can only add deliveries to batches in PLANNING status" })
      return
    }
    
    // Get current deliveries count
    const existingDeliveries = await foodDistribution.listFoodDeliveries({ batch_id: id })
    let currentSequence = existingDeliveries.length
    
    // Add new deliveries
    for (const deliveryId of data.delivery_ids) {
      const delivery = await foodDistribution.retrieveFoodDelivery(deliveryId)
      if (!delivery) {
        res.status(404).json({ message: `Delivery ${deliveryId} not found` })
        return
      }
      if (delivery.batch_id) {
        res.status(400).json({ 
          message: `Delivery ${deliveryId} is already in a batch` 
        })
        return
      }
      
      currentSequence++
      await foodDistribution.updateFoodDeliveries({
        id: deliveryId,
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
  
  // Check batch exists
  const batch = await foodDistribution.retrieveDeliveryBatch(id)
  if (!batch) {
    res.status(404).json({ message: "Batch not found" })
    return
  }
  if (!actorMayManage(req, (batch as any).owner_id)) {
    res.status(403).json({ message: "This batch is not yours to manage" })
    return
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
