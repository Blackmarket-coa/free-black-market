import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /vendor/farm/stats
 * Get dashboard stats for the current farm
 *
 * OPTIMIZED: Uses parallel query execution where possible
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Get producer ID for this seller
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      return res.json({
        stats: {
          active_harvests: 0,
          total_lots: 0,
          available_products: 0,
          pending_orders: 0,
        }
      })
    }

    const producerId = producerLinks[0].producer_id

    // Get harvest counts first (needed for lot query)
    const { data: harvests } = await query.graph({
      entity: "harvest",
      fields: ["id", "visibility_status"],
      filters: {
        producer_id: producerId,
        visibility_status: { $in: ["PUBLIC", "PREVIEW"] }
      },
    })

    const harvestIds = harvests?.map((h) => h.id) || []

    // OPTIMIZATION: If we have harvests, get lot counts
    // Future: add parallel queries for available_products and pending_orders
    let lotsCount = 0
    let availableProductsCount = 0
    let pendingOrdersCount = 0
    let lots: Array<{ id: string; quantity_reserved?: number }> = []
    if (harvestIds.length > 0) {
      const { data: fetchedLots } = await query.graph({
        entity: "lot",
        fields: ["id", "quantity_reserved"],
        filters: {
          harvest_id: { $in: harvestIds },
          is_active: true,
        },
      })
      lots = fetchedLots || []
      lotsCount = lots.length
    }

    const lotIds = lots.map((lot) => lot.id)

    if (lotIds.length > 0) {
      const { data: availabilityWindows } = await query.graph({
        entity: "availability_window",
        fields: ["product_id", "available_from", "available_until", "is_active"],
        filters: {
          lot_id: { $in: lotIds },
          is_active: true,
        },
      })

      const now = new Date()
      const availableProductIds = new Set<string>()

      for (const window of availabilityWindows || []) {
        if (!window?.product_id) {
          continue
        }

        const availableFrom = window.available_from
          ? new Date(window.available_from)
          : null
        const availableUntil = window.available_until
          ? new Date(window.available_until)
          : null
        const isWithinWindow =
          (!availableFrom || availableFrom <= now) &&
          (!availableUntil || availableUntil >= now)

        if (isWithinWindow) {
          availableProductIds.add(window.product_id)
        }
      }

      availableProductsCount = availableProductIds.size
    }

    pendingOrdersCount = lots.reduce((count, lot) => {
      return (lot.quantity_reserved ?? 0) > 0 ? count + 1 : count
    }, 0)

    res.json({
      stats: {
        active_harvests: harvests?.length || 0,
        total_lots: lotsCount,
        available_products: availableProductsCount,
        pending_orders: pendingOrdersCount,
      }
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch farm stats",
      error: error.message
    })
  }
}
