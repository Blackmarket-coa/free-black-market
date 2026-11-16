import { INVALID_TIME_ZONE_MESSAGE, parseReportTimeZone } from "../time-zone"

const calendarFor = (time_zone: unknown) => {
  const parsed = parseReportTimeZone({ time_zone })
  if (!parsed.ok) throw new Error(`expected a calendar, got 400: ${parsed.message}`)
  return parsed.calendar
}

/** 19:30 on 13 November 2025 in Los Angeles (UTC-8): 03:30 on the 14th in UTC. */
const LA_EVENING = new Date("2025-11-13T19:30:00-08:00")

describe("parseReportTimeZone", () => {
  it("the instant under test is on different calendar days in UTC and Los Angeles", () => {
    expect(LA_EVENING.toISOString()).toBe("2025-11-14T03:30:00.000Z")
  })

  it("with no time_zone (absent or empty) writes UTC dates, as the report always did", () => {
    for (const query of [{}, { time_zone: undefined }, { time_zone: "" }]) {
      const parsed = parseReportTimeZone(query)
      if (!parsed.ok) throw new Error(parsed.message)
      expect(parsed.calendar.timeZone).toBeNull()
      expect(parsed.calendar.dateOf(LA_EVENING)).toBe("2025-11-14")
      // Exactly the old expression, at both ends of a UTC day.
      for (const iso of ["2026-01-01T00:00:00.000Z", "2025-12-31T23:59:59.999Z"]) {
        const at = new Date(iso)
        expect(parsed.calendar.dateOf(at)).toBe(at.toISOString().split("T")[0])
      }
    }
  })

  it("writes a moment's date in the named zone", () => {
    const la = calendarFor("America/Los_Angeles")
    expect(la.timeZone).toBe("America/Los_Angeles")
    // The evening order is on the 13th for the vendor, not the 14th.
    expect(la.dateOf(LA_EVENING)).toBe("2025-11-13")
    // The window the panel sends for that local day: both ends are the 13th,
    // and the next local midnight is the 14th.
    expect(la.dateOf(new Date("2025-11-13T08:00:00.000Z"))).toBe("2025-11-13")
    expect(la.dateOf(new Date("2025-11-14T07:59:59.999Z"))).toBe("2025-11-13")
    expect(la.dateOf(new Date("2025-11-14T08:00:00.000Z"))).toBe("2025-11-14")
    // East of UTC the local date runs ahead instead.
    expect(calendarFor("Asia/Tokyo").dateOf(new Date("2025-11-13T15:00:00.000Z"))).toBe("2025-11-14")
    // Zero-padded, and across a year boundary.
    expect(la.dateOf(new Date("2026-01-01T07:59:59.999Z"))).toBe("2025-12-31")
    expect(la.dateOf(new Date("2026-03-01T08:00:00.000Z"))).toBe("2026-03-01")
  })

  it("uses the offset in force on each day, across both DST changes", () => {
    const la = calendarFor("America/Los_Angeles")
    // 8 March 2026: daylight time starts, local midnight is 08:00Z before and
    // 07:00Z after. 1 November 2026: it ends.
    expect(la.dateOf(new Date("2026-03-08T07:59:59.999Z"))).toBe("2026-03-07")
    expect(la.dateOf(new Date("2026-03-08T08:00:00.000Z"))).toBe("2026-03-08")
    expect(la.dateOf(new Date("2026-03-09T06:59:59.999Z"))).toBe("2026-03-08")
    expect(la.dateOf(new Date("2026-03-09T07:00:00.000Z"))).toBe("2026-03-09")
    expect(la.dateOf(new Date("2026-11-01T07:00:00.000Z"))).toBe("2026-11-01")
    expect(la.dateOf(new Date("2026-11-02T07:59:59.999Z"))).toBe("2026-11-01")
    expect(la.dateOf(new Date("2026-11-02T08:00:00.000Z"))).toBe("2026-11-02")
  })

  it.each([
    ["America/Los_Angeles", "2025-11-13"],
    ["America/New_York", "2025-11-13"],
    ["America/Chicago", "2025-11-13"],
    ["America/Denver", "2025-11-13"],
    ["America/Phoenix", "2025-11-13"],
    ["America/Anchorage", "2025-11-13"],
    ["Pacific/Honolulu", "2025-11-13"],
    // Three segments, a hyphen, and a sign inside a name.
    ["America/Argentina/Buenos_Aires", "2025-11-14"],
    ["America/Port-au-Prince", "2025-11-13"],
    ["Etc/GMT+8", "2025-11-13"],
    // Names browsers still report, and links.
    ["Asia/Calcutta", "2025-11-14"],
    ["US/Pacific", "2025-11-13"],
    ["UTC", "2025-11-14"],
    ["Etc/UTC", "2025-11-14"],
    ["Europe/London", "2025-11-14"],
  ])("accepts the IANA name %s", (zone, date) => {
    expect(calendarFor(zone).dateOf(LA_EVENING)).toBe(date)
  })

  it.each([
    // Not a zone at all.
    ["garbage"],
    ["Mars/Phobos"],
    ["America"],
    ["America/"],
    ["/America/Los_Angeles"],
    ["America//Los_Angeles"],
    ["Etc/Unknown"],
    ["undefined"],
    ["null"],
    ["en-US"],
    // UTC offsets: Intl.DateTimeFormat takes the first three, but an offset is
    // not a zone, and is wrong on the other side of a DST change.
    ["-08:00"],
    ["+05:30"],
    ["+0530"],
    ["GMT-8"],
    ["UTC+1"],
    // Surrounding or embedded whitespace and control characters.
    [" America/Los_Angeles"],
    ["America/Los_Angeles "],
    ["America/Los_Angeles\n"],
    ["America/Los Angeles"],
    ["America/Los_Angeles\r\nX-Injected: 1"],
    ["America/Los_Angeles\u0000"],
    // SQL-shaped.
    ["America/Los_Angeles'; DROP TABLE \"order\"; --"],
    ["America/Los_Angeles' OR '1'='1"],
    ["UTC') AT TIME ZONE ('UTC"],
    ["UTC; SELECT pg_sleep(10)"],
    ["$1"],
    ["?"],
    // Header-, path- and template-shaped.
    ['UTC".csv"; filename="evil.exe'],
    ["../../etc/passwd"],
    ["America/../Los_Angeles"],
    ["${process.env.JWT_SECRET}"],
    ["<script>alert(1)</script>"],
    ["America/Los_Angeles%00"],
    // A valid name buried in something longer, and an over-long value.
    ["America/Los_Angeles,UTC"],
    [`America/${"A".repeat(80)}`],
    ["A".repeat(10_000)],
  ])("refuses %j", (value) => {
    expect(parseReportTimeZone({ time_zone: value })).toEqual({
      ok: false,
      message: INVALID_TIME_ZONE_MESSAGE,
    })
  })

  it.each([
    // A repeated parameter, a nested one, and non-strings: Intl would coerce
    // ["UTC"] to "UTC" and read undefined as the server's own zone.
    [["America/Los_Angeles", "UTC"]],
    [["America/Los_Angeles"]],
    [{ $ne: "UTC" }],
    [null],
    [0],
    [true],
  ])("refuses a value that is not one string: %j", (value) => {
    expect(parseReportTimeZone({ time_zone: value }).ok).toBe(false)
  })

  it("does not echo what it was sent in the refusal", () => {
    const parsed = parseReportTimeZone({ time_zone: "<script>alert(1)</script>" })
    expect(parsed).toEqual({ ok: false, message: INVALID_TIME_ZONE_MESSAGE })
    expect(INVALID_TIME_ZONE_MESSAGE).not.toContain("script")
  })

  it("reports the zone's canonical name, whatever case or alias was sent", () => {
    expect(calendarFor("america/los_angeles").timeZone).toBe("America/Los_Angeles")
    expect(calendarFor("US/Pacific").timeZone).toBe("America/Los_Angeles")
    expect(calendarFor("america/los_angeles").dateOf(LA_EVENING)).toBe("2025-11-13")
  })
})
