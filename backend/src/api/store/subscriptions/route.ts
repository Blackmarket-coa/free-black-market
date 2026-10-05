import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionInterval, SubscriptionType } from "../../../modules/subscription/types"
import { createSubscriptionWorkflow } from "../../../workflows/subscription"
import { requireCustomerId } from "../../../shared"
import { forbidden } from "../../../shared/community-read-access"

/**
 * The cart's owner, or null when the cart does not exist or the lookup
 * fails. A failure denies rather than admits.
 */
async function cartCustomerId(
  req: AuthenticatedMedusaRequest,
  cartId: string
): Promise<string | null> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "customer_id"],
      filters: { id: cartId },
    })
    const cart = (data as Array<{ customer_id?: string | null }>)[0]
    return cart?.customer_id ?? null
  } catch {
    return null
  }
}

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

    // A1: the cart must be the caller's own. Previously any cart id was
    // completed, and the subscription (and the order, and the charge) then
    // belonged to whoever owned that cart. Missing cart and someone else's
    // cart get the same 403 — one code, so cart ids cannot be probed.
    if ((await cartCustomerId(req, data.cart_id)) !== customerId) {
      forbidden(res)
      return
    }

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
