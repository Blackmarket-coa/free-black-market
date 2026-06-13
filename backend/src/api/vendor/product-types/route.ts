import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/product-types")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /vendor/product-types
 *
 * Lists all product types available in the system.
 * Product types are global and not vendor-specific, so all authenticated
 * vendors can view the full list to categorize their products.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const productModuleService = req.scope.resolve(Modules.PRODUCT)

    // Extract query parameters for filtering and pagination
    const {
      q,
      id,
      value,
      limit = 20,
      offset = 0,
      order,
      fields,
      ...rest
    } = req.query as Record<string, any>

    // Build filters
    const filters: Record<string, any> = {}

    if (id) {
      filters.id = Array.isArray(id) ? id : [id]
    }

    if (value) {
      filters.value = Array.isArray(value) ? value : [value]
    }

    if (q) {
      filters.q = q
    }

    // List product types with pagination
    const [productTypes, count] = await productModuleService.listAndCountProductTypes(
      filters,
      {
        skip: parseInt(offset as string, 10) || 0,
        take: parseInt(limit as string, 10) || 20,
        order: order ? { [order as string]: "ASC" } : { value: "ASC" },
      }
    )

    res.json({
      product_types: productTypes,
      count,
      offset: parseInt(offset as string, 10) || 0,
      limit: parseInt(limit as string, 10) || 20,
    })
  } catch (error: any) {
    log.error("[VENDOR] Failed to fetch product types:", error)
    res.status(500).json({
      message: "Failed to fetch product types",
      error: error.message,
    })
  }
}
