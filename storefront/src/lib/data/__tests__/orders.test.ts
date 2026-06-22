import { beforeEach, describe, expect, it, vi } from "vitest"

const { medusaFetch, requestTransfer, acceptTransfer, declineTransfer } =
  vi.hoisted(() => ({
    medusaFetch: vi.fn(),
    requestTransfer: vi.fn(),
    acceptTransfer: vi.fn(),
    declineTransfer: vi.fn(),
  }))

vi.mock("@/lib/config", () => ({
  medusaFetch,
  sdk: {
    store: {
      order: { requestTransfer, acceptTransfer, declineTransfer },
    },
  },
}))

vi.mock("@/lib/data/cookies", () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer t" }),
  getCacheOptions: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  acceptTransferRequest,
  createReturnRequest,
  createTransferRequest,
  declineTransferRequest,
  getReturns,
  listOrders,
  retrieveOrder,
  retrieveOrderSet,
  retrieveReturnReasons,
  retriveReturnMethods,
} from "@/lib/data/orders"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("listOrders", () => {
  it("returns the orders array and forwards pagination/filters in the query", async () => {
    medusaFetch.mockResolvedValue({ orders: [{ id: "order_1" }] })

    await expect(listOrders(5, 10, { status: "completed" })).resolves.toEqual([
      { id: "order_1" },
    ])
    expect(medusaFetch).toHaveBeenCalledWith(
      "/store/orders",
      expect.objectContaining({
        query: expect.objectContaining({
          limit: 5,
          offset: 10,
          status: "completed",
        }),
      })
    )
  })

  it("throws via medusaError when the fetch rejects", async () => {
    medusaFetch.mockRejectedValue(new Error("boom"))
    await expect(listOrders()).rejects.toThrow()
  })
})

describe("getReturns", () => {
  it("returns the response on success", async () => {
    medusaFetch.mockResolvedValue({ order_return_requests: [{ id: "ret_1" }] })
    await expect(getReturns()).resolves.toEqual({
      order_return_requests: [{ id: "ret_1" }],
    })
  })

  it("falls back to an empty list on error", async () => {
    medusaFetch.mockRejectedValue(new Error("fail"))
    await expect(getReturns()).resolves.toEqual({ order_return_requests: [] })
  })
})

describe("retriveReturnMethods / retrieveReturnReasons", () => {
  it("returns shipping_options on success and [] on error", async () => {
    medusaFetch.mockResolvedValueOnce({ shipping_options: [{ id: "so_1" }] })
    await expect(retriveReturnMethods("order_1")).resolves.toEqual([
      { id: "so_1" },
    ])

    medusaFetch.mockRejectedValueOnce(new Error("fail"))
    await expect(retriveReturnMethods("order_1")).resolves.toEqual([])
  })

  it("returns return_reasons on success and [] on error", async () => {
    medusaFetch.mockResolvedValueOnce({ return_reasons: [{ id: "rr_1" }] })
    await expect(retrieveReturnReasons()).resolves.toEqual([{ id: "rr_1" }])

    medusaFetch.mockRejectedValueOnce(new Error("fail"))
    await expect(retrieveReturnReasons()).resolves.toEqual([])
  })
})

describe("retrieveOrder / retrieveOrderSet / createReturnRequest", () => {
  it("retrieveOrder returns the order", async () => {
    medusaFetch.mockResolvedValue({ order: { id: "order_1" } })
    await expect(retrieveOrder("order_1")).resolves.toEqual({ id: "order_1" })
  })

  it("retrieveOrderSet returns the order_set", async () => {
    medusaFetch.mockResolvedValue({ order_set: { id: "os_1" } })
    await expect(retrieveOrderSet("os_1")).resolves.toEqual({ id: "os_1" })
  })

  it("createReturnRequest returns the response payload", async () => {
    medusaFetch.mockResolvedValue({ order_return_request: { id: "ret_1" } })
    await expect(
      createReturnRequest({
        order_id: "order_1",
        customer_note: "",
        shipping_option_id: "so_1",
        line_items: [],
      })
    ).resolves.toEqual({ order_return_request: { id: "ret_1" } })
  })
})

describe("transfer requests", () => {
  const formData = (id?: string) => {
    const fd = new FormData()
    if (id) fd.set("order_id", id)
    return fd
  }

  it("createTransferRequest errors when order_id is missing", async () => {
    const res = await createTransferRequest(
      { success: false, error: null, order: null },
      formData()
    )
    expect(res).toEqual({
      success: false,
      error: "Order ID is required",
      order: null,
    })
    expect(requestTransfer).not.toHaveBeenCalled()
  })

  it("createTransferRequest succeeds and returns the order", async () => {
    requestTransfer.mockResolvedValue({ order: { id: "order_1" } })
    const res = await createTransferRequest(
      { success: false, error: null, order: null },
      formData("order_1")
    )
    expect(res).toEqual({ success: true, error: null, order: { id: "order_1" } })
  })

  it("createTransferRequest returns the error message on failure", async () => {
    requestTransfer.mockRejectedValue(new Error("nope"))
    const res = await createTransferRequest(
      { success: false, error: null, order: null },
      formData("order_1")
    )
    expect(res).toEqual({ success: false, error: "nope", order: null })
  })

  it("acceptTransferRequest / declineTransferRequest map to success", async () => {
    acceptTransfer.mockResolvedValue({ order: { id: "o1" } })
    await expect(acceptTransferRequest("o1", "tok")).resolves.toEqual({
      success: true,
      error: null,
      order: { id: "o1" },
    })

    declineTransfer.mockResolvedValue({ order: { id: "o1" } })
    await expect(declineTransferRequest("o1", "tok")).resolves.toEqual({
      success: true,
      error: null,
      order: { id: "o1" },
    })
  })
})
