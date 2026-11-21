import { syncLotInventoryWorkflow } from "../../../../../../workflows/sync-lot-inventory";
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { AGRICULTURE_MODULE } from "../../../../../../modules/agriculture";
import { forbidden } from "../../../../../../shared/community-read-access";
import { farmFailure, farmId, farmIds, optionalFarmId, ownedLot } from "../../../_access";

// Type for agriculture service methods
interface AgricultureServiceType {
  updateAvailabilityWindows: (
    data: Record<string, unknown>,
  ) => Promise<{ id: string }>;
  createAvailabilityWindows: (
    data: Record<string, unknown>,
  ) => Promise<{ id: string }>;
}

// Type for link service methods
interface LinkServiceType {
  create: (data: Record<string, unknown>) => Promise<unknown[]>;
  dismiss: (data: Record<string, unknown>) => Promise<void>;
}

/**
 * POST /vendor/farm/lots/:id/link-product
 * Link a lot to a Medusa product by creating an availability window
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query");
  const agricultureService = req.scope.resolve(
    "agriculture",
  ) as AgricultureServiceType;
  const linkService = req.scope.resolve(ContainerRegistrationKeys.LINK) as unknown as LinkServiceType;
  const params = farmIds(res, req.params, { id: farmId });
  if (!params) return;
  const lotId = params.id;
  // One id each, before any check: an array passed the seller_product check
  // below as IN, and the INSERT after it failed with its SQL in the 500
  // (`farmId` in `_access.ts`).
  const ids = farmIds(res, req.body, {
    product_id: farmId,
    variant_id: optionalFarmId,
    location_id: optionalFarmId,
  });
  if (!ids) return;
  const { product_id, variant_id, location_id } = ids;

  try {
    // The lot must be the caller's own, through its harvest: this checked only
    // that the caller had some farm profile. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId);
    if (!owned) return;
    const sellerId = owned.caller.sellerId;

    // The lot's details
    const { data: lots } = await query.graph({
      entity: "lot",
      fields: [
        "id",
        "harvest_id",
        "quantity_available",
        "unit",
        "suggested_price_per_unit",
        "best_by_date",
        "allocation_type",
      ],
      filters: {
        id: lotId,
      },
    });

    if (!lots || lots.length === 0) {
      return res.status(404).json({ message: "Lot not found" });
    }

    const lot = lots[0];

    const {
      unit_price,
      currency_code,
      sales_channel,
      available_from,
      available_until,
      min_order_quantity,
      max_order_quantity,
      pickup_enabled,
      delivery_enabled,
      shipping_enabled,
      preorder_enabled,
      sync_inventory,
    } = req.body as Record<string, unknown>;

    // Verify the product belongs to this seller
    const { data: sellerProducts } = await query.graph({
      entity: "seller_product",
      fields: ["seller_id", "product.id", "product.title"],
      filters: {
        seller_id: sellerId,
        product_id,
      },
    });

    if (!sellerProducts || sellerProducts.length === 0) {
      return forbidden(res);
    }

    // The variant and the location go to updateInventoryLevels when
    // sync_inventory is set, so they must be the store's too: the variant one
    // of the verified product's, the location one of the store's stock
    // locations. Only the product was checked, so a store could overwrite
    // another store's inventory level with its own lot's quantity (SD-145
    // review: measured 50 to 3 on Postgres). Everything is checked before
    // anything is written; the 400 for a missing location used to come after
    // the window and its link were made.
    if (sync_inventory && variant_id && !location_id) {
      return res.status(400).json({
        message: "location_id is required when sync_inventory is enabled",
      });
    }
    if (variant_id) {
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "product_id"],
        filters: { id: variant_id },
      });
      if (!variants?.length || variants[0].product_id !== product_id) {
        return forbidden(res);
      }
    }
    if (location_id) {
      const { data: locations } = await query.graph({
        entity: "seller_stock_location",
        fields: ["stock_location_id"],
        filters: { seller_id: sellerId, stock_location_id: location_id },
      });
      if (!locations?.length) {
        return forbidden(res);
      }
    }

    // Create availability window linking lot to product
    const availabilityWindow =
      await agricultureService.createAvailabilityWindows({
        lot_id: lotId,
        product_id,
        unit_price: unit_price || lot.suggested_price_per_unit || 0,
        currency_code: currency_code || "usd",
        sales_channel: sales_channel || "DTC",
        available_from: available_from || new Date().toISOString(),
        available_until: available_until || lot.best_by_date,
        min_order_quantity: min_order_quantity || 1,
        max_order_quantity: max_order_quantity || null,
        pickup_enabled: pickup_enabled !== false,
        delivery_enabled: delivery_enabled || false,
        shipping_enabled: shipping_enabled !== false,
        preorder_enabled: preorder_enabled || false,
        pricing_strategy: "FIXED",
        is_active: true,
      });

    // Link product and window by module key: `{ product_availability_window:
    // ... }` is not a shape Medusa's Link reads (the same shape threw a
    // TypeError for the farm profile and harvest links, measured).
    await linkService.create({
      [Modules.PRODUCT]: { product_id },
      [AGRICULTURE_MODULE]: { availability_window_id: availabilityWindow.id },
    });

    // If sync_inventory is true, update product variant inventory (variant and
    // location checked above).
    if (sync_inventory && variant_id && location_id) {
      const { result: syncResult } = await syncLotInventoryWorkflow(
        req.scope,
      ).run({
        input: {
          lot_id: lotId,
          product_variant_id: variant_id,
          location_id,
        },
      });

      req.scope.resolve("logger").info(
        `[Lot Inventory Sync] ${JSON.stringify({
          seller_id: sellerId,
          lot_id: lotId,
          variant_id,
          location_id,
          synced: syncResult.synced,
          reason: syncResult.reason,
        })}`,
      );

      if (!syncResult.synced) {
        return res.status(409).json({
          message: "Product linked, but inventory sync did not complete",
          availability_window: availabilityWindow,
          sync_result: syncResult,
        });
      }
    }

    res.status(201).json({
      availability_window: availabilityWindow,
      message: "Product linked successfully",
    });
  } catch (error: unknown) {
    farmFailure(req, res, "Failed to link product", error);
  }
}

/**
 * GET /vendor/farm/lots/:id/link-product
 * Get products linked to this lot (via availability windows)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query");
  const params = farmIds(res, req.params, { id: farmId });
  if (!params) return;
  const lotId = params.id;

  try {
    // The lot must be the caller's own: this listed any lot's linked products
    // to any seller. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId);
    if (!owned) return;

    // Get availability windows for this lot with linked products
    const { data: windows } = await query.graph({
      entity: "availability_window",
      fields: [
        "id",
        "lot_id",
        "product_id",
        "unit_price",
        "currency_code",
        "sales_channel",
        "available_from",
        "available_until",
        "is_active",
      ],
      filters: {
        lot_id: lotId,
        product_id: { $ne: null },
      },
    });

    // Get product details for each linked product
    const productIds = [
      ...new Set(
        (windows || [])
          .map((w: Record<string, unknown>) => w.product_id)
          .filter(Boolean),
      ),
    ] as string[];

    let products: Record<string, unknown>[] = [];
    if (productIds.length > 0) {
      const { data: productData } = await query.graph({
        entity: "product",
        fields: ["id", "title", "thumbnail", "status"],
        filters: {
          id: { $in: productIds } as any,
        },
      });
      products = productData || [];
    }

    // Combine windows with product info
    const linkedProducts = (windows || []).map(
      (window: Record<string, unknown>) => {
        const product = products.find(
          (p: Record<string, unknown>) => p.id === window.product_id,
        );
        return {
          ...window,
          product,
        };
      },
    );

    res.json({ linked_products: linkedProducts });
  } catch (error: unknown) {
    farmFailure(req, res, "Failed to fetch linked products", error);
  }
}

/**
 * DELETE /vendor/farm/lots/:id/link-product
 * Unlink a product from this lot (remove availability window)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query");
  const linkService = req.scope.resolve(ContainerRegistrationKeys.LINK) as unknown as LinkServiceType;
  const params = farmIds(res, req.params, { id: farmId });
  if (!params) return;
  const lotId = params.id;
  // One id, before any check: an array passed the window check below as IN
  // and failed further on (`farmId` in `_access.ts`).
  const ids = farmIds(res, req.body, { availability_window_id: farmId });
  if (!ids) return;
  const { availability_window_id } = ids;

  try {
    // The lot must be the caller's own: this unlinked any lot's window for any
    // seller who named both ids. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId);
    if (!owned) return;

    // Verify the window belongs to this lot
    const { data: windows } = await query.graph({
      entity: "availability_window",
      fields: ["id", "lot_id", "product_id"],
      filters: {
        id: availability_window_id,
        lot_id: lotId,
      },
    });

    if (!windows || windows.length === 0) {
      return res.status(404).json({ message: "Availability window not found" });
    }

    const window = windows[0];

    // Remove the link
    if (window.product_id) {
      await linkService.dismiss({
        [Modules.PRODUCT]: { product_id: window.product_id },
        [AGRICULTURE_MODULE]: { availability_window_id },
      });
    }

    // Soft delete the availability window by deactivating it
    const agricultureService = req.scope.resolve(
      "agriculture",
    ) as AgricultureServiceType;
    await agricultureService.updateAvailabilityWindows({
      id: availability_window_id,
      is_active: false,
      product_id: null,
    });

    res.status(200).json({ message: "Product unlinked successfully" });
  } catch (error: unknown) {
    farmFailure(req, res, "Failed to unlink product", error);
  }
}
