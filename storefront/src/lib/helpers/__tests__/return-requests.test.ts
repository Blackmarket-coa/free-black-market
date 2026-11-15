import { describe, expect, it } from "vitest"

import {
  returnRequestedAt,
  sortReturnRequestsNewestFirst,
} from "../return-requests"

describe("returnRequestedAt", () => {
  it("dates a request by its first line", () => {
    expect(
      returnRequestedAt({
        created_at: "2026-11-15T00:00:00.000Z",
        line_items: [
          { line_item_id: "a", created_at: "2026-11-14T00:00:00.000Z" },
        ],
      })
    ).toBe("2026-11-14T00:00:00.000Z")
  })

  it("falls back to the return's own date when there are no lines", () => {
    expect(
      returnRequestedAt({ created_at: "2026-11-15T00:00:00.000Z", line_items: [] })
    ).toBe("2026-11-15T00:00:00.000Z")
    expect(returnRequestedAt({ line_items: [] })).toBeUndefined()
  })
})

describe("sortReturnRequestsNewestFirst", () => {
  it("puts the newest first and undated requests last, without mutating", () => {
    const input = [
      { id: "old", line_items: [{ line_item_id: "a", created_at: "2026-11-01T00:00:00.000Z" }] },
      { id: "undated", line_items: [] },
      { id: "new", created_at: "2026-11-10T00:00:00.000Z", line_items: [] },
    ]
    const sorted = sortReturnRequestsNewestFirst(input)
    expect(sorted.map((r) => r.id)).toEqual(["new", "old", "undated"])
    expect(input.map((r) => r.id)).toEqual(["old", "undated", "new"])
  })
})
