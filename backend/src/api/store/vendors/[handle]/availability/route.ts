import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../../modules/booking"
import type BookingService from "../../../../../modules/booking/service"

const log = createLogger("api/store/vendors/availability")

/**
 * GET /store/vendors/:handle/availability?product_id=&date=YYYY-MM-DD
 *
 * Public (key-optional) bookable-slot lookup for a vendor's service product.
 * Returns absolute UTC instants; the embed renders them in the visitor's local
 * time. Cacheable briefly — availability changes only as bookings land.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = req.params.handle
  const productId = String(req.query.product_id || "")
  const date = String(req.query.date || "")

  if (!productId || !date) {
    return res.status(400).json({
      message: "product_id and date (YYYY-MM-DD) are required",
      type: "invalid_data",
    })
  }

  try {
    const query = req.scope.resolve("query")
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "handle"],
      filters: { handle } as any,
    })
    const seller = sellers?.[0]
    if (!seller) {
      return res
        .status(404)
        .json({ message: `No vendor found for handle "${handle}"`, type: "not_found" })
    }

    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const config = await booking.getConfigForProduct(productId)
    const slots = await booking.generateSlots({
      seller_id: seller.id,
      product_id: productId,
      date,
    })

    res.setHeader(
      "Cache-Control",
      "public, max-age=30, s-maxage=60, stale-while-revalidate=120"
    )
    return res.json({
      product_id: productId,
      date,
      timezone: config?.timezone ?? null,
      duration_minutes: config?.duration_minutes ?? null,
      slots,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error(`[GET availability] failed for ${handle}:`, msg)
    return res
      .status(500)
      .json({ message: "Failed to load availability", type: "server_error" })
  }
}
