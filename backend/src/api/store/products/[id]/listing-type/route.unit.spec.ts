import { GET } from "./route"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

const createReq = (graph: jest.Mock, productId = "prod_1") => ({
  params: { id: productId },
  scope: { resolve: () => ({ graph }) },
})

describe("store products listing-type route", () => {
  it("returns the linked catalog_id", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [{ id: "prod_1", listing_type: { catalog_id: "event" } }],
    })
    const res = createRes()

    await GET(createReq(graph) as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ catalog_id: "event" })
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        filters: { id: "prod_1" },
      })
    )
  })

  it("returns catalog_id null when the product has no listing-type link", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [{ id: "prod_1", listing_type: null }],
    })
    const res = createRes()

    await GET(createReq(graph) as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ catalog_id: null })
  })

  it("returns 404 for an unknown product", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [] })
    const res = createRes()

    await GET(createReq(graph, "prod_missing") as any, res)

    expect(res.statusCode).toBe(404)
    expect(res.body.message).toBe("Product not found")
  })

  it("returns 500 when the query fails", async () => {
    const graph = jest.fn().mockRejectedValue(new Error("boom"))
    const res = createRes()

    await GET(createReq(graph) as any, res)

    expect(res.statusCode).toBe(500)
    expect(res.body.message).toBe("Failed to fetch listing type")
  })
})
