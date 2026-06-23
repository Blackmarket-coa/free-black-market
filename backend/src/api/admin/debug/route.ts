import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/debug")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * This endpoint helps diagnose and fix seller_product associations
 * Use with caution - only for debugging orphaned products
 * SECURITY: Restricted to non-production environments
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" })
  }

  // GET request for easy browser access - diagnose only
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    // Check for orphaned products
    const orphanedProducts = await pgConnection.raw(`
      SELECT p.id, p.title, tp.id as ticket_product_id
      FROM product p
      INNER JOIN ticket_product tp ON p.id = tp.product_id
      LEFT JOIN seller_product sp ON p.id = sp.product_id
      WHERE sp.id IS NULL
      LIMIT 20
    `)

    const sellers = await pgConnection.raw(`
      SELECT id, name FROM seller LIMIT 5
    `)

    return res.json({
      orphanedCount: orphanedProducts.rows?.length || 0,
      orphanedProducts: orphanedProducts.rows || [],
      sellersAvailable: sellers.rows?.length || 0,
      sellers: sellers.rows || [],
      instruction: "POST to this endpoint with {\"action\": \"fix\"} to link orphaned products to sellers"
    })
  } catch (error) {
    log.error("Debug endpoint error:", error)
    res.status(500).json({
      error: error.message
    })
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" })
  }

  const body = req.body as { action?: string }
  const { action } = body

  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (action === "diagnose") {
      // Check for orphaned products
      const orphanedProducts = await pgConnection.raw(`
        SELECT p.id, p.title, tp.id as ticket_product_id
        FROM product p
        INNER JOIN ticket_product tp ON p.id = tp.product_id
        LEFT JOIN seller_product sp ON p.id = sp.product_id
        WHERE sp.id IS NULL
        LIMIT 20
      `)

      const sellers = await pgConnection.raw(`
        SELECT id, name FROM seller LIMIT 5
      `)

      return res.json({
        orphanedCount: orphanedProducts.rows?.length || 0,
        orphanedProducts: orphanedProducts.rows || [],
        sellersAvailable: sellers.rows?.length || 0,
        sellers: sellers.rows || []
      })
    }

    if (action === "fix") {
      // Link all orphaned ticket products to the first seller
      await pgConnection.raw(`
        INSERT INTO seller_product (id, seller_id, product_id, created_at, updated_at)
        SELECT 
          'selprod_' || substr(md5(random()::text || p.id), 1, 26),
          (SELECT id FROM seller ORDER BY created_at ASC LIMIT 1),
          p.id,
          NOW(),
          NOW()
        FROM product p
        INNER JOIN ticket_product tp ON p.id = tp.product_id
        LEFT JOIN seller_product sp ON p.id = sp.product_id
        WHERE sp.id IS NULL
        ON CONFLICT DO NOTHING
      `)

      // Verify the fix
      const verification = await pgConnection.raw(`
        SELECT COUNT(*) as linked_count
        FROM seller_product 
        WHERE id LIKE 'selprod_%'
        AND created_at > NOW() - INTERVAL '1 minute'
      `)

      return res.json({
        status: "success",
        message: `Fixed seller_product associations. ${verification.rows?.[0]?.linked_count || 0} products linked.`,
        linkedCount: verification.rows?.[0]?.linked_count || 0
      })
    }

    return res.status(400).json({
      error: "Invalid action. Use 'diagnose' or 'fix'."
    })
  } catch (error) {
    log.error("Debug endpoint error:", error)
    res.status(500).json({
      error: error.message
    })
  }
}
