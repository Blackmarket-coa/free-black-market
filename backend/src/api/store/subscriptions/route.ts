import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionInterval, SubscriptionType, SubscriptionStatus } from "../../../modules/subscription/types"
import { createSubscriptionWorkflow } from "../../../workflows/subscription"
import { requireCustomerId, validationError } from "../../../shared"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createSubscriptionSchema = z.object({
  cart_id: z.string().min(1, "Cart ID is required"),
  interval: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]),
  period: z.number().min(1).max(52, "Period must be between 1-52"),
  type: z.enum(["csa_share", "meal_plan", "produce_box", "membership", "custom"]).optional(),
  delivery_day: z.string().optional(),
  delivery_instructions: z.string().max(500).optional(),
})

// ===========================================
// GET /store/subscriptions
// List customer's subscriptions
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
    
    const { status, type } = req.query as { status?: string; type?: string }
    
    const filters: Record<string, any> = { customer_id: customerId }
    if (status) filters.status = status
    if (type) filters.type = type

    const subscriptions = await subscriptionService.listSubscriptions(filters, {
      order: { created_at: "DESC" },
    })

    res.json({
      subscriptions,
      count: subscriptions.length,
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /store/subscriptions
// Create a new subscription from cart
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const data = createSubscriptionSchema.parse(req.body)

    const { result } = await createSubscriptionWorkflow(req.scope).run({
      input: {
        cart_id: data.cart_id,
        subscription_data: {
          interval: data.interval as SubscriptionInterval,
          period: data.period,
          type: data.type as SubscriptionType | undefined,
          delivery_day: data.delivery_day,
          delivery_instructions: data.delivery_instructions,
        }
      }
    })

    res.status(201).json({
      subscription: result.subscription,
      order: result.order,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
