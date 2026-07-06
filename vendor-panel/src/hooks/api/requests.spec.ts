import { describe, expect, it } from "vitest"

import {
  normalizeReturnDetailResponse,
  normalizeReturnListResponse,
} from "./requests"

describe("order return request normalization (/vendor/returns)", () => {
  it("maps a returns list payload onto order_return_request + count", () => {
    const payload = {
      returns: [{ id: "ret_1" }, { id: "ret_2" }],
      count: 2,
      offset: 0,
      limit: 10,
    }

    expect(normalizeReturnListResponse(payload)).toEqual({
      order_return_request: [{ id: "ret_1" }, { id: "ret_2" }],
      count: 2,
    })
  })

  it("defaults count to 0 and passes undefined through for an empty list payload", () => {
    expect(normalizeReturnListResponse(undefined)).toEqual({
      order_return_request: undefined,
      count: 0,
    })

    expect(normalizeReturnListResponse({ returns: [] })).toEqual({
      order_return_request: [],
      count: 0,
    })
  })

  it("maps a single return payload onto order_return_request", () => {
    const payload = { return: { id: "ret_1", status: "requested" } }

    expect(normalizeReturnDetailResponse(payload)).toEqual({
      order_return_request: { id: "ret_1", status: "requested" },
    })
  })

  it("tolerates a missing detail payload", () => {
    expect(normalizeReturnDetailResponse(undefined)).toEqual({
      order_return_request: undefined,
    })
  })
})
