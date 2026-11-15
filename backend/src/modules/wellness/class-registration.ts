import type { ClassStatus } from "./models/class-event"

/**
 * The class statuses a seat can still be taken in. The hourly reminder job
 * (`jobs/wellness-reminders.ts`) reminds exactly these, the order subscriber
 * (`subscribers/wellness-order-placed.ts`) looks up only these, and
 * `registerForClass` refuses every other status. "cancelled" is what the
 * vendor DELETE writes (it soft-cancels and leaves the ticket product linked
 * and on sale); "completed" is a class that has happened.
 */
export const LIVE_CLASS_STATUSES = ["scheduled", "open", "full"] as const satisfies readonly ClassStatus[]

/**
 * Why `registerForClass` refused to seat anyone. None of these changes the
 * class: before SD-52's review, registering wrote `status: "open"` back onto
 * a cancelled or finished class and seated the buyer in it.
 *
 * - `cancelled`, `completed`: the class's status.
 * - `not_live`: any other status outside {@link LIVE_CLASS_STATUSES} (the
 *   vendor class update accepts free text).
 * - `ended`: the class's `ends_at` is not in the future (or is unreadable).
 */
export type ClassRegistrationRefusal = "cancelled" | "completed" | "not_live" | "ended"

/**
 * Whether a class can take a registration at `now`, and if not, why. One
 * predicate for the service guard; the subscriber's database filter asks the
 * same question (live status, `ends_at > now`).
 */
export function classRegistrationRefusal(
  cls: { status?: unknown; ends_at?: unknown },
  now: Date = new Date()
): ClassRegistrationRefusal | null {
  const status = typeof cls.status === "string" ? cls.status : ""
  if (status === "cancelled") return "cancelled"
  if (status === "completed") return "completed"
  if (!(LIVE_CLASS_STATUSES as readonly string[]).includes(status)) return "not_live"
  const endsAt =
    cls.ends_at instanceof Date
      ? cls.ends_at
      : typeof cls.ends_at === "string" || typeof cls.ends_at === "number"
        ? new Date(cls.ends_at)
        : null
  if (!endsAt || Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= now.getTime()) return "ended"
  return null
}
