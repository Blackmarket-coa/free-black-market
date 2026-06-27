import { MedusaContainer } from "@medusajs/framework/types"
import { BOOKING_MODULE } from "../modules/booking"
import type BookingService from "../modules/booking/service"
import { WELLNESS_MODULE } from "../modules/wellness"
import type WellnessModuleService from "../modules/wellness/service"
import { WellnessAutomationService } from "../modules/wellness/automation-service"

/**
 * Time-based wellness reminders — the part automations can't do event-driven.
 * Hourly, scans the next 24h of bookings and classes and fires the relevant
 * reminder automation once per booking/class (deduped by a metadata flag).
 * Entirely best-effort.
 */
export default async function wellnessRemindersJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const booking = container.resolve(BOOKING_MODULE) as BookingService
  const wellness = container.resolve(WELLNESS_MODULE) as WellnessModuleService
  const automation = new WellnessAutomationService(container)

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 3_600_000)
  const fmtTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })

  try {
    // ---- Booking 24h reminders ----
    const upcoming = (await booking.listBookings(
      {
        status: ["pending", "confirmed"],
        starts_at: { $gte: now, $lt: in24h },
      } as never
    )) as Array<{
      id: string
      seller_id: string
      customer_email: string
      customer_name: string | null
      starts_at: Date
    }>

    for (const b of upcoming) {
      try {
        await automation.runTrigger({
          seller_id: b.seller_id,
          trigger: "booking_reminder_24h",
          vars: {
            name: b.customer_name ?? "there",
            time: fmtTime.format(new Date(b.starts_at)),
          },
          recipients: [{ email: b.customer_email, name: b.customer_name }],
        })
      } catch (e) {
        logger.warn(`[wellness-reminders] booking ${b.id} reminder failed: ${e}`)
      }
    }

    // ---- Class reminders ----
    const classes = (await wellness.listClassEvents(
      { starts_at: { $gte: now, $lt: in24h }, status: ["scheduled", "open", "full"] } as never
    )) as Array<{ id: string; seller_id: string; title: string; starts_at: Date }>

    for (const c of classes) {
      try {
        const attendees = (await wellness.listClassAttendees({
          class_event_id: c.id,
          status: "registered",
        })) as Array<{ customer_email: string; customer_name: string | null }>
        if (!attendees.length) continue
        await automation.runTrigger({
          seller_id: c.seller_id,
          trigger: "class_reminder",
          vars: { session_type: c.title, time: fmtTime.format(new Date(c.starts_at)) },
          recipients: attendees.map((a) => ({
            email: a.customer_email,
            name: a.customer_name,
          })),
        })
      } catch (e) {
        logger.warn(`[wellness-reminders] class ${c.id} reminder failed: ${e}`)
      }
    }
  } catch (error) {
    logger.error(`[wellness-reminders] job failed: ${error}`)
  }
}

export const config = {
  name: "wellness-reminders",
  schedule: "0 * * * *", // hourly
}
