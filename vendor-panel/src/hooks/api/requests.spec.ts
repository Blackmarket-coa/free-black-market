import { describe, expect, it } from "vitest"

import {
  normalizeReturnDetailResponse,
  normalizeReturnListResponse,
} from "./requests"

/**
 * The payloads below are the shapes Mercur's `/vendor/returns` routes
 * actually answer (b2c-core 1.5.0), read with this panel's own `fields` on a
 * real database by backend/integration-tests/http/store-return-request.spec.ts
 * ("files a buyer's return ... and shows it to the seller"). The list queries
 * the seller–return link, so the return is nested under `return`; the detail
 * answers `return` as an array. An earlier version of this spec pinned flat
 * objects, which is not what the server sends, and the table rendered blank.
 */

const ret = (id: string) => ({
  id,
  status: "requested",
  created_at: "2026-11-15T10:00:00.000Z",
  order: { id: "order_1", display_id: 7, customer: { id: "cus_1", email: "b@example.com" } },
  items: [{ id: "retitem_1", item_id: "ordli_1", quantity: 1 }],
})

describe("order return request normalization (/vendor/returns)", () => {
  it("unwraps the link rows of a returns list onto order_return_request + count", () => {
    const payload = {
      returns: [{ return: ret("ret_1") }, { return_id: "ret_2", return: ret("ret_2") }],
      count: 2,
      offset: 0,
      limit: 10,
    }

    const { order_return_request, count } = normalizeReturnListResponse(payload)
    expect(count).toBe(2)
    expect(order_return_request).toEqual([ret("ret_1"), ret("ret_2")])
    // What the table reads: the row id (getRowId, the review link) and the
    // order and customer cells.
    expect(order_return_request?.[0].id).toBe("ret_1")
    expect(order_return_request?.[0].order.display_id).toBe(7)
  })

  it("drops a link row whose return is gone, and passes a flat return as it is", () => {
    expect(
      normalizeReturnListResponse({
        returns: [{ return_id: "ret_gone", return: null }, ret("ret_flat")],
        count: 2,
      }).order_return_request
    ).toEqual([ret("ret_flat")])
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

  it("takes the return out of the detail's one-element array", () => {
    expect(normalizeReturnDetailResponse({ return: [ret("ret_1")] })).toEqual({
      order_return_request: ret("ret_1"),
    })
  })

  it("passes a single return object through, and an empty array as nothing", () => {
    expect(normalizeReturnDetailResponse({ return: ret("ret_1") })).toEqual({
      order_return_request: ret("ret_1"),
    })
    expect(normalizeReturnDetailResponse({ return: [] })).toEqual({
      order_return_request: undefined,
    })
  })

  it("tolerates a missing detail payload", () => {
    expect(normalizeReturnDetailResponse(undefined)).toEqual({
      order_return_request: undefined,
    })
  })
})
