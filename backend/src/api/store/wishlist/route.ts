import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { WISHLIST_MODULE } from "../../../modules/wishlist"
import WishlistModuleService from "../../../modules/wishlist/service"
import { requireCustomerId } from "../../../shared"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const addWishlistItemSchema = z.object({
  reference: z.literal("product"),
  reference_id: z.string().min(1, "Product ID is required"),
})

// ===========================================
// GET /store/wishlist
// Get customer's wishlists with products
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const wishlistService = req.scope.resolve<WishlistModuleService>(WISHLIST_MODULE)
    const query = req.scope.resolve("query")

    // Get wishlists with items using the module service
    const wishlists = await wishlistService.listShopperWishlists(
      { customer_id: customerId },
      { relations: ["items"] }
    )

    // Collect all product IDs from wishlist items
    const productIds = wishlists.flatMap((wishlist: any) =>
      (wishlist.items || []).map((item: any) => item.product_id)
    ).filter(Boolean)

    // Fetch products if there are any
    let productsMap: Record<string, any> = {}
    if (productIds.length > 0) {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["*", "variants.*", "images.*"],
        filters: {
          id: productIds,
        },
      })
      productsMap = products.reduce((acc: Record<string, any>, product: any) => {
        acc[product.id] = product
        return acc
      }, {})
    }

    // Transform data to match storefront expectations
    const transformedWishlists = wishlists.map((wishlist: any) => ({
      id: wishlist.id,
      products: (wishlist.items || [])
        .map((item: any) => productsMap[item.product_id])
        .filter(Boolean),
    }))

    res.json({
      wishlists: transformedWishlists,
      count: transformedWishlists.length,
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /store/wishlist
// Add a product to customer's wishlist
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const data = addWishlistItemSchema.parse(req.body)

    const wishlistService = req.scope.resolve<WishlistModuleService>(WISHLIST_MODULE)

    // Add product to wishlist (will create wishlist if it doesn't exist)
    const wishlist = await wishlistService.addProductToWishlist(
      customerId,
      data.reference_id
    )

    res.status(201).json({
      wishlist: {
        id: wishlist.id,
      },
      message: "Product added to wishlist",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
