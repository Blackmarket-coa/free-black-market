import { MedusaContainer } from "@medusajs/framework/types"
import { BOOKING_MODULE } from "../modules/booking"
import type BookingService from "../modules/booking/service"
import { WELLNESS_MODULE } from "../modules/wellness"
import type WellnessModuleService from "../modules/wellness/service"
import { WellnessAutomationService } from "../modules/wellness/automation-service"
import { LIVE_CLASS_STATUSES } from "../modules/wellness/class-registration"
import { classMessageVars, formatWhen } from "../modules/wellness/class-messages"

const HOUR = 3_600_000

/**
 * The bookings one hourly run sends the 24-hour reminder for: those starting
 * in [now + 23h, now + 24h). Consecutive hourly runs tile time, so each
 * booking falls in one run's window. The booking table has no column to stamp
 * a sent reminder on, so the window is the dedupe; a run that does not happen
 * (a restart over the hour) skips that hour's bookings rather than the next
 * run reminding them. It used to be [now, now + 24h), which reminded every
 * booking on each of the 24 runs before it.
 */
export function bookingReminderWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() + 23 * HOUR), to: new Date(now.getTime() + 24 * HOUR) }
}

/**
 * Time-based wellness reminders — the part automations can't do event-driven.
 * Hourly. Entirely best-effort.
 *
 * - Classes starting in the next 24h: each class's registered attendees are
 *   reminded once, by a stamp claimed on the class before sending
 *   (`claimClassReminder`, metadata.class_reminder, keyed to the class's
 *   start time so a rescheduled class is reminded for its new time). A run
 *   that reaches nobody (the template is off, the send budget is spent, every
 *   send failed) gives the claim back and the next run tries again. A missed
 *   run is made up by the next one, since the window is the whole 24 hours.
 *   Before SD-52's re-review there was no stamp, although this header said
 *   there was, and every attendee was reminded on every run, up to 24 times,
 *   each send out of the seller's shared 50-an-hour budget.
 * - Bookings: the 24-hour reminder, once, by window ({@link bookingReminderWindow}).
 *
 * Date and time are on the class's clock (`timezone`), and a booking's on its
 * product's booking config; the server's clock is UTC, which is what they
 * used to read in.
 */
export default async function wellnessRemindersJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const booking = container.resolve(BOOKING_MODULE) as BookingService
  const wellness = container.resolve(WELLNESS_MODULE) as WellnessModuleService
  const automation = new WellnessAutomationService(container)

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * HOUR)

  try {
    // ---- Booking 24h reminders ----
    const window = bookingReminderWindow(now)
    const upcoming = (await booking.listBookings(
      {
        status: ["pending", "confirmed"],
        starts_at: { $gte: window.from, $lt: window.to },
      } as never
    )) as Array<{
      id: string
      seller_id: string
      product_id: string
      customer_email: string
      customer_name: string | null
      starts_at: Date
    }>

    // The booking's clock (its product's booking config) and the session's
    // name (the booking seller's own session type for the product).
    const zoneByProduct = new Map<string, string>()
    const sessionName = new Map<string, string>()
    if (upcoming.length) {
      const productIds = [...new Set(upcoming.map((b) => b.product_id))]
      const configs = (await booking.listProductBookingConfigs({ product_id: productIds } as never)) as Array<{
        product_id: string
        timezone?: string | null
      }>
      for (const c of configs) if (c.timezone) zoneByProduct.set(c.product_id, c.timezone)
      const sessionTypes = (await wellness.listSessionTypes({ product_id: productIds } as never)) as Array<{
        seller_id: string
        product_id: string | null
        name: string
      }>
      for (const t of sessionTypes) if (t.product_id) sessionName.set(`${t.seller_id}:${t.product_id}`, t.name)
    }

    for (const b of upcoming) {
      try {
        const { date, time } = formatWhen(b.starts_at, zoneByProduct.get(b.product_id))
        await automation.runTrigger({
          seller_id: b.seller_id,
          trigger: "booking_reminder_24h",
          vars: {
            name: b.customer_name ?? "there",
            session_type: sessionName.get(`${b.seller_id}:${b.product_id}`) ?? "session",
            date,
            time,
          },
          recipients: [{ email: b.customer_email, name: b.customer_name }],
        })
      } catch (e) {
        logger.warn(`[wellness-reminders] booking ${b.id} reminder failed: ${e}`)
      }
    }

    // ---- Class reminders ----
    const classes = (await wellness.listClassEvents(
      { starts_at: { $gte: now, $lt: in24h }, status: [...LIVE_CLASS_STATUSES] } as never
    )) as Array<{
      id: string
      seller_id: string
      title: string
      starts_at: Date
      timezone?: string | null
      location_detail?: string | null
      metadata?: Record<string, unknown> | null
    }>

    for (const c of classes) {
      try {
        const startsAt = new Date(c.starts_at).toISOString()
        const stamped = (c.metadata?.class_reminder as { starts_at?: unknown } | undefined)?.starts_at
        if (stamped === startsAt) continue

        const attendees = (await wellness.listClassAttendees({
          class_event_id: c.id,
          status: "registered",
        })) as Array<{ customer_email: string; customer_name: string | null }>
        if (!attendees.length) continue

        // One reminder per class and start time, whichever run gets here first.
        if (!(await wellness.claimClassReminder(c.id, startsAt))) continue
        const { sent } = await automation.runTrigger({
          seller_id: c.seller_id,
          trigger: "class_reminder",
          vars: classMessageVars(c),
          recipients: attendees.map((a) => ({
            email: a.customer_email,
            name: a.customer_name,
          })),
        })
        if (sent === 0) await wellness.releaseClassReminder(c.id, startsAt)
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
