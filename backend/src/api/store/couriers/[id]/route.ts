import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { CourierStatus } from "../../../../modules/food-distribution/models/courier"
import { actorMayManage, actorOwnsResource } from "../../../../shared/actor-scope"
import {
  actorMayReadDelivery,
  forbidden,
} from "../../../../shared/community-read-access"
import {
  publicCourierView,
  redactDeliveries,
  redactDelivery,
} from "../../../../modules/food-distribution/public-view"
import { retrieveDeliveryOrNull } from "../../../../modules/food-distribution/proof-of-delivery"

/** A delivery the courier is still carrying. */
const ACTIVE_DELIVERY_STATUSES = [
  "ASSIGNED",
  "COURIER_EN_ROUTE_PICKUP",
  "COURIER_ARRIVED_PICKUP",
  "ORDER_PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "ARRIVED_AT_DESTINATION",
  "ATTEMPTING_DELIVERY",
]

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const CourierStatusEnum = z.enum([
  "OFFLINE",
  "AVAILABLE",
  "ON_DELIVERY",
  "ON_BREAK",
  "RETURNING",
])

const updateCourierSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  photo_url: z.string().url().optional(),
  
  // Status
  status: CourierStatusEnum.optional(),
  
  // Vehicle
  vehicle_type: z.enum(["CAR", "BIKE", "EBIKE", "MOTORCYCLE", "SCOOTER", "VAN", "TRUCK", "WALKING"]).optional(),
  vehicle_make: z.string().max(100).optional(),
  vehicle_model: z.string().max(100).optional(),
  vehicle_color: z.string().max(50).optional(),
  vehicle_plate: z.string().max(20).optional(),
  
  // Capacity
  max_deliveries_concurrent: z.number().int().min(1).max(10).optional(),
  has_insulated_bag: z.boolean().optional(),
  has_cold_storage: z.boolean().optional(),
  max_distance_miles: z.number().min(0).max(100).optional(),
  
  // Zone
  service_area: z.array(z.string()).optional(),
  
  // Location update
  current_latitude: z.number().min(-90).max(90).optional(),
  current_longitude: z.number().min(-180).max(180).optional(),
  
  // Active status
  is_active: z.boolean().optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

const claimDeliverySchema = z.object({
  delivery_id: z.string(),
})

// ===========================================
// GET /couriers/:id
// ===========================================

