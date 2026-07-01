import { describe, expect, it } from "vitest"
import { z } from "zod"

import { fetchResource, parseResponse, USE_MOCK_DATA } from "./index"

const Schema = z.object({ summary: z.object({ total: z.number() }) })

describe("parseResponse", () => {
  it("returns the value when it matches the schema", () => {
    expect(parseResponse(Schema, { summary: { total: 3 } })).toEqual({
      summary: { total: 3 },
    })
  })
  it("throws on a shape mismatch", () => {
    expect(() => parseResponse(Schema, { summary: {} })).toThrow()
  })
})

describe("fetchResource", () => {
  // In the test env VITE_USE_MOCK_DATA is unset, so the mock seam is active and
  // no network call is made.
  it("defaults to the mock seam", () => {
    expect(USE_MOCK_DATA).toBe(true)
  })
  it("resolves the typed mock while USE_MOCK_DATA is on", async () => {
    const mock = { total: 42 }
    const result = await fetchResource("/vendor/anything", Schema, {
      mock,
      pick: (r) => ({ total: r.summary.total }),
    })
    expect(result).toEqual(mock)
  })
})
