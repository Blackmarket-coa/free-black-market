import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import SubscriptionModuleService from "../../../../modules/subscription/service"
import { requireSellerId } from "../../../../shared"
import { forbidden } from "../../../../shared/community-read-access"

// ===========================================
// GET /vendor/subscriptions/:id
// Get subscription details (vendor view)
// ===========================================

export async function GET(
  req: AuthenticatedMedusaRequest<never, { id: string }>,
  res: MedusaResponse
) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const { id } = req.params
    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)

    // `listSubscriptions`, not `retrieveSubscription` (which throws a 404 on a
    // missing id): missing and another seller's subscription get the same
    // forbidden() 403, so the response is not an existence oracle over ids.
    const [subscription] = await subscriptionService.listSubscriptions({ id }, { take: 1 })
    if (!subscription || subscription.seller_id !== sellerId) {
      forbidden(res)
      return
    }

    res.json({ subscription })
  } catch (error) {
    throw error
  }
}
