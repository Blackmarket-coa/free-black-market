import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/product-types/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /vendor/product-types/:id
 *
 * Retrieves a single product type by ID.
 * Product types are global and not vendor-specific.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { id } = req.params

  if (!id) {
    return res.status(400).json({ message: "Product type ID is required" })
  }

  try {
    const productModuleService = req.scope.resolve(Modules.PRODUCT)

    const productType = await productModuleService.retrieveProductType(id)

    if (!productType) {
      return res.status(404).json({
        message: `Product type with id "${id}" not found`,
      })
    }

    res.json({
      product_type: productType,
    })
  } catch (error: any) {
    // Handle not found errors specifically
    if (error.type === "not_found" || error.message?.includes("not found")) {
      return res.status(404).json({
        message: `Product type with id "${id}" not found`,
      })
    }

    log.error("[VENDOR] Failed to fetch product type:", error)
    res.status(500).json({
      message: "Failed to fetch product type",
      error: error.message,
    })
  }
}
