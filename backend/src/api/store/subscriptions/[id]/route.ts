import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import SubscriptionModuleService from "../../../../modules/subscription/service"
import { manageSubscriptionWorkflow } from "../../../../workflows/subscription"
import { requireCustomerId } from "../../../../shared"
import { forbidden } from "../../../../shared/community-read-access"
import {
  isAutoRenewError,
  isSubscriptionTransitionError,
} from "../../../../modules/subscription/errors"
import {
  consumerSubscriptionsEnabled,
  isUntilCanceledForProduct,
} from "../../../../workflows/subscription/grace-lifecycle"

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

/**
 * FF_CONSUMER_SUBSCRIPTIONS_V1 adds two actions:
 *   - `disable_auto_renew`: withdraw the approval; access continues to the end
 *     of the paid period, then the subscription ends;
 *   - `approve_auto_renew`: approve again — an explicit
 *     `auto_renew_approved: true` plus the CURRENT disclosure version.
 * Flag off, the schema above is used unchanged, so these are a 400 as before.
 */
const manageWithAutoRenewSchema = z
  .object({
    action: z.enum(["pause", "resume", "cancel", "disable_auto_renew", "approve_auto_renew"]),
    reason: z.string().max(500).optional(),
    auto_renew_approved: z.literal(true).optional(),
    auto_renew_disclosure_version: z.string().min(1).max(64).optional(),
  })
  .refine(
    (d) =>
      d.action !== "approve_auto_renew" ||
      (d.auto_renew_approved === true && !!d.auto_renew_disclosure_version),
    {
      error:
        "approve_auto_renew requires auto_renew_approved: true and auto_renew_disclosure_version",
      path: ["auto_renew_approved"],
    }
  )

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

    // Auto-renew approval actions (FF_CONSUMER_SUBSCRIPTIONS_V1 only — the
    // flag-off schema cannot produce them). The service guards each write.
    if (data.action === "disable_auto_renew") {
      const subscription = await subscriptionService.withdrawAutoRenew(id)
      res.json({ subscription, action: data.action, success: true })
      return
    }
    if (data.action === "approve_auto_renew") {
      const version =
        "auto_renew_disclosure_version" in data ? data.auto_renew_disclosure_version : undefined
      const subscription = await subscriptionService.approveAutoRenew(id, {
        disclosure_version: version ?? "",
        product_allows_until_canceled: await isUntilCanceledForProduct(
          req.scope,
          existing.product_id
        ),
      })
      res.json({ subscription, action: data.action, success: true })
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
    // Auto-renew approval refused by the service (flag on only).
    if (isAutoRenewError(error)) {
      res.status(409).json({ message: error.message, type: error.code })
      return
    }
    throw error
  }
}
