import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/store/food-deliveries/[id]/subscribe")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"

/**
 * SSE Endpoint for real-time delivery tracking
 * 
 * Clients can subscribe to delivery updates and receive real-time
 * status changes, location updates, and ETA changes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: deliveryId } = req.params

  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

  // Verify delivery exists
  const delivery = await foodDistribution.retrieveFoodDelivery(deliveryId)
  if (!delivery) {
    res.status(404).json({ message: "Delivery not found" })
    return
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no") // Disable nginx buffering

  // Send initial delivery state
  const initialData = {
    type: "initial",
    delivery_id: deliveryId,
    status: delivery.status,
    courier_id: delivery.courier_id,
    current_location: delivery.last_known_latitude && delivery.last_known_longitude
      ? {
          latitude: delivery.last_known_latitude,
          longitude: delivery.last_known_longitude,
          updated_at: delivery.last_location_update,
        }
      : null,
    estimated_delivery_at: delivery.estimated_delivery_at,
    pickup: {
      address: delivery.pickup_address,
      arrived_at: delivery.courier_arrived_at_pickup_at,
      picked_up_at: delivery.picked_up_at,
    },
    destination: {
      address: delivery.delivery_address,
      arrived_at: delivery.arrived_at_delivery_at,
      delivered_at: delivery.delivered_at,
    },
  }

  res.write(`data: ${JSON.stringify(initialData)}\n\n`)

  // Polling interval for updates (in production, use pub/sub)
  let lastStatus = delivery.status
  let lastLocationUpdate = delivery.last_location_update

  const pollInterval = setInterval(async () => {
    try {
      const currentDelivery = await foodDistribution.retrieveFoodDelivery(deliveryId)
      if (!currentDelivery) {
        clearInterval(pollInterval)
        res.write(`data: ${JSON.stringify({ type: "error", message: "Delivery not found" })}\n\n`)
        res.end()
        return
      }

      // Check for status change
      if (currentDelivery.status !== lastStatus) {
        const statusUpdate = {
          type: "status_change",
          delivery_id: deliveryId,
          previous_status: lastStatus,
          new_status: currentDelivery.status,
          timestamp: new Date().toISOString(),
        }
        res.write(`data: ${JSON.stringify(statusUpdate)}\n\n`)
        lastStatus = currentDelivery.status

        // End stream if delivery is complete or cancelled
        if (["DELIVERED", "CANCELLED", "RETURNED_TO_PRODUCER"].includes(currentDelivery.status)) {
          clearInterval(pollInterval)
          res.write(`data: ${JSON.stringify({ type: "complete", status: currentDelivery.status })}\n\n`)
          res.end()
          return
        }
      }

      // Check for location update
      if (
        currentDelivery.last_location_update &&
        (!lastLocationUpdate || 
          new Date(currentDelivery.last_location_update) > new Date(lastLocationUpdate))
      ) {
        const locationUpdate = {
          type: "location_update",
          delivery_id: deliveryId,
          location: {
            latitude: currentDelivery.last_known_latitude,
            longitude: currentDelivery.last_known_longitude,
          },
          timestamp: currentDelivery.last_location_update,
        }
        res.write(`data: ${JSON.stringify(locationUpdate)}\n\n`)
        lastLocationUpdate = currentDelivery.last_location_update
      }

      // Send heartbeat to keep connection alive
      res.write(`: heartbeat\n\n`)
    } catch (error) {
      log.error("SSE polling error:", error)
    }
  }, 3000) // Poll every 3 seconds

  // Handle client disconnect
  req.on("close", () => {
    clearInterval(pollInterval)
    res.end()
  })

  // Handle errors
  req.on("error", () => {
    clearInterval(pollInterval)
    res.end()
  })
}
