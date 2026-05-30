import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { WOOCOMMERCE_IMPORT_MODULE } from "../modules/woocommerce-import";
import WooCommerceImportModuleService from "../modules/woocommerce-import/service";
import {
  getInventoryDriftItems,
  getLotAnomalies,
  getStaleWooConnections,
} from "../utils/inventory-reconciliation-utils";
import { emitBlackoutEvent } from "../lib/blackout-emit";

/**
 * Scheduled job: inventory data quality reconciliation.
 *
 * Checks for:
 * - inventory items where reserved quantity is higher than stocked quantity
 * - lots with negative available/reserved quantity
 * - WooCommerce connections with stale sync timestamps
 */
export default async function inventoryReconciliationJob(
  container: MedusaContainer,
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const wooService: WooCommerceImportModuleService = container.resolve(
    WOOCOMMERCE_IMPORT_MODULE,
  );

  logger.info("[Inventory Reconciliation] Starting run");

  try {
    const { data: inventoryItems } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "sku", "+stocked_quantity", "+reserved_quantity"],
      filters: {},
    });

    const inventoryDrift = getInventoryDriftItems(inventoryItems || []);

    const { data: lots } = await query.graph({
      entity: "lot",
      fields: ["id", "quantity_available", "quantity_reserved", "unit"],
      filters: {},
    });

    const lotAnomalies = getLotAnomalies(lots || []);

    const wooConnections = await wooService.listWooCommerceConnections({
      sync_inventory: true,
    });

    const now = Date.now();
    const staleThresholdMs = 1000 * 60 * 60 * 48; // 48 hours

    const staleWooSync = getStaleWooConnections(
      wooConnections as { id: string; last_synced_at?: string | Date | null }[],
      now,
      staleThresholdMs,
    );

    logger.info(
      `[Inventory Reconciliation] Summary ${JSON.stringify({
        inventory_items_checked: (inventoryItems || []).length,
        inventory_drift_count: inventoryDrift.length,
        lots_checked: (lots || []).length,
        lot_anomaly_count: lotAnomalies.length,
        woo_connections_checked: wooConnections.length,
        woo_stale_sync_count: staleWooSync.length,
      })}`,
    );

    if (inventoryDrift.length > 0) {
      logger.warn(
        `[Inventory Reconciliation] Reserved exceeds stocked for inventory items: ${inventoryDrift
          .slice(0, 20)
          .map((item: any) => item.id)
          .join(",")}`,
      );
    }

    if (lotAnomalies.length > 0) {
      logger.warn(
        `[Inventory Reconciliation] Negative lot quantities detected: ${lotAnomalies
          .slice(0, 20)
          .map((lot: any) => lot.id)
          .join(",")}`,
      );
    }

    if (staleWooSync.length > 0) {
      logger.warn(
        `[Inventory Reconciliation] Stale Woo sync connections: ${staleWooSync
          .slice(0, 20)
          .map((connection: any) => connection.id)
          .join(",")}`,
      );
    }

    // §3 inventory.low — emit when stocked falls at/below the threshold. The
    // vendor for a SKU is resolved from item metadata when present; items
    // without a resolvable seller are skipped (the seller-link join is the
    // remaining one-line wire-up — see work order §3 notes).
    const threshold = Number(process.env.FBM_INVENTORY_LOW_THRESHOLD ?? 5);
    let lowEmitted = 0;
    for (const item of (inventoryItems || []) as any[]) {
      const remaining = Number(item.stocked_quantity ?? 0) - Number(item.reserved_quantity ?? 0);
      if (!(remaining >= 0 && remaining <= threshold)) continue;
      const vendorId =
        (item.metadata?.seller_id as string | undefined) ??
        (item.metadata?.vendor_id as string | undefined);
      if (!vendorId || !item.sku) continue;
      await emitBlackoutEvent(
        container,
        "inventory.low",
        {
          vendorId,
          sku: item.sku,
          title: (item.title as string) ?? item.sku,
          remaining,
          threshold,
        },
        { eventId: `inventory.low:${item.id}:${remaining}` },
      );
      lowEmitted++;
    }
    if (lowEmitted > 0) {
      logger.info(`[Inventory Reconciliation] Emitted ${lowEmitted} inventory.low event(s)`);
    }
  } catch (error: any) {
    logger.error(
      `[Inventory Reconciliation] Failed run: ${error?.message || error}`,
    );
  }
}

export const config = {
  name: "inventory-reconciliation",
  schedule: "0 3 * * *", // Daily at 3:00 AM
};
