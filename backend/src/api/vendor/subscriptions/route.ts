import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../shared"

// ===========================================
// GET /vendor/subscriptions
// List subscriptions for vendor's products
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
    const queryService = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Get seller's products
    const { data: sellerData } = await queryService.graph({
      entity: "seller",
      filters: { id: sellerId },
      fields: ["id", "products.id"],
    })

    if (!sellerData.length) {
      res.json({ subscriptions: [], count: 0 })
      return
    }

    const productIds = sellerData[0].products?.map((p) => p?.id) || []

    if (!productIds.length) {
      res.json({ subscriptions: [], count: 0 })
      return
    }

    const { status, type } = req.query as { status?: string; type?: string }
    
    const filters: Record<string, unknown> = { 
      seller_id: sellerId 
    }
    if (status) filters.status = status
    if (type) filters.type = type

    const subscriptions = await subscriptionService.listSubscriptions(filters, {
      order: { created_at: "DESC" },
    })

    // Group by status for summary
    const summary = {
      active: subscriptions.filter(s => s.status === "active").length,
      paused: subscriptions.filter(s => s.status === "paused").length,
      canceled: subscriptions.filter(s => s.status === "canceled").length,
      expired: subscriptions.filter(s => s.status === "expired").length,
    }

    res.json({
      subscriptions,
      count: subscriptions.length,
      summary,
    })
  } catch (error) {
    throw error
  }
}
