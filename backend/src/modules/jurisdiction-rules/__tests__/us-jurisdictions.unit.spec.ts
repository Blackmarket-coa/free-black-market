import {
  US_JURISDICTIONS,
  isUsJurisdictionCode,
  normalizeUsJurisdiction,
  usJurisdictionName,
} from "../us-jurisdictions"

describe("US jurisdictions", () => {
  it("lists the fifty states and DC, each once, by ISO 3166-2 code", () => {
    expect(US_JURISDICTIONS).toHaveLength(51)
    expect(new Set(US_JURISDICTIONS.map((j) => j.code)).size).toBe(51)
    expect(new Set(US_JURISDICTIONS.map((j) => j.postal)).size).toBe(51)
    expect(new Set(US_JURISDICTIONS.map((j) => j.name)).size).toBe(51)
    for (const j of US_JURISDICTIONS) {
      expect(j.code).toBe(`US-${j.postal}`)
      expect(j.postal).toMatch(/^[A-Z]{2}$/)
    }
    expect(US_JURISDICTIONS.map((j) => j.code)).toContain("US-DC")
    // Territories are not states; no rule program has been read for one.
    for (const territory of ["US-PR", "US-GU", "US-VI", "US-AS", "US-MP", "US-UM"]) {
      expect(isUsJurisdictionCode(territory)).toBe(false)
    }
  })

  it.each([
    ["SC", "US-SC"],
    ["sc", "US-SC"],
    [" sc ", "US-SC"],
    ["S.C.", "US-SC"],
    ["s. c.", "US-SC"],
    ["S C", "US-SC"],
    ["South Carolina", "US-SC"],
    ["south carolina", "US-SC"],
    ["  SOUTH   CAROLINA ", "US-SC"],
    ["us-sc", "US-SC"],
    ["US-SC", "US-SC"],
    ["US SC", "US-SC"],
    ["us-s.c.", "US-SC"],
    ["North Carolina", "US-NC"],
    ["NC", "US-NC"],
    ["New York", "US-NY"],
    ["N.Y.", "US-NY"],
    ["West Virginia", "US-WV"],
    ["Virginia", "US-VA"],
    ["Washington", "US-WA"],
    ["District of Columbia", "US-DC"],
    ["DC", "US-DC"],
    ["D.C.", "US-DC"],
    ["Washington DC", "US-DC"],
    ["Washington, D.C.", "US-DC"],
    ["Georgia", "US-GA"],
    ["HI", "US-HI"],
  ])("reads %p as %s", (input, expected) => {
    expect(normalizeUsJurisdiction(input)).toBe(expected)
  })

  it.each([
    [""],
    ["   "],
    ["S. Car."],
    ["Carolina"],
    ["Sth Carolina"],
    ["South Carolina, USA"],
    ["Charleston County, SC"],
    ["Riverside County, CA"],
    ["US"],
    ["U.S."],
    ["USSC"],
    ["us-south carolina"],
    ["ZZ"],
    ["US-ZZ"],
    ["PR"],
    ["Puerto Rico"],
    ["Calif."],
    ["29401"],
    ["SCX"],
    ["CA-SC"],
  ])("does not guess at %p", (input) => {
    expect(normalizeUsJurisdiction(input)).toBeNull()
  })

  it("returns null for anything that is not a string", () => {
    for (const input of [null, undefined, 45, {}, ["SC"], true]) {
      expect(normalizeUsJurisdiction(input)).toBeNull()
    }
  })

  it("reads every state's own code, postal code and name back to its code", () => {
    for (const j of US_JURISDICTIONS) {
      expect(normalizeUsJurisdiction(j.code)).toBe(j.code)
      expect(normalizeUsJurisdiction(j.code.toLowerCase())).toBe(j.code)
      expect(normalizeUsJurisdiction(j.postal)).toBe(j.code)
      expect(normalizeUsJurisdiction(j.name)).toBe(j.code)
      expect(normalizeUsJurisdiction(j.name.toUpperCase())).toBe(j.code)
      expect(usJurisdictionName(j.code)).toBe(j.name)
    }
    expect(usJurisdictionName("US-ZZ")).toBeNull()
    expect(usJurisdictionName("SC")).toBeNull()
  })
})
