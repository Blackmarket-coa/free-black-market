import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { WISHLIST_MODULE } from "../../../../../../modules/wishlist"
import WishlistModuleService from "../../../../../../modules/wishlist/service"
import { requireCustomerId, notFound } from "../../../../../../shared"

// ===========================================
// DELETE /store/wishlist/:id/product/:productId
// Remove a product from customer's wishlist
// ===========================================

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const { id: wishlistId, productId } = req.params

    const wishlistService = req.scope.resolve<WishlistModuleService>(WISHLIST_MODULE)

    // Verify the wishlist belongs to this customer
    const wishlists = await wishlistService.listShopperWishlists({
      id: wishlistId,
      customer_id: customerId,
    })

    if (wishlists.length === 0) {
      return notFound(res, "Wishlist not found")
    }

    // Remove the product from wishlist
    await wishlistService.removeProductFromWishlist(wishlistId, productId)

    res.json({
      message: "Product removed from wishlist",
      success: true,
    })
  } catch (error) {
    throw error
  }
}
