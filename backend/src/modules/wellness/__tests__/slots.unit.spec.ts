import { getAvailableSlots, AvailabilityWindow } from "../slots"

/**
 * Unit tests for the pure wellness slot engine. Uses a fixed `now` so results
 * are deterministic. All times are computed in the given timezone.
 */
describe("getAvailableSlots", () => {
  // Wednesday 2026-07-01 (day_of_week = 3) — a fixed reference day.
  const TZ = "America/New_York"
  // 2026-06-29T00:00:00Z — well before the test date so min-notice is satisfied.
  const NOW = Date.parse("2026-06-29T12:00:00Z")

  const nineToFive: AvailabilityWindow[] = [
    { day_of_week: 3, start_time: "09:00", end_time: "17:00" },
  ]

  it("returns no slots when there is no availability for that weekday", () => {
    const slots = getAvailableSlots(
      [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }],
      [],
      "2026-07-01",
      { duration_minutes: 60, timezone: TZ, now: NOW }
    )
    expect(slots).toHaveLength(0)
  })

  it("slices a window into duration+buffer steps", () => {
    const slots = getAvailableSlots([{ day_of_week: 3, start_time: "09:00", end_time: "11:00" }], [], "2026-07-01", {
      duration_minutes: 60,
      buffer_minutes: 0,
      timezone: TZ,
      now: NOW,
    })
    // 09:00-10:00 and 10:00-11:00
    expect(slots).toHaveLength(2)
  })

  it("accounts for buffer time between sessions", () => {
    const slots = getAvailableSlots([{ day_of_week: 3, start_time: "09:00", end_time: "11:00" }], [], "2026-07-01", {
      duration_minutes: 60,
      buffer_minutes: 30,
      timezone: TZ,
      now: NOW,
    })
    // step = 90min: only 09:00-10:00 fits (next would start 10:30, end 11:30 > 11:00)
    expect(slots).toHaveLength(1)
  })

  it("drops slots that overlap an existing booking", () => {
    const all = getAvailableSlots(nineToFive, [], "2026-07-01", {
      duration_minutes: 60,
      timezone: TZ,
      now: NOW,
    })
    // Book the very first slot; it should disappear from the result.
    const booked = [{ starts_at: all[0].starts_at, ends_at: all[0].ends_at }]
    const after = getAvailableSlots(nineToFive, booked, "2026-07-01", {
      duration_minutes: 60,
      timezone: TZ,
      now: NOW,
    })
    expect(after).toHaveLength(all.length - 1)
    expect(after.find((s) => s.starts_at === all[0].starts_at)).toBeUndefined()
  })

  it("honors the min-notice lead time", () => {
    // now = same day as the date, only 1h before the window → 24h notice drops all.
    const sameDayNow = Date.parse("2026-07-01T12:00:00Z")
    const slots = getAvailableSlots(nineToFive, [], "2026-07-01", {
      duration_minutes: 60,
      min_notice_hours: 24,
      timezone: TZ,
      now: sameDayNow,
    })
    expect(slots).toHaveLength(0)
  })

  it("honors the advance-booking horizon", () => {
    const slots = getAvailableSlots(nineToFive, [], "2026-07-01", {
      duration_minutes: 60,
      advance_days: 1, // 2026-06-29 + 1d = 2026-06-30, before the test date
      timezone: TZ,
      now: NOW,
    })
    expect(slots).toHaveLength(0)
  })

  it("returns slots sorted ascending", () => {
    const slots = getAvailableSlots(nineToFive, [], "2026-07-01", {
      duration_minutes: 60,
      timezone: TZ,
      now: NOW,
    })
    const sorted = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    expect(slots).toEqual(sorted)
    expect(slots.length).toBeGreaterThan(0)
  })
})
