import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { WISHLIST_MODULE } from "../../../modules/wishlist"
import WishlistModuleService from "../../../modules/wishlist/service"
import { requireCustomerId } from "../../../shared"
import { visibleProductIds } from "../../middlewares/store-public-fields"

/**
 * FBM's wishlist. This file answers `/store/wishlist`, not Mercur's route of
 * the same path: it reads FBM's own wishlist module and ignores `fields`, so
 * the `/store` field policy (`api/middlewares/store-public-fields.ts`) never
 * sees what it selects.
 *
 * Which products (SD-118). It selected each wishlisted product whole by id,
 * and `POST` took any id. A signed-in customer holding the id of a draft, or
 * of a product sold only in another sales channel, could save it and read
 * its whole row back (measured on Postgres). Now both ends hold to what
 * `GET /store/products` serves for the request: published, and in the
 * publishable key's sales channel (`visibleProductIds`).
 */

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

    // Only the products the listing would serve this request. A row saved
    // before `POST` checked, or a product unpublished or taken off the
    // channel since it was saved, stays in the module and is left out here.
    const visible = await visibleProductIds(req, [...new Set<string>(productIds)])

    // Fetch products if there are any
    let productsMap: Record<string, any> = {}
    if (visible.size > 0) {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["*", "variants.*", "images.*"],
        filters: {
          id: [...visible],
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

    // A product the caller could not open is not saved either: the 404
    // `GET /store/products/:id` answers, word for word, whether the id is a
    // draft's, another channel's product's, or nobody's.
    const visible = await visibleProductIds(req, [data.reference_id])
    if (!visible.has(data.reference_id)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product with id: ${data.reference_id} was not found`
      )
    }

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
