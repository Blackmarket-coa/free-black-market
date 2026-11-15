import { parseReportDateRange } from "../date-range"

const NOW = new Date("2026-11-15T21:17:33.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

const ok = (query: Record<string, unknown>) => {
  const parsed = parseReportDateRange(query, NOW)
  if (!parsed.ok) throw new Error(`expected a range, got 400: ${parsed.message}`)
  return parsed.range
}

describe("parseReportDateRange", () => {
  it("treats the panel's date-only end_date as the whole of that UTC day", () => {
    // The panel's default request: the last 30 days, ending today.
    const range = ok({ start_date: "2026-10-16", end_date: "2026-11-15" })
    expect(range.start.toISOString()).toBe("2026-10-16T00:00:00.000Z")
    expect(range.endExclusive.toISOString()).toBe("2026-11-16T00:00:00.000Z")
    expect(range.end.toISOString()).toBe("2026-11-15T23:59:59.999Z")
    // An order placed today, after midnight UTC, is inside the window.
    expect(NOW.getTime()).toBeGreaterThanOrEqual(range.start.getTime())
    expect(NOW.getTime()).toBeLessThan(range.endExclusive.getTime())
  })

  it("a single-day range (start = end) is that whole day, not empty", () => {
    const range = ok({ start_date: "2026-11-14", end_date: "2026-11-14" })
    expect(range.endExclusive.getTime() - range.start.getTime()).toBe(DAY_MS)
  })

  it("uses a full ISO date-time as given, and counts that instant", () => {
    const range = ok({ start_date: "2026-11-01T08:00:00Z", end_date: "2026-11-15T10:00:00+05:30" })
    expect(range.start.toISOString()).toBe("2026-11-01T08:00:00.000Z")
    expect(range.end.toISOString()).toBe("2026-11-15T04:30:00.000Z")
    expect(range.endExclusive.getTime() - range.end.getTime()).toBe(1)
  })

  it("defaults to the 30 days ending now, and an empty parameter means absent", () => {
    for (const query of [{}, { start_date: "", end_date: "" }]) {
      const range = ok(query)
      expect(range.end.getTime()).toBe(NOW.getTime())
      expect(range.endExclusive.getTime() - range.start.getTime()).toBe(30 * DAY_MS)
    }
  })

  it("with only an end date, starts 30 whole days before it", () => {
    const range = ok({ end_date: "2026-11-15" })
    expect(range.start.toISOString()).toBe("2026-10-17T00:00:00.000Z")
  })

  it.each([
    ["garbage"],
    ["2026-02-31"],
    ["2026-13-01"],
    ["2026-11-15T25:00:00Z"],
    ["2026-02-31T10:00:00Z"],
    // No time zone: the server's local time would decide what it means.
    ["2026-11-15T10:00:00"],
    ["Nov 15 2026"],
    ["1700000000000"],
  ])("refuses %s rather than reading an Invalid Date into a 500", (value) => {
    for (const name of ["start_date", "end_date"] as const) {
      const parsed = parseReportDateRange({ [name]: value }, NOW)
      expect(parsed).toEqual({ ok: false, message: expect.stringContaining(name) })
    }
  })

  it("refuses a repeated parameter (an array), which is not one date", () => {
    const parsed = parseReportDateRange({ end_date: ["2026-11-01", "2026-11-15"] }, NOW)
    expect(parsed.ok).toBe(false)
  })
})
