import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { actingCustomerId } from "../../../../../shared/actor-scope"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"
import { OperatingStatus } from "../../../../../modules/food-distribution/models/food-producer"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const TransactionTypeEnum = z.enum([
  "SALE",
  "PREPAID",
  "DONATION",
  "TRADE",
  "GIFT",
  "COMMUNITY_SHARE",
  "RESCUE",
  "GLEANING",
])

const FulfillmentTypeEnum = z.enum([
  "PICKUP",
  "DELIVERY",
  "DINE_IN",
  "CURBSIDE",
  "LOCKER",
  "COMMUNITY_POINT",
])

const createOrderItemSchema = z.object({
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  quantity: z.number().int().min(1),
  unit_price: z.number().min(0).default(0),
  special_instructions: z.string().max(500).optional(),
  dietary_info: z.array(z.string()).optional(),
  allergens: z.array(z.string()).optional(),
})

const createOrderSchema = z.object({
  transaction_type: TransactionTypeEnum,
  fulfillment_type: FulfillmentTypeEnum,
  
  // Customer info
  customer_id: z.string().optional(),
  customer_name: z.string().max(255).optional(),
  customer_email: z.string().email().optional(),
  customer_phone: z.string().max(20).optional(),
  
  // For donations - can be anonymous
  is_anonymous: z.boolean().optional(),
  recipient_organization: z.string().max(255).optional(),
  
  // For trades
  trade_offer_description: z.string().max(1000).optional(),
  trade_offer_value: z.number().min(0).optional(),
  
  // For food rescue
  food_rescue_source: z.string().max(255).optional(),
  expiration_date: z.string().datetime().optional(),
  
  // Delivery address
  delivery_address_line_1: z.string().max(255).optional(),
  delivery_address_line_2: z.string().max(255).optional(),
  delivery_city: z.string().max(100).optional(),
  delivery_state: z.string().max(100).optional(),
  delivery_postal_code: z.string().max(20).optional(),
  delivery_country_code: z.string().length(2).optional(),
  delivery_latitude: z.number().min(-90).max(90).optional(),
  delivery_longitude: z.number().min(-180).max(180).optional(),
  delivery_instructions: z.string().max(500).optional(),
  
  // Timing
  requested_time: z.string().datetime().optional(),
  is_asap: z.boolean().optional(),
  
  // Payment
  payment_method: z.string().optional(),
  hawala_transaction_id: z.string().optional(),
  
  // Items
  items: z.array(createOrderItemSchema).min(1),
  
  // Notes
  special_instructions: z.string().max(1000).optional(),
  dietary_restrictions: z.array(z.string()).optional(),
  allergen_notes: z.string().max(500).optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

const listOrdersQuerySchema = z.object({
  status: z.string().optional(),
  transaction_type: TransactionTypeEnum.optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /food-producers/:id/orders
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: producerId } = req.params
  
  try {
    const query = listOrdersQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify producer exists
    const producer = await foodDistribution.retrieveFoodProducer(producerId)
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    
    const [orders, count] = await Promise.all([
      foodDistribution.getProducerOrders(producerId, query.status, {
        take: query.limit,
        skip: query.offset,
      }),
      foodDistribution.listFoodOrders({
        producer_id: producerId,
        ...(query.status && { status: query.status }),
      }).then((o) => o.length),
    ])
    
    res.json({
      orders,
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
// POST /food-producers/:id/orders
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: producerId } = req.params
  
  try {
    const data = createOrderSchema.parse(req.body)

    // SEC: for a logged-in customer, bind the order to the authenticated actor
    // so one customer cannot place an order under another customer's id. Guest
    // orders (no acting customer) keep the body value so anonymous orders work.
    const actingCustomer = actingCustomerId(req)
    if (actingCustomer) {
      data.customer_id = actingCustomer
    }
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify producer exists and is active
    const producer = await foodDistribution.retrieveFoodProducer(producerId)
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    if (producer.operating_status !== OperatingStatus.ACCEPTING_ORDERS) {
      res.status(400).json({ message: "Producer is not currently active" })
      return
    }
    
    // Validate transaction type against producer capabilities
    if (data.transaction_type === "DONATION" && !producer.accepts_donations) {
      res.status(400).json({ message: "This producer does not accept donations" })
      return
    }
    if (data.transaction_type === "TRADE" && !producer.accepts_trades) {
      res.status(400).json({ message: "This producer does not accept trades" })
      return
    }
    
    // Validate fulfillment type
    if (data.fulfillment_type === "DELIVERY" && !producer.offers_delivery) {
      res.status(400).json({ message: "This producer does not offer delivery" })
      return
    }
    if (data.fulfillment_type === "PICKUP" && !producer.offers_pickup) {
      res.status(400).json({ message: "This producer does not offer pickup" })
      return
    }
    // Note: DINE_IN and other fulfillment types are accepted by default as metadata
    
    // Calculate totals
    const { items, ...orderData } = data
    const subtotal = items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0)
    const deliveryFee = data.fulfillment_type === "DELIVERY" ? (Number(producer.delivery_fee) || 0) : 0
    const total = subtotal + deliveryFee
    
    // Create order with items
    const { order, items: createdItems } = await foodDistribution.createFoodOrderWithItems(
      {
        ...orderData,
        producer_id: producerId,
        status: "PENDING",
        subtotal,
        delivery_fee: deliveryFee,
        total,
        requested_time: data.requested_time ? new Date(data.requested_time) : null,
        estimated_prep_time_minutes: producer.estimated_prep_time_minutes || 30,
      },
      items.map((item) => ({
        ...item,
        total_price: item.unit_price * item.quantity,
      }))
    )
    
    res.status(201).json({
      order: {
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
