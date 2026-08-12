import { syncLotInventoryWorkflow } from "../../../../../../workflows/sync-lot-inventory";
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

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
  const linkService = req.scope.resolve("link") as unknown as LinkServiceType;
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } })
    .auth_context?.actor_id;
  const lotId = req.params.id;

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    // Verify ownership
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId,
      },
    });

    if (!producerLinks || producerLinks.length === 0) {
      return res.status(403).json({ message: "No farm profile found" });
    }

    // Get the lot to verify it exists and get details
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
      product_id,
      variant_id,
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
      location_id,
    } = req.body as Record<string, unknown>;

    if (!product_id) {
      return res.status(400).json({ message: "product_id is required" });
    }

    // Verify the product belongs to this seller
    const { data: sellerProducts } = await query.graph({
      entity: "seller_product",
      fields: ["seller_id", "product.id", "product.title"],
      filters: {
        seller_id: sellerId,
        product_id: product_id as string,
      },
    });

    if (!sellerProducts || sellerProducts.length === 0) {
      return res
        .status(403)
        .json({ message: "You do not have access to this product" });
    }

    // Create availability window linking lot to product
    const availabilityWindow =
      await agricultureService.createAvailabilityWindows({
        lot_id: lotId,
        product_id: product_id as string,
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

    // Create link between product and availability window
    await linkService.create({
      product_availability_window: {
        product_id: product_id as string,
        availability_window_id: availabilityWindow.id,
      },
    });

    // If sync_inventory is true, update product variant inventory
    if (sync_inventory && variant_id) {
      if (!location_id || typeof location_id !== "string") {
        return res.status(400).json({
          message: "location_id is required when sync_inventory is enabled",
        });
      }

      const { result: syncResult } = await syncLotInventoryWorkflow(
        req.scope,
      ).run({
        input: {
          lot_id: lotId,
          product_variant_id: variant_id as string,
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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      message: "Failed to link product",
      error: errorMessage,
    });
  }
}

/**
 * GET /vendor/farm/lots/:id/link-product
 * Get products linked to this lot (via availability windows)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query");
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } })
    .auth_context?.actor_id;
  const lotId = req.params.id;

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      message: "Failed to fetch linked products",
      error: errorMessage,
    });
  }
}

/**
 * DELETE /vendor/farm/lots/:id/link-product
 * Unlink a product from this lot (remove availability window)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query");
  const linkService = req.scope.resolve("link") as unknown as LinkServiceType;
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } })
    .auth_context?.actor_id;
  const lotId = req.params.id;

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { availability_window_id } = req.body as Record<string, unknown>;

    if (!availability_window_id) {
      return res
        .status(400)
        .json({ message: "availability_window_id is required" });
    }

    // Verify the window belongs to this lot
    const { data: windows } = await query.graph({
      entity: "availability_window",
      fields: ["id", "lot_id", "product_id"],
      filters: {
        id: availability_window_id as string,
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
        product_availability_window: {
          product_id: window.product_id,
          availability_window_id: availability_window_id as string,
        },
      });
    }

    // Soft delete the availability window by deactivating it
    const agricultureService = req.scope.resolve(
      "agriculture",
    ) as AgricultureServiceType;
    await agricultureService.updateAvailabilityWindows({
      id: availability_window_id as string,
      is_active: false,
      product_id: null,
    });

    res.status(200).json({ message: "Product unlinked successfully" });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      message: "Failed to unlink product",
      error: errorMessage,
    });
  }
}
