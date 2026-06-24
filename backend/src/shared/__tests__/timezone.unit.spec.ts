import {
  tzOffsetMs,
  zonedWallTimeToUtc,
  weekdayOf,
  parseDateOnly,
  parseTimeOfDay,
} from "../timezone"

describe("timezone helpers", () => {
  describe("tzOffsetMs", () => {
    it("computes a negative offset for US Eastern in summer (DST, -4h)", () => {
      // 2026-07-01 noon UTC — New York is UTC-4 in July.
      const offset = tzOffsetMs("America/New_York", new Date("2026-07-01T12:00:00Z"))
      expect(offset).toBe(-4 * 3_600_000)
    })

    it("computes -5h for US Eastern in winter (standard time)", () => {
      const offset = tzOffsetMs("America/New_York", new Date("2026-01-15T12:00:00Z"))
      expect(offset).toBe(-5 * 3_600_000)
    })

    it("returns 0 for UTC", () => {
      expect(tzOffsetMs("UTC", new Date("2026-07-01T12:00:00Z"))).toBe(0)
    })

    it("returns 0 for an invalid zone instead of throwing", () => {
      expect(tzOffsetMs("Not/AZone", new Date("2026-07-01T12:00:00Z"))).toBe(0)
    })
  })

  describe("zonedWallTimeToUtc", () => {
    it("maps 9:00 AM New York (summer) to 13:00 UTC", () => {
      const utc = zonedWallTimeToUtc(2026, 7, 1, 9, 0, "America/New_York")
      expect(utc.toISOString()).toBe("2026-07-01T13:00:00.000Z")
    })

    it("maps 9:00 AM New York (winter) to 14:00 UTC", () => {
      const utc = zonedWallTimeToUtc(2026, 1, 15, 9, 0, "America/New_York")
      expect(utc.toISOString()).toBe("2026-01-15T14:00:00.000Z")
    })

    it("is identity for UTC wall times", () => {
      const utc = zonedWallTimeToUtc(2026, 7, 1, 9, 30, "UTC")
      expect(utc.toISOString()).toBe("2026-07-01T09:30:00.000Z")
    })
  })

  describe("weekdayOf", () => {
    it("returns 3 (Wednesday) for 2026-07-01", () => {
      expect(weekdayOf(2026, 7, 1)).toBe(3)
    })
  })

  describe("parseDateOnly / parseTimeOfDay", () => {
    it("parses valid values", () => {
      expect(parseDateOnly("2026-07-01")).toEqual([2026, 7, 1])
      expect(parseTimeOfDay("09:30")).toEqual([9, 30])
    })

    it("rejects malformed values", () => {
      expect(parseDateOnly("2026/07/01")).toBeNull()
      expect(parseTimeOfDay("25:00")).toBeNull()
      expect(parseTimeOfDay("9:5")).toBeNull()
    })
  })
})
