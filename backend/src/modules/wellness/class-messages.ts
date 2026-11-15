/**
 * The bracket variables a class message fills (`[session_type]`, `[date]`,
 * `[time]`, `[link]`; see the default `class_registered` and `class_reminder`
 * copy in ./service.ts). `renderTemplate` leaves a token it is not given
 * literal, so a caller that passed only `session_type` sent buyers
 * "You're registered for Sound bath on [date] at [time]! ... [link]" (SD-52
 * re-review).
 *
 * Date and time are the class's own wall clock (`timezone`, an IANA zone),
 * never the server's: the server runs in UTC, so a 7pm New York class read
 * "12:00 AM". The zone's short name goes on the time so the reader knows
 * which clock it is.
 */

/** `tz` if Intl knows it, else "UTC" (the vendor routes accept free text). */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz.trim()) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() })
    return tz.trim()
  } catch {
    return "UTC"
  }
}

/** Whether Intl recognises `tz` as an IANA time zone. */
export function isKnownTimeZone(tz: unknown): boolean {
  return typeof tz === "string" && tz.trim().length > 0 && safeTimeZone(tz) === tz.trim()
}

/**
 * "Tuesday, December 1" and "7:00 PM EST" for `at` on `timezone`'s clock.
 * Some ICU versions put a narrow no-break space before AM/PM; it is made a
 * plain space so the text is the same everywhere.
 */
export function formatWhen(at: Date | string, timezone: unknown): { date: string; time: string } {
  const when = at instanceof Date ? at : new Date(at)
  const timeZone = safeTimeZone(timezone)
  const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ")
  return {
    date: plain(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(when)),
    time: plain(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(when)
    ),
  }
}

/** What `[link]` says when the class has no address or meeting link yet. */
export const CLASS_LINK_FALLBACK = "your practitioner will send the details"

/**
 * Every variable a class message uses, for one class. `link` is
 * `location_detail` (the address or meeting link the model says is only for
 * registered attendees), so send these only to an attendee holding a seat.
 */
export function classMessageVars(cls: {
  title: string
  starts_at: Date | string
  timezone?: string | null
  location_detail?: string | null
}): { session_type: string; date: string; time: string; link: string } {
  const { date, time } = formatWhen(cls.starts_at, cls.timezone)
  const link = typeof cls.location_detail === "string" && cls.location_detail.trim() ? cls.location_detail.trim() : CLASS_LINK_FALLBACK
  return { session_type: cls.title, date, time, link }
}
