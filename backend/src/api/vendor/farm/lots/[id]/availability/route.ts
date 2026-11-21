import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { forbidden } from "../../../../../../shared/community-read-access"
import { farmFailure, farmId, farmIds, optionalFarmId, ownedLot } from "../../../_access"

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
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const params = farmIds(res, req.params, { id: farmId })
  if (!params) return
  const lotId = params.id
  // One id, or none, before any check (`farmId` in `_access.ts`).
  const ids = farmIds(res, req.body, { product_id: optionalFarmId })
  if (!ids) return
  const { product_id } = ids

  try {
    // The lot must be the caller's own, through its harvest: this checked only
    // that the lot existed and the caller had some farm profile, so a window
    // could be opened on another store's lot. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

    const {
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

    // A product named here must be the store's own, as link-product requires:
    // this took any store's product (SD-145 review, measured 201).
    if (product_id) {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: sellerProducts } = await query.graph({
        entity: "seller_product",
        fields: ["product_id"],
        filters: { seller_id: owned.caller.sellerId, product_id },
      })
      if (!sellerProducts?.length) {
        return forbidden(res)
      }
    }

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
    })

    res.status(201).json({ availability_window: availabilityWindow })
  } catch (error) {
    farmFailure(req, res, "Failed to create availability window", error)
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
  const params = farmIds(res, req.params, { id: farmId })
  if (!params) return
  const lotId = params.id

  try {
    // The lot must be the caller's own: this listed any lot's windows for a
    // caller with some farm profile. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

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
        "created_at",
        "updated_at",
      ],
      filters: {
        lot_id: lotId,
      },
    })

    res.json({ availability_windows: windows || [] })
  } catch (error) {
    farmFailure(req, res, "Failed to fetch availability windows", error)
  }
}
