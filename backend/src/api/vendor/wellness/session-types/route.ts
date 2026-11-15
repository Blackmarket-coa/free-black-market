import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import { sellerId, wellnessService, fail, body, ownedProductId } from "../_helpers"
import { forbidden } from "../../../../shared/community-read-access"
import { isKnownTimeZone } from "../../../../modules/wellness/class-messages"

const log = createLogger("api/vendor/wellness/session-types")

// GET /vendor/wellness/session-types — the practitioner's service menu.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const rows = await wellnessService(req).listSessionTypes(
      { seller_id: seller },
      { order: { created_at: "DESC" } }
    )
    return res.json({ session_types: rows })
  } catch (e) {
    return fail(res, log, "GET /vendor/wellness/session-types", e)
  }
}

// POST /vendor/wellness/session-types — create a session type. When a product
// is linked, upsert a product_booking_config so the booking slot engine covers
// it without re-implementing slot math here.
//
// The `product_id` must be one of the caller's own products: 403 otherwise,
// the same for one that does not exist. It used to take any product id and
// write a booking config for it under the caller (SD-81 addendum).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      name: string
      description?: string
      duration_minutes?: number
      buffer_minutes?: number
      price_amount?: number
      currency_code?: string
      color?: string
      location_type?: string
      intake_form_id?: string
      prep_instructions?: string
      max_per_week?: number
      product_id?: string
      timezone?: string
      is_embeddable?: boolean
    }>(req)

    if (!b.name || !b.name.trim()) {
      return res.status(400).json({ message: "name is required" })
    }
    if (b.timezone !== undefined && !isKnownTimeZone(b.timezone)) {
      return res.status(400).json({ message: "timezone must be an IANA time zone, e.g. America/New_York" })
    }
    const product = await ownedProductId(req, seller, b.product_id ?? null)
    if (!product.ok) return forbidden(res)
    const productId = product.value

    const svc = wellnessService(req)
    const created = await svc.createSessionTypes({
      seller_id: seller,
      name: b.name.trim(),
      description: b.description ?? null,
      duration_minutes: b.duration_minutes ?? 60,
      buffer_minutes: b.buffer_minutes ?? 0,
      price_amount: b.price_amount ?? null,
      currency_code: b.currency_code ?? null,
      color: b.color ?? null,
      location_type: b.location_type ?? "video",
      intake_form_id: b.intake_form_id ?? null,
      prep_instructions: b.prep_instructions ?? null,
      max_per_week: b.max_per_week ?? null,
      product_id: productId,
      is_embeddable: b.is_embeddable ?? true,
    })

    // Best-effort: make the linked product bookable, unless the caller already
    // has a config on it (active or not, as they set it). A config another
    // seller wrote on the product before the ownership check is not the
    // caller's, and is taken over.
    if (productId) {
      try {
        const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
        const [own] = await booking.listProductBookingConfigs(
          { product_id: productId, seller_id: seller },
          { take: 1 }
        )
        if (!own) {
          const { previous_seller_id } = await booking.saveConfigAsProductOwner(seller, productId, {
            duration_minutes: b.duration_minutes ?? 60,
            buffer_minutes: b.buffer_minutes ?? 0,
            timezone: b.timezone ?? "America/New_York",
            advance_days: 30,
            min_notice_hours: 24,
            is_active: true,
          })
          if (previous_seller_id) {
            log.warn(
              `[session-types] seller ${seller} took over product ${productId}'s booking config from seller ${previous_seller_id}`
            )
          }
        }
      } catch (err) {
        log.warn("[session-types] booking config upsert failed", err)
      }
    }

    return res.status(201).json({ session_type: created })
  } catch (e) {
    return fail(res, log, "POST /vendor/wellness/session-types", e)
  }
}
