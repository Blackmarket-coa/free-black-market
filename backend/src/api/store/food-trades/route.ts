import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const listTradesQuerySchema = z.object({
  producer_id: z.string().optional(),
  status: z.string().optional(),
  trade_accepted: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

const createTradeSchema = z.object({
  producer_id: z.string(),
  
  // Customer info
  customer_name: z.string().max(255),
  customer_email: z.string().email().optional(),
  customer_phone: z.string().max(20).optional(),
  
  // Trade offer (what customer is offering in exchange)
  trade_offer_description: z.string().min(1).max(1000),
  trade_offer_value: z.number().min(0).optional(),
  trade_offer_items: z.array(z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    quantity: z.number().int().min(1),
    estimated_value: z.number().min(0).optional(),
  })).optional(),
  
  // What customer wants from producer
  items: z.array(z.object({
    product_id: z.string().optional(),
    variant_id: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    quantity: z.number().int().min(1),
    estimated_value: z.number().min(0).optional(),
  })).min(1),
  
  // Fulfillment
  fulfillment_type: z.enum(["PICKUP", "DELIVERY"]).default("PICKUP"),
  
  // Delivery address (if delivery)
  delivery_address_line_1: z.string().max(255).optional(),
  delivery_city: z.string().max(100).optional(),
  delivery_state: z.string().max(100).optional(),
  delivery_postal_code: z.string().max(20).optional(),
  
  // Notes
  special_instructions: z.string().max(1000).optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

const _respondToTradeSchema = z.object({
  accepted: z.boolean(),
  counter_offer: z.string().max(1000).optional(),
  producer_notes: z.string().max(500).optional(),
})

// ===========================================
// GET /food-trades
// List trade offers
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listTradesQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {
      transaction_type: "TRADE",
    }
    
    if (query.producer_id) filters.producer_id = query.producer_id
    if (query.status) filters.status = query.status
    if (query.trade_accepted !== undefined) filters.trade_accepted = query.trade_accepted
    
    const orders = await foodDistribution.listFoodOrders(filters, {
      take: query.limit,
      skip: query.offset,
      order: { created_at: "DESC" },
    })
    
    const count = await foodDistribution
      .listFoodOrders(filters, { select: ["id"] })
      .then((o) => o.length)
    
    // Enrich with producer and items
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
      trades: enrichedOrders,
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
// POST /food-trades
// Create a trade offer
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createTradeSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify producer exists and accepts trades
    const producer = await foodDistribution.retrieveFoodProducer(data.producer_id)
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    if (!producer.accepts_trades) {
      res.status(400).json({ message: "This producer does not accept trades" })
      return
    }
    
    const { items, trade_offer_items, ...orderData } = data
    
    // Create order with items
    const { order, items: createdItems } = await foodDistribution.createFoodOrderWithItems(
      {
        ...orderData,
        transaction_type: "TRADE",
        status: "PENDING",
        subtotal: 0,
        tax: 0,
        delivery_fee: 0,
        tip: 0,
        total: 0,
        // Store trade offer items in metadata
        metadata: {
          ...data.metadata,
          trade_offer_items: trade_offer_items,
        },
      },
      items.map((item) => ({
        ...item,
        unit_price: item.estimated_value || 0,
        total_price: (item.estimated_value || 0) * item.quantity,
      }))
    )
    
    res.status(201).json({
      trade: {
        ...order,
        items: createdItems,
        trade_offer_items,
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