/**
 * Unauthenticated, and therefore projected for anyone but the owner.
 *
 * This used to serialize the `food_courier` row verbatim to any caller —
 * email, phone, live coordinates, licence plate, emergency contact name and
 * phone, documents, background-check status, total earnings and pending
 * payout. D10-5. See `publicCourierView` for the field set and why each
 * field is in or out of it.
 *
 * The owner still gets the whole row: `actorOwnsResource` (not
 * `actorMayManage`, which the write paths below use) because that one
 * grandfathers a null `owner_id`, and a courier created before ownership was
 * stamped must not therefore be readable in full by any signed-in account.
 * On this GET the safe default for an unknown owner is the public view.
 *
 * **The deliveries the courier is carrying are the owner's alone (SD-106).**
 * `active_deliveries` used to sit outside the owner branch, under a comment
 * here that called it "already redacted of the delivery's own secrets".
 * `redactDeliveries` removes the proof PIN and nothing else: each row is the
 * whole `food_delivery`, with the recipient's home address, name, phone and
 * delivery instructions. With `GET /store/couriers` listing every courier id,
 * anyone holding a publishable key could read the address of every delivery
 * that had a courier, which is exactly what `GET /store/food-deliveries/:id`
 * refuses them.
 *
 * Everyone else gets `active_delivery_count`. That is the operational fact a
 * requester asks this endpoint for (is this courier free), and it names no
 * delivery: not an id either, since an id is what the delivery reads and the
 * claim below are keyed on. For a caller who is not the owner only ids are
 * read from the table, so no address is in hand to serialize by mistake.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const courier = await foodDistribution.retrieveCourier(id)
  
  if (!courier) {
    res.status(404).json({ message: "Courier not found" })
    return
  }
  
  const row = courier as unknown as Record<string, unknown>
  const isOwner = actorOwnsResource(req, row.owner_id as string | null | undefined)

  // The deliveries this courier is carrying: rows for the owner, a count for
  // everyone else.
  const activeDeliveries = await foodDistribution.listFoodDeliveries(
    { courier_id: id, status: { $in: ACTIVE_DELIVERY_STATUSES } },
    isOwner ? {} : { select: ["id"] }
  )

  res.json({
    courier: {
      ...(isOwner ? row : publicCourierView(row)),
      active_delivery_count: activeDeliveries.length,
      ...(isOwner
        ? {
            active_deliveries: redactDeliveries(
              activeDeliveries as unknown as Record<string, unknown>[]
            ),
          }
        : {}),
    },
  })
}

// ===========================================
// PUT /couriers/:id
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateCourierSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check courier exists
    const existing = await foodDistribution.retrieveCourier(id)
    if (!existing) {
      res.status(404).json({ message: "Courier not found" })
      return
    }
    if (!actorMayManage(req, (existing as any).owner_id)) {
      res.status(403).json({ message: "This courier is not yours to manage" })
      return
    }

    // Handle location update specially
    if (data.current_latitude && data.current_longitude) {
      await foodDistribution.updateCourierLocation(
        id,
        data.current_latitude,
        data.current_longitude
      )
    }
    
    const courier = await foodDistribution.updateCouriers({
      id,
      ...data,
    } as any)
    
    // The whole row is echoed to the courier's recorded owner only.
    // `actorMayManage` above lets any signed-in account write a courier with
    // no owner on record (grandfathered), and this response was that
    // account's read of the row: email, phone, emergency contact. A write
    // that is let through on an unknown owner is acknowledged with the same
    // projection GET gives a stranger.
    const updated = courier as unknown as Record<string, unknown>
    res.json({
      courier: actorOwnsResource(req, (existing as { owner_id?: string | null }).owner_id)
        ? updated
        : publicCourierView(updated),
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
// POST /couriers/:id/claim
// Claim a delivery assignment
//
// A delivery that cannot be claimed is refused one way, whether it does not
// exist or is no longer pending (SD-107). The bare `retrieveFoodDelivery`
// throws for a missing id, so the pair was 404 against 400 "Delivery is not
// available for claiming", and any account that had registered a courier
// could tell which delivery ids are real. Only someone who may already read
// the delivery (its courier claiming twice, say) is told it is not available.
//
// The 200 is redacted like every other delivery response. It carried
// `proof_pin_code`: the PIN the recipient reads out to prove the hand-over,
// handed to the courier at the moment of claiming.
//
// Not decided here: WHO may claim. Any signed-in account can register a
// courier, mark it AVAILABLE and claim a pending delivery whose id it holds,
// and from then on reads it as its courier. That is the operator's ruling
// (verified couriers only, the producer's own, anyone), not a default.
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = claimDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check courier exists and is available
    const courier = await foodDistribution.retrieveCourier(id)
    if (!courier) {
      res.status(404).json({ message: "Courier not found" })
      return
    }
    if (!actorMayManage(req, (courier as any).owner_id)) {
      res.status(403).json({ message: "This courier is not yours to manage" })
      return
    }
    if (courier.status !== "AVAILABLE") {
      res.status(400).json({ message: "Courier is not available" })
      return
    }
    if (!courier.active) {
      res.status(400).json({ message: "Courier account is not active" })
      return
    }
    
    // Check delivery is available
    const delivery = await retrieveDeliveryOrNull(foodDistribution, data.delivery_id)
    if (!delivery || delivery.status !== "PENDING") {
      if (delivery && (await actorMayReadDelivery(req, delivery))) {
        res.status(400).json({ message: "Delivery is not available for claiming" })
        return
      }
      return forbidden(res)
    }
    
    // Assign courier to delivery
    const updatedDelivery = await foodDistribution.assignCourierToDelivery(
      data.delivery_id,
      id
    )
    
    res.json({
      delivery: redactDelivery(updatedDelivery as unknown as Record<string, unknown>),
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
// DELETE /couriers/:id
// ===========================================

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Check courier exists
  const existing = await foodDistribution.retrieveCourier(id)
  if (!existing) {
    res.status(404).json({ message: "Courier not found" })
    return
  }
  if (!actorMayManage(req, (existing as any).owner_id)) {
    res.status(403).json({ message: "This courier is not yours to manage" })
    return
  }

  // Check no active deliveries
  const activeDeliveries = await foodDistribution.listFoodDeliveries({
    courier_id: id,
    status: { $in: ["ASSIGNED", "COURIER_EN_ROUTE_PICKUP", "COURIER_ARRIVED_PICKUP", "ORDER_PICKED_UP", "EN_ROUTE_DELIVERY"] },
  })
  
  if (activeDeliveries.length > 0) {
    res.status(400).json({ message: "Cannot deactivate courier with active deliveries" })
    return
  }
  
  // Soft delete
  await foodDistribution.updateCouriers({
    id,
    active: false,
    status: CourierStatus.OFFLINE,
  } as any)
  
  res.json({ success: true, id })
}
