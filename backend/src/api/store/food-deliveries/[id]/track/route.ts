import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const trackingUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
  accuracy: z.number().min(0).optional(),
})

// ===========================================
// GET /food-deliveries/:id/track
// Live tracking data for a delivery
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const delivery = await foodDistribution.retrieveFoodDelivery(id)
  
  if (!delivery) {
    res.status(404).json({ message: "Delivery not found" })
    return
  }
  
  // Get courier info if assigned
  let courier: any = null
  if (delivery.courier_id) {
    courier = await foodDistribution.retrieveCourier(delivery.courier_id)
  }
  
  // Return tracking data
  res.json({
    delivery_id: id,
    status: delivery.status,
    
    // Current location
    current_location: delivery.last_known_latitude && delivery.last_known_longitude
      ? {
          latitude: delivery.last_known_latitude,
          longitude: delivery.last_known_longitude,
          updated_at: delivery.last_location_update,
        }
      : null,
    
    // Route breadcrumbs
    route_tracking: delivery.route_tracking || [],
    
    // ETA
    estimated_delivery_at: delivery.estimated_delivery_at,
    
    // Pickup info
    pickup: {
      address: delivery.pickup_address,
      latitude: delivery.pickup_latitude,
      longitude: delivery.pickup_longitude,
      arrived_at: delivery.courier_arrived_at_pickup_at,
      picked_up_at: delivery.picked_up_at,
    },
    
    // Delivery destination
    destination: {
      address: delivery.delivery_address,
      latitude: delivery.delivery_latitude,
      longitude: delivery.delivery_longitude,
      arrived_at: delivery.arrived_at_delivery_at,
      delivered_at: delivery.delivered_at,
    },
    
    // Courier info (public only)
    courier: courier
      ? {
          name: courier.first_name,
          vehicle_type: courier.vehicle_type,
          photo_url: courier.photo_url,
        }
      : null,
  })
}

// ===========================================
// POST /food-deliveries/:id/track
// Update tracking data (for courier app)
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = trackingUpdateSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check delivery exists
    const delivery = await foodDistribution.retrieveFoodDelivery(id)
    if (!delivery) {
      res.status(404).json({ message: "Delivery not found" })
      return
    }
    
    // Add location to tracking
    await foodDistribution.trackCourierLocation(
      id,
      data.latitude,
      data.longitude,
      data.speed,
      data.heading
    )
    
    // Also update courier's current location
    if (delivery.courier_id) {
      await foodDistribution.updateCourierLocation(
        delivery.courier_id,
        data.latitude,
        data.longitude
      )
    }
    
    res.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
