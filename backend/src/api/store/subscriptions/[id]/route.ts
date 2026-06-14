import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import SubscriptionModuleService from "../../../../modules/subscription/service"
import { manageSubscriptionWorkflow } from "../../../../workflows/subscription"
import { requireCustomerId } from "../../../../shared"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateSubscriptionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
  reason: z.string().max(500).optional(),
})

// ===========================================
// GET /store/subscriptions/:id
// Get subscription details
// ===========================================

export async function GET(
  req: AuthenticatedMedusaRequest<never, { id: string }>,
  res: MedusaResponse
) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const { id } = req.params
    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)

    const subscription = await subscriptionService.retrieveSubscription(id)

    if (!subscription) {
      res.status(404).json({ message: "Subscription not found" })
      return
    }

    // Verify ownership
    if (subscription.customer_id !== customerId) {
      res.status(403).json({ message: "Access denied" })
      return
    }

    res.json({ subscription })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /store/subscriptions/:id
// Manage subscription (pause, resume, cancel)
// ===========================================

export async function POST(
  req: AuthenticatedMedusaRequest<{ action: string; reason?: string }, { id: string }>,
  res: MedusaResponse
) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const { id } = req.params
    const data = updateSubscriptionSchema.parse(req.body)
    
    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)

    // Verify ownership
    const existing = await subscriptionService.retrieveSubscription(id)
    if (!existing) {
      res.status(404).json({ message: "Subscription not found" })
      return
    }
    if (existing.customer_id !== customerId) {
      res.status(403).json({ message: "Access denied" })
      return
    }

    // Execute management workflow
    const { result } = await manageSubscriptionWorkflow(req.scope).run({
      input: {
        subscription_id: id,
        action: data.action as "pause" | "resume" | "cancel",
        reason: data.reason,
      }
    })

    res.json({
      subscription: result.subscription,
      action: result.action,
      success: result.success,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
