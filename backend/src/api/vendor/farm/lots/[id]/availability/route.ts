import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Type for agriculture service methods
interface AgricultureServiceType {
  createHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteHarvests: (id: string) => Promise<void>
  createLots: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateLots: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteLots: (id: string) => Promise<void>
  createAvailabilityWindows: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * POST /vendor/farm/lots/:id/availability
 * Create an availability window for a lot
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const lotId = req.params.id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Verify ownership
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      return res.status(403).json({ message: "No farm profile found" })
    }

    // Verify lot exists
    const { data: lots } = await query.graph({
      entity: "lot",
      fields: ["id", "harvest_id"],
      filters: {
        id: lotId,
      },
    })

    if (!lots || lots.length === 0) {
      return res.status(404).json({ message: "Lot not found" })
    }

    const {
      product_id,
      available_from,
      available_until,
      sales_channel,
      pricing_strategy,
      unit_price,
      currency_code,
      price_tiers,
      min_order_quantity,
      max_order_quantity,
      quantity_increment,
      preorder_enabled,
      preorder_deposit_percent,
      estimated_ship_date,
      pickup_enabled,
      delivery_enabled,
      shipping_enabled,
      pickup_locations,
      fulfillment_lead_time_hours,
      surplus_discount_percent,
      featured,
      is_active,
    } = req.body as Record<string, unknown>

    // Create the availability window
    const availabilityWindow = await agricultureService.createAvailabilityWindows({
      lot_id: lotId,
      product_id,
      available_from: available_from || new Date().toISOString(),
      available_until,
      sales_channel: sales_channel || "DTC",
      pricing_strategy: pricing_strategy || "FIXED",
      unit_price: unit_price || 0,
      currency_code: currency_code || "USD",
      price_tiers,
      min_order_quantity: min_order_quantity || 1,
      max_order_quantity,
      quantity_increment: quantity_increment || 1,
      preorder_enabled: preorder_enabled || false,
      preorder_deposit_percent,
      estimated_ship_date,
      pickup_enabled: pickup_enabled !== false,
      delivery_enabled: delivery_enabled || false,
      shipping_enabled: shipping_enabled !== false,
      pickup_locations,
      fulfillment_lead_time_hours: fulfillment_lead_time_hours || 24,
      surplus_discount_percent,
      featured: featured || false,
      sort_order: 0,
      is_active: is_active !== false,
      view_count: 0,
      order_count: 0,
    })

    res.status(201).json({ availability_window: availabilityWindow })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to create availability window", 
      error: error.message 
    })
  }
}

/**
 * GET /vendor/farm/lots/:id/availability
 * Get all availability windows for a lot
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const lotId = req.params.id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Verify ownership
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      return res.status(403).json({ message: "No farm profile found" })
    }

    // Get availability windows for this lot
    const { data: windows } = await query.graph({
      entity: "availability_window",
      fields: [
        "id",
        "lot_id",
        "product_id",
        "available_from",
        "available_until",
        "sales_channel",
        "pricing_strategy",
        "unit_price",
        "currency_code",
        "price_tiers",
        "min_order_quantity",
        "max_order_quantity",
        "quantity_increment",
        "preorder_enabled",
        "preorder_deposit_percent",
        "estimated_ship_date",
        "pickup_enabled",
        "delivery_enabled",
        "shipping_enabled",
        "pickup_locations",
        "fulfillment_lead_time_hours",
        "surplus_discount_percent",
        "featured",
        "sort_order",
        "is_active",
        "paused_at",
        "pause_reason",
        "view_count",
        "order_count",
        "created_at",
        "updated_at",
      ],
      filters: {
        lot_id: lotId,
      },
    })

    res.json({ availability_windows: windows || [] })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to fetch availability windows", 
      error: error.message 
    })
  }
}
