import {
  startOfDayInZone,
  startOfWeekInZone,
  startOfPermitYearInZone,
  daysUntil,
} from "../utils/time"

/**
 * These boundaries decide which bucket a sale lands in, so an off-by-one-day
 * error here silently misreports a seller's position against a legal limit.
 */
describe("cottage-food time boundaries", () => {
  describe("startOfDayInZone", () => {
    it("rolls the day over at local midnight, not UTC midnight", () => {
      // 03:00 UTC on Jun 12 is still Jun 11, 8pm in Los Angeles — mid dinner
      // service. The day must not have rolled over yet.
      const instant = new Date("2026-06-12T03:00:00Z")
      const start = startOfDayInZone(instant, "America/Los_Angeles")
      // Jun 11 00:00 PDT === Jun 11 07:00 UTC
      expect(start.toISOString()).toBe("2026-06-11T07:00:00.000Z")
    })

    it("handles a zone ahead of UTC", () => {
      // 22:00 UTC Jun 11 is already Jun 12, 7am in Tokyo.
      const instant = new Date("2026-06-11T22:00:00Z")
      const start = startOfDayInZone(instant, "Asia/Tokyo")
      expect(start.toISOString()).toBe("2026-06-11T15:00:00.000Z")
    })

    it("lands on the correct instant across a spring-forward transition", () => {
      // US DST began 2026-03-08. An instant later that day must resolve to
      // local midnight PST (UTC-8), before the 2am jump.
      const instant = new Date("2026-03-08T20:00:00Z")
      const start = startOfDayInZone(instant, "America/Los_Angeles")
      expect(start.toISOString()).toBe("2026-03-08T08:00:00.000Z")
    })

    it("falls back to UTC for an unrecognized zone rather than throwing", () => {
      const instant = new Date("2026-06-12T03:00:00Z")
      const start = startOfDayInZone(instant, "Not/AZone")
      expect(start.toISOString()).toBe("2026-06-12T00:00:00.000Z")
    })
  })

  describe("startOfWeekInZone", () => {
    it("starts the week on Sunday in the seller's zone", () => {
      // Thursday 2026-06-11 in LA → week began Sunday 2026-06-07.
      const instant = new Date("2026-06-11T19:00:00Z")
      const start = startOfWeekInZone(instant, "America/Los_Angeles")
      expect(start.toISOString()).toBe("2026-06-07T07:00:00.000Z")
    })

    it("returns the same day when it is already Sunday", () => {
      const instant = new Date("2026-06-07T19:00:00Z") // Sunday noon PDT
      const start = startOfWeekInZone(instant, "America/Los_Angeles")
      expect(start.toISOString()).toBe("2026-06-07T07:00:00.000Z")
    })
  })

  describe("startOfPermitYearInZone", () => {
    it("uses the calendar year when the permit year starts in January", () => {
      const instant = new Date("2026-06-12T12:00:00Z")
      const start = startOfPermitYearInZone(instant, "America/Los_Angeles", 1)
      expect(start.toISOString()).toBe("2026-01-01T08:00:00.000Z")
    })

    it("reaches back to last year when the start month is still ahead", () => {
      // Permit year starts in October; in June we're inside the period that
      // began the previous October.
      const instant = new Date("2026-06-12T12:00:00Z")
      const start = startOfPermitYearInZone(instant, "America/Los_Angeles", 10)
      expect(start.toISOString()).toBe("2025-10-01T07:00:00.000Z")
    })

    it("stays in the current year once the start month has passed", () => {
      const instant = new Date("2026-11-05T12:00:00Z")
      const start = startOfPermitYearInZone(instant, "America/Los_Angeles", 10)
      expect(start.toISOString()).toBe("2026-10-01T07:00:00.000Z")
    })

    it("returns the exclusive period end one permit year later", () => {
      const instant = new Date("2026-06-12T12:00:00Z")
      const end = startOfPermitYearInZone(instant, "America/Los_Angeles", 10, 1)
      expect(end.toISOString()).toBe("2026-10-01T07:00:00.000Z")
    })

    it("clamps a nonsense start month instead of drifting the window", () => {
      const instant = new Date("2026-06-12T12:00:00Z")
      expect(
        startOfPermitYearInZone(instant, "America/Los_Angeles", 0).toISOString()
      ).toBe("2026-01-01T08:00:00.000Z")
      expect(
        startOfPermitYearInZone(instant, "America/Los_Angeles", 99).toISOString()
      ).toBe("2025-12-01T08:00:00.000Z")
    })
  })

  describe("daysUntil", () => {
    const now = new Date("2026-06-12T12:00:00Z")

    it("counts whole days ahead", () => {
      expect(daysUntil(new Date("2026-06-26T12:00:00Z"), now)).toBe(14)
    })

    it("goes negative once the date has passed", () => {
      expect(daysUntil(new Date("2026-06-11T12:00:00Z"), now)).toBe(-1)
    })

    it("reports zero for later today", () => {
      expect(daysUntil(new Date("2026-06-12T23:00:00Z"), now)).toBe(0)
    })
  })
})
