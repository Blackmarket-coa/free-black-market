import { describe, expect, it } from "vitest"
import {
  formatMonthAriaLabel,
  isPhenologyStatus,
  MONTH_LABELS,
  MONTH_NAMES_LONG,
  PHENOLOGY_STATUSES,
  sanitizePhenologyYear,
  STATUS_BG_CLASS,
  STATUS_LABELS,
  type PhenologyStatus,
} from "@/components/atoms/PhenologyBar/phenology"

describe("phenology: status taxonomy", () => {
  it("ships the five canonical statuses in stable order", () => {
    expect(PHENOLOGY_STATUSES).toEqual([
      "dormant",
      "planting",
      "growing",
      "harvest",
      "preserved",
    ])
  })

  it("has exactly one label, color class, and description per status", () => {
    for (const status of PHENOLOGY_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy()
      expect(STATUS_BG_CLASS[status]).toMatch(/^bg-/)
    }
  })
})

describe("phenology: month taxonomy", () => {
  it("exposes 12 short month labels", () => {
    expect(MONTH_LABELS).toHaveLength(12)
  })

  it("exposes 12 long month names", () => {
    expect(MONTH_NAMES_LONG).toHaveLength(12)
    expect(MONTH_NAMES_LONG[0]).toBe("January")
    expect(MONTH_NAMES_LONG[11]).toBe("December")
  })
})

describe("phenology: isPhenologyStatus", () => {
  it.each(PHENOLOGY_STATUSES)("accepts %s", (s) => {
    expect(isPhenologyStatus(s)).toBe(true)
  })

  it.each(["Dormant", "off", "", null, undefined, 1])("rejects %p", (v) => {
    expect(isPhenologyStatus(v)).toBe(false)
  })
})

describe("phenology: sanitizePhenologyYear", () => {
  const fillStatus = (s: PhenologyStatus): PhenologyStatus[] =>
    Array.from({ length: 12 }, () => s)

  it("passes through a valid year unchanged", () => {
    const year = fillStatus("growing")
    expect(sanitizePhenologyYear(year)).toEqual(year)
  })

  it("coerces invalid cells to dormant", () => {
    const messy = [
      "growing",
      "harvest",
      "off", // invalid
      null, // invalid
      undefined, // invalid
      "preserved",
      "planting",
      "harvest",
      "harvest",
      "dormant",
      "dormant",
      "dormant",
    ]
    const sanitized = sanitizePhenologyYear(messy)
    expect(sanitized).toEqual([
      "growing",
      "harvest",
      "dormant",
      "dormant",
      "dormant",
      "preserved",
      "planting",
      "harvest",
      "harvest",
      "dormant",
      "dormant",
      "dormant",
    ])
  })

  it("throws on a wrong-length year (caller programming error)", () => {
    expect(() => sanitizePhenologyYear([])).toThrow(/12 entries/)
    expect(() => sanitizePhenologyYear(fillStatus("growing").slice(0, 11))).toThrow(
      /12 entries/
    )
    expect(() =>
      sanitizePhenologyYear([...fillStatus("growing"), "growing"])
    ).toThrow(/12 entries/)
  })
})

describe("phenology: formatMonthAriaLabel", () => {
  it("composes 'Month: Status'", () => {
    expect(formatMonthAriaLabel(0, "growing")).toBe("January: Growing")
    expect(formatMonthAriaLabel(7, "harvest")).toBe("August: Harvest")
    expect(formatMonthAriaLabel(11, "preserved")).toBe("December: Preserved")
  })

  it("falls back gracefully for out-of-range month indices", () => {
    expect(formatMonthAriaLabel(99, "dormant")).toBe("Month 100: Dormant")
  })
})
