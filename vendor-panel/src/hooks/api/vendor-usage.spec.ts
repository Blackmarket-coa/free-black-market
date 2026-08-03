import { describe, expect, it } from "vitest"

import { describeUsage, type ResourceUsage } from "./vendor-usage"

const resource = (over: Partial<ResourceUsage> = {}): ResourceUsage => ({
  key: "embed_keys",
  label: "Embed keys",
  current: 1,
  limit: 10,
  remaining: 9,
  percent_used: 10,
  level: "ok",
  unlimited: false,
  ...over,
})

describe("describeUsage", () => {
  it("stays quiet well under the limit", () => {
    const display = describeUsage(resource())
    expect(display.amount).toBe("1 of 10")
    expect(display.tone).toBe("grey")
    expect(display.hint).toBeNull()
  })

  it("warns with the headroom left when approaching", () => {
    const display = describeUsage(
      resource({ current: 8, remaining: 2, level: "approaching" })
    )
    expect(display.tone).toBe("orange")
    expect(display.hint).toBe("2 left on your plan.")
  })

  it("says 1 left, not 1s left, at the last slot", () => {
    const display = describeUsage(
      resource({ current: 9, remaining: 1, level: "approaching" })
    )
    expect(display.hint).toBe("1 left on your plan.")
  })

  it("calls for an upgrade at the ceiling", () => {
    const display = describeUsage(
      resource({ current: 10, remaining: 0, level: "at_limit" })
    )
    expect(display.tone).toBe("red")
    expect(display.hint).toMatch(/upgrade/i)
  })

  it("shows a bare count when the allowance is unlimited", () => {
    // "3 of null" or "3 of ∞" would invite the reader to work out a fraction
    // that does not exist.
    const display = describeUsage(
      resource({
        current: 3,
        limit: null,
        remaining: null,
        percent_used: null,
        unlimited: true,
      })
    )
    expect(display.amount).toBe("3")
    expect(display.tone).toBe("grey")
    expect(display.hint).toBeNull()
  })
})
