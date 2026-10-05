import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import SubscriptionModuleService from "../../../../modules/subscription/service"
import { manageSubscriptionWorkflow } from "../../../../workflows/subscription"
import { requireCustomerId } from "../../../../shared"
import { forbidden } from "../../../../shared/community-read-access"
import { isSubscriptionTransitionError } from "../../../../modules/subscription/errors"

/**
 * The subscription when it exists AND belongs to the caller; null otherwise.
 * `listSubscriptions` rather than `retrieveSubscription`, which throws on a
 * missing id — so missing and not-owned reach the same `forbidden()` (A2: no
 * 404/403 split, which would map the id space).
 */
async function ownedSubscription(
  service: SubscriptionModuleService,
  id: string,
  customerId: string
) {
  const [subscription] = await service.listSubscriptions({ id }, { take: 1 })
  if (!subscription || subscription.customer_id !== customerId) return null
  return subscription
}

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

    const subscription = await ownedSubscription(subscriptionService, id, customerId)
    if (!subscription) {
      forbidden(res)
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

    // Verify ownership — missing and not-owned are the same 403.
    const existing = await ownedSubscription(subscriptionService, id, customerId)
    if (!existing) {
      forbidden(res)
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
    // A3: e.g. resume of a subscription that is not paused. The service
    // refuses the write; the caller gets a 409 with the reason.
    if (isSubscriptionTransitionError(error)) {
      res.status(409).json({
        message: error.message,
        type: "subscription_transition_not_allowed",
      })
      return
    }
    throw error
  }
}
