import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { OperatingStatus } from "../../../../modules/food-distribution/models/food-producer"
import { actorMayManage, actorOwnsResource } from "../../../../shared/actor-scope"
import {
  producerEchoFor,
  producerProfileIsPublic,
  publicProducerView,
} from "../../../../modules/food-distribution/public-view"
import { actorIsAnyOf } from "../../../../shared/community-read-access"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateProducerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  
  // Contact
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  
  // Address
  address_line_1: z.string().max(255).optional(),
  address_line_2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country_code: z.string().length(2).optional(),
  
  // Geo
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  
  // Operating hours
  operating_hours: z.record(z.string(), z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  
  // Status
  is_active: z.boolean().optional(),
  is_open: z.boolean().optional(),
  
  // Capabilities
  accepts_donations: z.boolean().optional(),
  accepts_trades: z.boolean().optional(),
  offers_delivery: z.boolean().optional(),
  offers_pickup: z.boolean().optional(),
  offers_dine_in: z.boolean().optional(),
  
  // Delivery settings
  delivery_radius_miles: z.number().min(0).max(100).optional(),
  minimum_order_amount: z.number().min(0).optional(),
  delivery_fee: z.number().min(0).optional(),
  estimated_prep_time_minutes: z.number().min(0).max(240).optional(),
  
  // Licensing
  license_type: z.string().max(100).optional(),
  license_number: z.string().max(100).optional(),
  license_expiry: z.string().datetime().optional(),
  health_permit_number: z.string().max(100).optional(),
  
  // Dietary options
  dietary_options: z.array(z.string()).optional(),
  cuisine_types: z.array(z.string()).optional(),
  
  // Payment
  accepts_ebt: z.boolean().optional(),
  accepts_snap: z.boolean().optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

// ===========================================
// GET /food-producers/:id
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  try {
    const producer = await foodDistribution.retrieveFoodProducer(id)
    
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    
    const row = producer as unknown as Record<string, unknown>
    const owner = actorIsAnyOf(req, row.owner_id as string | null)

    // A profile switched off answers exactly as an id that does not exist
    // (the error `retrieveFoodProducer` raises for one), so the answer does
    // not say which it is.
    if (!owner && !producerProfileIsPublic(row)) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `FoodProducer with id: ${id} was not found`)
    }

    // Check if currently open
    const isOpen = await foodDistribution.isProducerOpen(id)

    res.json({
      producer: {
        // The account that manages the producer reads its row whole; anyone
        // else the public listing, with `hide_address` honoured.
        ...(owner ? row : publicProducerView(row)),
        is_currently_open: isOpen,
      },
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// PUT /food-producers/:id
//
// The row is echoed whole to the producer's recorded owner only. The GET
// above keeps a producer's street lines and coordinates back when
// `hide_address` is set (a cottage-food producer working from home), for
// every caller. This echo did not, and `actorMayManage` lets any signed-in
// account write a producer with no owner on record (grandfathered): an empty
// PUT from such an account answered with the address the GET had just kept
// from it (seen on Postgres, SD-110 follow-up). `hide_address` is not in the
// update schema, so such an account cannot clear the flag and read the
// address off the GET: the echo was its way to it. A write let through on an
// unknown owner is acknowledged with what the GET serves, as the courier PUT
// acknowledges one with the public projection.
//
// What the GET serves a non-owner is the public view (SD-118): no contact
// email or phones, licences, verification notes, owner or ledger account, and
// for a profile switched off, nothing (it answers as a missing id). The echo
// follows it through `producerEchoFor`, so the two cannot drift apart.
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateProducerSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check producer exists
    const existing = await foodDistribution.retrieveFoodProducer(id)
    if (!existing) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    if (!actorMayManage(req, (existing as any).owner_id)) {
      res.status(403).json({ message: "This producer is not yours to manage" })
      return
    }

    const producer = await foodDistribution.updateFoodProducers({
      id,
      ...data,
    } as any)
    
    const updated = producer as unknown as Record<string, unknown>
    res.json({
      producer: producerEchoFor(
        updated,
        actorOwnsResource(req, (existing as { owner_id?: string | null }).owner_id)
      ),
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
// DELETE /food-producers/:id
// ===========================================

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Check producer exists
  const existing = await foodDistribution.retrieveFoodProducer(id)
  if (!existing) {
    res.status(404).json({ message: "Producer not found" })
    return
  }
  if (!actorMayManage(req, (existing as any).owner_id)) {
    res.status(403).json({ message: "This producer is not yours to manage" })
    return
  }

  // Soft delete by deactivating
  await foodDistribution.updateFoodProducers({
    id,
    operating_status: OperatingStatus.CLOSED,
  } as any)
  
  res.status(200).json({ success: true, id })
}
