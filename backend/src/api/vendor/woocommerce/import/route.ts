import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { WOOCOMMERCE_IMPORT_MODULE } from "../../../../modules/woocommerce-import"
import WooCommerceImportModuleService from "../../../../modules/woocommerce-import/service"
import { importWooProductsWorkflow } from "../../../../workflows/woocommerce-import/import-woo-products"
import { decrypt } from "../../../../modules/woocommerce-import/lib/encryption"
import { ImportStatus } from "../../../../modules/woocommerce-import/types"

/**
 * POST /vendor/woocommerce/import
 * Start importing products from the connected WooCommerce store.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { import_as_draft = true, enable_inventory_sync = true } = req.body as {
    import_as_draft?: boolean
    enable_inventory_sync?: boolean
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE
    )

    // Get the connection
    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.status(404).json({
        message: "No WooCommerce connection found. Connect your store first.",
      })
    }

    const conn = connections[0]

    // Check for in-progress imports (rate limit: 1 import at a time)
    const activeImports = await wooService.listWooCommerceImportLogs({
      connection_id: conn.id,
      status: [ImportStatus.PENDING, ImportStatus.IN_PROGRESS],
    })

    if (activeImports.length > 0) {
      return res.status(429).json({
        message: "An import is already in progress. Please wait for it to complete.",
        import_log_id: activeImports[0].id,
      })
    }

    // Update inventory sync preference
    if (conn.sync_inventory !== enable_inventory_sync) {
      await wooService.updateWooCommerceConnections({
        id: conn.id,
        sync_inventory: enable_inventory_sync,
      })
    }

    // Create an import log entry
    const importLog = await wooService.createWooCommerceImportLogs({
      connection_id: conn.id,
      status: ImportStatus.PENDING,
      import_as_draft,
    })

    // Decrypt credentials
    const credentials = {
      url: decrypt(conn.store_url),
      consumer_key: decrypt(conn.consumer_key),
      consumer_secret: decrypt(conn.consumer_secret),
    }

    // Run the import workflow
    const { result } = await importWooProductsWorkflow(req.scope).run({
      input: {
        credentials,
        seller_id: sellerId,
        currency: (conn.currency || "USD").toLowerCase(),
        import_as_draft,
        import_log_id: importLog.id,
      },
    })

    return res.status(200).json({
      import_log_id: importLog.id,
      result: result.result,
      message: `Import completed: ${result.result.imported} imported, ${result.result.failed} failed, ${result.result.skipped} skipped`,
    })
  } catch (error) {
    return res.status(500).json({
      message: "Import failed",
      error: error.message,
    })
  }
}

/**
 * GET /vendor/woocommerce/import
 * Get import history for the current vendor.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE
    )

    // Get the connection
    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.json({ imports: [] })
    }

    const importLogs = await wooService.listWooCommerceImportLogs(
      { connection_id: connections[0].id },
      { order: { created_at: "DESC" } }
    )

    return res.json({
      imports: importLogs.map((log) => ({
        id: log.id,
        status: log.status,
        total_products: log.total_products,
        imported_count: log.imported_count,
        failed_count: log.failed_count,
        skipped_count: log.skipped_count,
        import_as_draft: log.import_as_draft,
        error_details: log.error_details,
        started_at: log.started_at,
        completed_at: log.completed_at,
        created_at: log.created_at,
      })),
    })
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch import history",
      error: error.message,
    })
  }
}
