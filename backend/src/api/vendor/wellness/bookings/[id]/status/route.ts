import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../../../modules/booking"
import type BookingService from "../../../../../../modules/booking/service"
import { BookingStatus } from "../../../../../../modules/booking/models/booking"
import { WellnessKarmaService } from "../../../../../../modules/wellness/karma"
import { WellnessAutomationService } from "../../../../../../modules/wellness/automation-service"
import { sellerId, wellnessService, fail, body } from "../../../_helpers"

const log = createLogger("api/vendor/wellness/bookings/[id]/status")

const ALLOWED = new Set<string>([
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CANCELLED,
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
])

type BookingRow = {
  id: string
  customer_email: string
  customer_name: string | null
  price_amount?: number | null
}

/**
 * POST /vendor/wellness/bookings/:id/status — transition a booking.
 *
 * On `completed`: bump the client's stats, award KARMA (first session bonus on
 * the very first), and fire the post-session follow-up automation.
 * On `no_show`: increment the no-show count and apply the (negative) KARMA.
 * KARMA + automation are best-effort and never block the status change.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{ status: string }>(req)
    if (!b.status || !ALLOWED.has(b.status))
      return res.status(400).json({ message: "valid status is required" })

    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const rows = (await booking.listBookings(
      { id: req.params.id, seller_id: seller } as never,
      { take: 1 }
    )) as BookingRow[]
    const existing = rows?.[0]
    if (!existing) return res.status(404).json({ message: "Not found" })

    const patch: Record<string, unknown> = { id: req.params.id, status: b.status }
    if (b.status === BookingStatus.COMPLETED) patch.completed_at = new Date()
    if (b.status === BookingStatus.CANCELLED) patch.cancelled_at = new Date()
    const updated = await booking.updateBookings(patch)

    // Side effects (best-effort).
    if (b.status === BookingStatus.COMPLETED || b.status === BookingStatus.NO_SHOW) {
      try {
        const svc = wellnessService(req)
        const profile = (await svc.upsertClientProfile(seller, {
          email: existing.customer_email,
          name: existing.customer_name,
        })) as Record<string, unknown>

        if (b.status === BookingStatus.COMPLETED) {
          const isFirst = Number(profile.total_bookings ?? 0) === 0
          await svc.updateClientProfiles({
            id: profile.id as string,
            total_bookings: Number(profile.total_bookings ?? 0) + 1,
            lifetime_value_amount:
              Number(profile.lifetime_value_amount ?? 0) + Number(existing.price_amount ?? 0),
            last_seen_at: new Date(),
          })

          const karma = new WellnessKarmaService(req.scope)
          await karma.emitWellnessKarmaEvent({
            seller_id: seller,
            event_type: "booking_completed",
            reference_id: `booking:${existing.id}`,
          })
          if (isFirst) {
            await karma.emitWellnessKarmaEvent({
              seller_id: seller,
              event_type: "booking_first_session",
              reference_id: `first:${existing.id}`,
            })
          }

          const automation = new WellnessAutomationService(req.scope)
          await automation.runTrigger({
            seller_id: seller,
            trigger: "booking_completed",
            vars: { name: existing.customer_name ?? "there" },
            recipients: [
              { email: existing.customer_email, name: existing.customer_name },
            ],
          })
        } else {
          await svc.updateClientProfiles({
            id: profile.id as string,
            no_show_count: Number(profile.no_show_count ?? 0) + 1,
          })
          const karma = new WellnessKarmaService(req.scope)
          await karma.emitWellnessKarmaEvent({
            seller_id: seller,
            event_type: "booking_no_show",
            reference_id: `noshow:${existing.id}`,
          })
        }
      } catch (err) {
        log.warn("[booking status] side effects failed", err)
      }
    }

    return res.json({ booking: updated })
  } catch (e) {
    return fail(res, log, "POST booking status", e)
  }
}
