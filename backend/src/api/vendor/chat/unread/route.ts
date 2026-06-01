import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { getMatrixService } from "../../../../shared/matrix-service"

type SellerModuleLike = {
  retrieveSeller: (
    sellerId: string,
    options?: { relations?: string[] }
  ) => Promise<{
    handle?: string | null
    members?: Array<{ email?: string | null }>
  } | null>
}

/**
 * GET /vendor/chat/unread
 * Returns the authenticated vendor's total unread Matrix notification count.
 * Best-effort: returns { unread_count: 0 } on any missing config / failure.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const matrixService = getMatrixService()
  if (!matrixService) {
    res.status(200).json({ unread_count: 0 })
    return
  }

  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const sellerService = req.scope.resolve(SELLER_MODULE) as SellerModuleLike
    const seller = await sellerService.retrieveSeller(sellerId, {
      relations: ["members"],
    })

    const email = seller?.members?.[0]?.email
    const localpartSource = seller?.handle || (email ? email.split("@")[0] : null)
    if (!localpartSource) {
      res.status(200).json({ unread_count: 0 })
      return
    }

    const mxid = matrixService.buildMxid(localpartSource)
    const unreadCount = await matrixService.getUnreadCount(mxid)
    res.json({ unread_count: unreadCount })
  } catch (error: any) {
    console.warn(
      "[GET /vendor/chat/unread] Matrix unavailable, returning degraded count:",
      error?.message
    )
    res.status(200).json({ unread_count: 0, degraded: true })
  }
}
