import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { WOOCOMMERCE_IMPORT_MODULE } from "../../../../modules/woocommerce-import";
import WooCommerceImportModuleService from "../../../../modules/woocommerce-import/service";
import { syncWooInventoryWorkflow } from "../../../../workflows/woocommerce-import/sync-woo-inventory";

/**
 * POST /vendor/woocommerce/sync
 * Manually trigger an inventory sync from WooCommerce.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).auth_context?.actor_id;

  if (!sellerId) {
    return res.status(401).json({ code: "INVENTORY_SYNC_UNAUTHORIZED", message: "Unauthorized" });
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE,
    );

    // Get the connection
    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    });

    if (connections.length === 0) {
      return res.status(404).json({
        code: "INVENTORY_SYNC_CONNECTION_NOT_FOUND",
        message: "No WooCommerce connection found. Connect your store first.",
      });
    }

    const conn = connections[0];

    // Run the sync workflow
    const { result } = await syncWooInventoryWorkflow(req.scope).run({
      input: {
        connection_id: conn.id,
        seller_id: sellerId,
      },
    });

    return res.json({
      code: "INVENTORY_SYNC_COMPLETED",
      message: "Inventory sync completed",
      report: result.report,
    });
  } catch (error: any) {
    return res.status(500).json({
      code: "INVENTORY_SYNC_FAILED",
      message: "Inventory sync failed",
      error: error.message,
    });
  }
}

/**
 * GET /vendor/woocommerce/sync
 * Get the latest sync report.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).auth_context?.actor_id;

  if (!sellerId) {
    return res.status(401).json({ code: "INVENTORY_SYNC_UNAUTHORIZED", message: "Unauthorized" });
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE,
    );

    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    });

    if (connections.length === 0) {
      return res.json({ sync: null });
    }

    const conn = connections[0];

    return res.json({
      sync: {
        sync_inventory: conn.sync_inventory,
        last_synced_at: conn.last_synced_at,
        last_sync_report: conn.last_sync_report,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      code: "INVENTORY_SYNC_STATUS_FAILED",
      message: "Failed to fetch sync status",
      error: error.message,
    });
  }
}
