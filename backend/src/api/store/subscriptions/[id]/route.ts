import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import SubscriptionModuleService from "../../../../modules/subscription/service"
import { requireCustomerId } from "../../../../shared"
import { forbidden } from "../../../../shared/community-read-access"
import { consumerSubscriptionsEnabled } from "../../../../workflows/subscription/grace-lifecycle"
import {
  dispatchSubscriptionAction,
  manageWithAutoRenewSchema,
  subscriptionActionErrorResponse,
  updateSubscriptionSchema,
} from "../../../../lib/subscription-manage"

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

// Validation schemas and the action dispatch live in lib/subscription-manage.ts,
// shared with the Blackout subscription manage page so both run the same
// service guards and answer with the same refusal codes.

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
    const data = consumerSubscriptionsEnabled()
      ? manageWithAutoRenewSchema.parse(req.body)
      : updateSubscriptionSchema.parse(req.body)
    
    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)

    // Verify ownership — missing and not-owned are the same 403.
    const existing = await ownedSubscription(subscriptionService, id, customerId)
    if (!existing) {
      forbidden(res)
      return
    }

    const result = await dispatchSubscriptionAction(req.scope, existing, data)
    res.json({
      subscription: result.subscription,
      action: result.action,
      success: result.success,
    })
  } catch (error) {
    const refusal = subscriptionActionErrorResponse(error)
    if (refusal) {
      res.status(refusal.status).json(refusal.body)
      return
    }
    throw error
  }
}
