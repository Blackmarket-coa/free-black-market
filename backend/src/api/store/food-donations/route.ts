import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const listDonationsQuerySchema = z.object({
  producer_id: z.string().optional(),
  status: z.string().optional(),
  transaction_type: z.enum(["DONATION", "GIFT", "COMMUNITY_SHARE", "RESCUE", "GLEANING"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

const createDonationSchema = z.object({
  producer_id: z.string(),
  
  // Transaction type (all are free/donation types)
  transaction_type: z.enum(["DONATION", "GIFT", "COMMUNITY_SHARE", "RESCUE", "GLEANING"]).default("DONATION"),
  
  // Recipient info (can be anonymous)
  is_anonymous: z.boolean().default(false),
  recipient_organization: z.string().max(255).optional(),
  recipient_name: z.string().max(255).optional(),
  recipient_contact: z.string().max(255).optional(),
  
  // For food rescue
  food_rescue_source: z.string().max(255).optional(),
  expiration_date: z.string().datetime().optional(),
  
  // Fulfillment
  fulfillment_type: z.enum(["PICKUP", "DELIVERY", "COMMUNITY_POINT"]).default("PICKUP"),
  
  // Delivery address (if delivery)
  delivery_address_line_1: z.string().max(255).optional(),
  delivery_city: z.string().max(100).optional(),
  delivery_state: z.string().max(100).optional(),
  delivery_postal_code: z.string().max(20).optional(),
  delivery_instructions: z.string().max(500).optional(),
  
  // Timing
  requested_time: z.string().datetime().optional(),
  is_asap: z.boolean().default(false),
  
  // Items being donated
  items: z.array(z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    quantity: z.number().int().min(1),
    dietary_info: z.array(z.string()).optional(),
    allergens: z.array(z.string()).optional(),
  })).min(1),
  
  // Notes
  special_instructions: z.string().max(1000).optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

// ===========================================
// GET /food-donations
// List donations and food rescue orders
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listDonationsQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Filter for donation-type transactions only
    const donationTypes = query.transaction_type 
      ? [query.transaction_type]
      : ["DONATION", "GIFT", "COMMUNITY_SHARE", "RESCUE", "GLEANING"]
    
    const filters: Record<string, any> = {
      transaction_type: { $in: donationTypes },
    }
    
    if (query.producer_id) filters.producer_id = query.producer_id
    if (query.status) filters.status = query.status
    
    const orders = await foodDistribution.listFoodOrders(filters, {
      take: query.limit,
      skip: query.offset,
      order: { created_at: "DESC" },
    })
    
    const count = await foodDistribution
      .listFoodOrders(filters, { select: ["id"] })
      .then((o) => o.length)
    
    // Enrich with producer info
    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        const producer = await foodDistribution.retrieveFoodProducer(order.producer_id)
        const items = await foodDistribution.listFoodOrderItems({ order_id: order.id })
        return {
          ...order,
          producer: producer ? {
            id: producer.id,
            name: producer.name,
            producer_type: producer.producer_type,
          } : null,
          items,
        }
      })
    )
    
    res.json({
      donations: enrichedOrders,
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
// POST /food-donations
// Create a donation/food rescue order
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createDonationSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify producer exists
    const producer = await foodDistribution.retrieveFoodProducer(data.producer_id)
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    
    // Verify producer accepts donations (for appropriate types)
    if (data.transaction_type === "DONATION" && !producer.accepts_donations) {
      res.status(400).json({ message: "This producer does not accept donations" })
      return
    }
    
    const { items, ...orderData } = data
    
    // Create order with items (all items are free for donations)
    const { order, items: createdItems } = await foodDistribution.createFoodOrderWithItems(
      {
        ...orderData,
        status: "PENDING",
        subtotal: 0,
        tax: 0,
        delivery_fee: 0,
        tip: 0,
        total: 0,
        requested_time: data.requested_time ? new Date(data.requested_time) : null,
        expiration_date: data.expiration_date ? new Date(data.expiration_date) : null,
      },
      items.map((item) => ({
        ...item,
        unit_price: 0,
        total_price: 0,
      }))
    )
    
    res.status(201).json({
      donation: {
        ...order,
        items: createdItems,
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
