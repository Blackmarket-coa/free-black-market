import { asExpiryDate, daysUntil, isExpired, MS_PER_DAY } from "../expiry"
import { daysUntilExpiry, isDocumentExpired } from "../../modules/document-vault/document-status"
import { daysUntil as cottageDaysUntil } from "../../modules/cottage-food/utils/time"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const at = (hoursFromNow: number) =>
  new Date(NOW.getTime() + hoursFromNow * 3_600_000)

describe("shared/expiry — the one day-count convention", () => {
  describe("daysUntil", () => {
    it("counts whole days still to run", () => {
      expect(daysUntil(at(36), NOW)).toBe(1)
      expect(daysUntil(at(12), NOW)).toBe(0)
      expect(daysUntil(at(24 * 30), NOW)).toBe(30)
    })

    it("goes negative the instant a date passes, not a day later", () => {
      // This is the whole reason the convention is floor. `Math.ceil` maps
      // every one of these to -0, and `-0 < 0` is false, so a lapsed
      // certificate reads as still valid for a further 24 hours.
      expect(daysUntil(at(-1), NOW)).toBe(-1)
      expect(daysUntil(at(-12), NOW)).toBe(-1)
      expect(daysUntil(at(-23), NOW)).toBe(-1)

      expect(Math.ceil((at(-12).getTime() - NOW.getTime()) / MS_PER_DAY)).toBe(-0)
      expect(Math.ceil((at(-12).getTime() - NOW.getTime()) / MS_PER_DAY) < 0).toBe(false)
      expect(daysUntil(at(-12), NOW) < 0).toBe(true)
    })

    it("is exactly 0 at the instant of expiry", () => {
      expect(daysUntil(NOW, NOW)).toBe(0)
    })
  })

  describe("isExpired", () => {
    it("compares at the instant, not the calendar day", () => {
      expect(isExpired(at(-1), NOW)).toBe(true)
      expect(isExpired(at(1), NOW)).toBe(false)
      // Not yet past at the exact instant.
      expect(isExpired(NOW, NOW)).toBe(false)
    })

    it("is finer than daysUntil < 0: a date later today has not lapsed", () => {
      const laterToday = at(6)
      expect(daysUntil(laterToday, NOW)).toBe(0)
      expect(isExpired(laterToday, NOW)).toBe(false)
    })
  })

  describe("asExpiryDate", () => {
    it("treats absent and unparseable alike as no expiry", () => {
      expect(asExpiryDate(null)).toBeNull()
      expect(asExpiryDate(undefined)).toBeNull()
      expect(asExpiryDate("")).toBeNull()
      expect(asExpiryDate("not a date")).toBeNull()
    })

    it("accepts Date, ISO string and epoch millis", () => {
      expect(asExpiryDate(NOW)?.toISOString()).toBe(NOW.toISOString())
      expect(asExpiryDate(NOW.toISOString())?.toISOString()).toBe(NOW.toISOString())
      expect(asExpiryDate(NOW.getTime())?.toISOString()).toBe(NOW.toISOString())
    })
  })

  describe("agreement with the counts it replaces", () => {
    // Adopting the shared convention must not change either of the two
    // existing implementations that already used floor. If one of these ever
    // fails, the convention has drifted from a live caller.
    const offsets = [-72, -36, -24, -12, -1, 0, 1, 12, 24, 36, 72, 24 * 45]

    it("matches document-vault's daysUntilExpiry exactly", () => {
      for (const h of offsets) {
        const expires = at(h)
        expect(daysUntil(expires, NOW)).toBe(
          daysUntilExpiry({ expires_at: expires }, NOW)
        )
      }
    })

    it("matches cottage-food's daysUntil exactly", () => {
      for (const h of offsets) {
        expect(daysUntil(at(h), NOW)).toBe(cottageDaysUntil(at(h), NOW))
      }
    })

    it("matches document-vault's expiry test exactly", () => {
      for (const h of offsets) {
        const expires = at(h)
        expect(isExpired(expires, NOW)).toBe(
          isDocumentExpired({ expires_at: expires }, NOW)
        )
      }
    })
  })
})
