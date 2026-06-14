import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import SubscriptionModuleService from "../../../../modules/subscription/service"
import { requireSellerId } from "../../../../shared"

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

    const subscription = await subscriptionService.retrieveSubscription(id)

    if (!subscription) {
      res.status(404).json({ message: "Subscription not found" })
      return
    }

    // Verify ownership
    if (subscription.seller_id !== sellerId) {
      res.status(403).json({ message: "Access denied" })
      return
    }

    res.json({ subscription })
  } catch (error) {
    throw error
  }
}
