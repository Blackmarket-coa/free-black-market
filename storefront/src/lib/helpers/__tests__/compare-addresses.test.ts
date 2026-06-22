import { describe, expect, it } from "vitest"
import compareAddresses from "../compare-addresses"

const base = {
  first_name: "Ada",
  last_name: "Lovelace",
  address_1: "1 Analytical Way",
  city: "London",
  country_code: "gb",
}

describe("compareAddresses", () => {
  it("returns true when the compared fields match", () => {
    expect(compareAddresses({ ...base }, { ...base })).toBe(true)
  })

  it("ignores fields outside the compared subset", () => {
    expect(
      compareAddresses(
        { ...base, phone: "123", postal_code: "EC1" },
        { ...base, phone: "999", postal_code: "EC2" }
      )
    ).toBe(true)
  })

  it("returns false when a compared field differs", () => {
    expect(compareAddresses(base, { ...base, city: "Paris" })).toBe(false)
  })

  it("handles nullish inputs without throwing", () => {
    expect(compareAddresses(null, undefined)).toBe(true)
    expect(compareAddresses(base, null)).toBe(false)
  })
})
