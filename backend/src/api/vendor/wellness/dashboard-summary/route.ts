import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import { sellerId, wellnessService, fail } from "../_helpers"

const log = createLogger("api/vendor/wellness/dashboard-summary")

// GET /vendor/wellness/dashboard-summary
// Composed from multiple sources, each wrapped best-effort so one failure
// doesn't blank the whole dashboard.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const svc = wellnessService(req)
    const now = new Date()
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 86_400_000)

    const summary: Record<string, unknown> = {}

    // Memberships / MRR.
    try {
      summary.active_members = await svc.countActiveMembers(seller)
      summary.mrr_amount = await svc.computeMrrAmount(seller)
    } catch (e) {
      log.warn("dashboard: memberships failed", e)
      summary.active_members = 0
      summary.mrr_amount = 0
    }

    // Today's bookings + upcoming.
    try {
      const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
      const todays = (await booking.listBookings({
        seller_id: seller,
        starts_at: { $gte: dayStart, $lt: dayEnd },
      } as never)) as unknown[]
      summary.todays_bookings = todays
      const upcoming = (await booking.listBookings(
        {
          seller_id: seller,
          status: ["pending", "confirmed"],
          starts_at: { $gte: now },
        } as never,
        { take: 10, order: { starts_at: "ASC" } }
      )) as unknown[]
      summary.upcoming_bookings = upcoming
    } catch (e) {
      log.warn("dashboard: bookings failed", e)
      summary.todays_bookings = []
      summary.upcoming_bookings = []
    }

    // Today's + next class.
    try {
      const classes = (await svc.listClassEvents(
        { seller_id: seller, starts_at: { $gte: now } } as never,
        { take: 5, order: { starts_at: "ASC" } }
      )) as unknown[]
      summary.upcoming_classes = classes
    } catch (e) {
      log.warn("dashboard: classes failed", e)
      summary.upcoming_classes = []
    }

    // Credits outstanding + recent clients.
    try {
      const members = (await svc.listMembers({
        seller_id: seller,
        status: "active",
      })) as Array<{ credits_balance: number }>
      summary.credits_outstanding = members.reduce(
        (sum, m) => sum + Number(m.credits_balance ?? 0),
        0
      )
      const clients = await svc.listClientProfiles(
        { seller_id: seller },
        { take: 3, order: { last_seen_at: "DESC" } }
      )
      summary.recent_clients = clients
    } catch (e) {
      log.warn("dashboard: clients failed", e)
      summary.credits_outstanding = 0
      summary.recent_clients = []
    }

    return res.json({ summary })
  } catch (e) {
    return fail(res, log, "GET dashboard-summary", e)
  }
}
