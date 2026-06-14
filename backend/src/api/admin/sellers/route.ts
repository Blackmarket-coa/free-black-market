import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/sellers
 *
 * List all sellers with their seller_metadata (vendor_type, certifications, etc.)
 * and producer information if available.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Build filters from query params
  const filters: Record<string, unknown> = {}

  if (req.query.q) {
    // Search by name or email
    filters.$or = [
      { name: { $ilike: `%${req.query.q}%` } },
      { email: { $ilike: `%${req.query.q}%` } },
    ]
  }

  if (req.query.store_status) {
    filters.store_status = req.query.store_status
  }

  // Get all sellers with their related seller_metadata
  // Note: producer is linked via producer_seller link, not directly on seller entity
  const { data: sellers, metadata } = await query.graph({
    entity: "seller",
    fields: [
      "id",
      "name",
      "email",
      "phone",
      "description",
      "handle",
      "address_line",
      "city",
      "postal_code",
      "country_code",
      "tax_id",
      "store_status",
      "created_at",
      "updated_at",
      // Include seller_metadata
      "seller_metadata.*",
    ],
    filters,
    pagination: {
      skip: req.query.offset ? Number(req.query.offset) : 0,
      take: req.query.limit ? Number(req.query.limit) : 20,
    },
  })

  // Fetch producer info for all sellers via producer_seller link
  const sellerIds = sellers.map((s: { id: string }) => s.id)
  const producerMap: Record<string, unknown> = {}

  if (sellerIds.length > 0) {
    try {
      const { data: producerLinks } = await query.graph({
        entity: "producer_seller",
        fields: ["seller_id", "producer.*"],
        filters: {
          seller_id: sellerIds,
        },
      })

      // Create a map of seller_id -> producer
      for (const link of producerLinks || []) {
        if (link.seller_id && link.producer) {
          producerMap[link.seller_id] = link.producer
        }
      }
    } catch {
      // producer_seller link may not exist for all sellers, ignore errors
    }
  }

  // Merge producer info into sellers
  const sellersWithProducer = sellers.map((seller: { id: string }) => ({
    ...seller,
    producer: producerMap[seller.id] || null,
  }))

  return res.json({
    sellers: sellersWithProducer,
    count: metadata?.count || 0,
    limit: metadata?.take || 20,
    offset: metadata?.skip || 0,
  })
}
