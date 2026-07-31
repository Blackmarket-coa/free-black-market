import { GET } from "../route"

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

const createReq = (graph: jest.Mock, date = "2026-08-01", productId = "prod_1") => ({
  params: { id: productId },
  validatedQuery: { date },
  scope: { resolve: () => ({ graph }) },
})

const variantFor = (date: string, rowType: string, variantId: string, purchases: any[] = []) => ({
  product_variant: {
    id: variantId,
    options: [
      { value: date, option: { title: "Date" } },
      { value: rowType, option: { title: "Row Type" } },
    ],
    ticket_product_variant: { purchases },
  },
})

describe("store ticket-products seats route", () => {
  it("includes venue_row_id on every seat_map row and flags purchased seats", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [
        {
          id: "tp_1",
          product_id: "prod_1",
          venue: {
            id: "ven_1",
            name: "The Vault",
            rows: [
              { id: "row_a", row_number: "A", row_type: "premium", seat_count: 2 },
              { id: "row_b", row_number: "B", row_type: "standard", seat_count: 3 },
            ],
          },
          variants: [
            variantFor("2026-08-01", "premium", "variant_premium", [{ seat_number: "2" }]),
            variantFor("2026-08-01", "standard", "variant_standard"),
          ],
        },
      ],
    })
    const res = createRes()

    await GET(createReq(graph) as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.date).toBe("2026-08-01")
    expect(res.body.seat_map).toEqual([
      {
        row_number: "A",
        row_type: "premium",
        venue_row_id: "row_a",
        seats: [
          { number: "1", is_purchased: false, variant_id: "variant_premium" },
          { number: "2", is_purchased: true, variant_id: "variant_premium" },
        ],
      },
      {
        row_number: "B",
        row_type: "standard",
        venue_row_id: "row_b",
        seats: [
          { number: "1", is_purchased: false, variant_id: "variant_standard" },
          { number: "2", is_purchased: false, variant_id: "variant_standard" },
          { number: "3", is_purchased: false, variant_id: "variant_standard" },
        ],
      },
    ])
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "ticket_product",
        filters: { product_id: "prod_1" },
      })
    )
  })

  it("returns null variant ids for rows without a variant on the requested date", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [
        {
          id: "tp_1",
          product_id: "prod_1",
          venue: {
            id: "ven_1",
            rows: [{ id: "row_a", row_number: "A", row_type: "premium", seat_count: 1 }],
          },
          variants: [variantFor("2026-09-09", "premium", "variant_other_date")],
        },
      ],
    })
    const res = createRes()

    await GET(createReq(graph) as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.seat_map).toEqual([
      {
        row_number: "A",
        row_type: "premium",
        venue_row_id: "row_a",
        seats: [{ number: "1", is_purchased: false, variant_id: null }],
      },
    ])
  })

  it("throws not-found for a product without a ticket product", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [] })
    const res = createRes()

    await expect(GET(createReq(graph, "2026-08-01", "prod_missing") as any, res)).rejects.toThrow(
      "Ticket product not found"
    )
  })
})
