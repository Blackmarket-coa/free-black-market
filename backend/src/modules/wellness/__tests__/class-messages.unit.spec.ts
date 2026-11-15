import { CLASS_LINK_FALLBACK, classMessageVars, formatWhen, isKnownTimeZone, safeTimeZone } from "../class-messages"
import { renderTemplate } from "../automation-service"
import { bookingReminderWindow } from "../../../jobs/wellness-reminders"

/**
 * SD-52 re-review: the class messages arrived with literal [date], [time] and
 * [link] (the subscriber passed only name and session_type), and the reminder
 * job formatted the time on the server's clock (UTC), not the class's.
 * The real-database proof is integration-tests/http/wellness-seller-scope.spec.ts.
 */

// Both zones have no daylight saving, so these hold whatever the date.
const AT = new Date("2026-11-17T03:00:00Z")

describe("formatWhen", () => {
  it("reads the instant on the given zone's clock, and names the zone", () => {
    expect(formatWhen(AT, "Asia/Kolkata")).toEqual({ date: "Tuesday, November 17", time: "8:30 AM GMT+5:30" })
    expect(formatWhen(AT, "Asia/Tokyo")).toEqual({ date: "Tuesday, November 17", time: "12:00 PM GMT+9" })
    // The server's clock would have said 3:00 AM.
    expect(formatWhen(AT, "UTC")).toEqual({ date: "Tuesday, November 17", time: "3:00 AM UTC" })
  })

  it("a date that changes across the zone line changes with it", () => {
    expect(formatWhen(new Date("2026-11-17T20:00:00Z"), "Asia/Tokyo").date).toBe("Wednesday, November 18")
  })

  it("an unknown or empty zone reads as UTC rather than throwing", () => {
    expect(formatWhen(AT, "Mars/Olympus").time).toBe("3:00 AM UTC")
    expect(formatWhen(AT, null).time).toBe("3:00 AM UTC")
    expect(formatWhen(AT.toISOString(), "Asia/Tokyo").time).toBe("12:00 PM GMT+9")
  })
})

describe("safeTimeZone / isKnownTimeZone", () => {
  it("keeps a zone Intl knows and replaces anything else with UTC", () => {
    expect(safeTimeZone("America/New_York")).toBe("America/New_York")
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC")
    expect(safeTimeZone(42)).toBe("UTC")
    expect(isKnownTimeZone("America/New_York")).toBe(true)
    expect(isKnownTimeZone("Mars/Olympus")).toBe(false)
    expect(isKnownTimeZone("")).toBe(false)
  })
})

describe("classMessageVars", () => {
  const cls = { title: "Sound bath", starts_at: AT, timezone: "Asia/Kolkata", location_detail: "https://meet.example/abc" }

  it("fills every token the default class_registered and class_reminder copy uses", () => {
    const vars = classMessageVars(cls)
    expect(vars).toEqual({
      session_type: "Sound bath",
      date: "Tuesday, November 17",
      time: "8:30 AM GMT+5:30",
      link: "https://meet.example/abc",
    })
    const registered =
      "You're registered for [session_type] on [date] at [time]! Here's what to bring and where to meet: [link]"
    const reminder = "Reminder: [session_type] is coming up on [date] at [time]. Can't wait to see you there!"
    expect(renderTemplate(registered, { name: "a@example.com", ...vars })).toBe(
      "You're registered for Sound bath on Tuesday, November 17 at 8:30 AM GMT+5:30! " +
        "Here's what to bring and where to meet: https://meet.example/abc"
    )
    expect(renderTemplate(reminder, vars)).not.toMatch(/\[[a-z_]+\]/)
  })

  it("a class with no location says the details will follow instead of a literal [link]", () => {
    expect(classMessageVars({ ...cls, location_detail: null }).link).toBe(CLASS_LINK_FALLBACK)
    expect(classMessageVars({ ...cls, location_detail: "   " }).link).toBe(CLASS_LINK_FALLBACK)
  })
})

describe("bookingReminderWindow", () => {
  it("is [now+23h, now+24h), so consecutive hourly runs cover each start time once", () => {
    const t0 = new Date("2026-11-15T10:00:00Z")
    const t1 = new Date("2026-11-15T11:00:00Z")
    const w0 = bookingReminderWindow(t0)
    const w1 = bookingReminderWindow(t1)
    expect(w0).toEqual({ from: new Date("2026-11-16T09:00:00Z"), to: new Date("2026-11-16T10:00:00Z") })
    // Adjacent, not overlapping: the next run starts where this one stopped.
    expect(w1.from.getTime()).toBe(w0.to.getTime())
  })
})
