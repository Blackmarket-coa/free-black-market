import { createLogger } from "./logger"

const log = createLogger("shared/booking-notify")

type MinimalBooking = {
  id: string
  customer_email: string
  customer_name?: string | null
  starts_at: Date | string
  ends_at: Date | string
  status: string
}

/**
 * Best-effort booking email. Never throws — a notification failure must not
 * break the request or subscriber that triggered it. Uses the "email" channel
 * (Resend/SMTP per env) with the `booking-confirmation` template.
 */
export async function notifyBookingConfirmed(
  container: { resolve: (k: string) => any },
  booking: MinimalBooking,
  vendorName?: string | null
): Promise<void> {
  try {
    const notification = container.resolve("notification")
    await notification.createNotifications({
      to: booking.customer_email,
      channel: "email",
      template: "booking-confirmation",
      data: {
        booking_id: booking.id,
        customer_name: booking.customer_name ?? null,
        starts_at: booking.starts_at,
        ends_at: booking.ends_at,
        vendor_name: vendorName ?? "the vendor",
      },
    })
  } catch (err) {
    log.warn(`booking-confirmation email failed for ${booking.id}`, err)
  }
}
