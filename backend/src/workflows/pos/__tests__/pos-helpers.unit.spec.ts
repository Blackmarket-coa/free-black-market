import { buildPosOrderMetadata, shapePosItems } from "../pos-helpers"

describe("shapePosItems", () => {
  it("shapes catalog items: quantity default 1, rounded minor-unit price, pos_sale tag", () => {
    const result = shapePosItems([
      { variant_id: "var_1", unit_price: 1500 },
      { variant_id: "var_2", unit_price: 999.6, quantity: 2 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0]).toEqual({
      variant_id: "var_1",
      product_id: undefined,
      title: "POS item",
      quantity: 1,
      unit_price: 1500,
      metadata: { pos_sale: true },
    })
    expect(result.items[1].quantity).toBe(2)
    expect(result.items[1].unit_price).toBe(1000)
  })

  it("accepts ad-hoc items with a title and no variant", () => {
    const result = shapePosItems([{ title: " Fresh eggs ", unit_price: 500 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0].title).toBe("Fresh eggs")
    expect(result.items[0].variant_id).toBeUndefined()
  })

  it("rejects an empty item list", () => {
    expect(shapePosItems([])).toMatchObject({ ok: false })
  })

  it("rejects negative / non-finite prices with the item index", () => {
    const r1 = shapePosItems([{ variant_id: "v", unit_price: -1 }])
    expect(r1).toMatchObject({ ok: false })
    if (!r1.ok) expect(r1.message).toContain("items[0]")
    expect(shapePosItems([{ variant_id: "v", unit_price: NaN }])).toMatchObject({ ok: false })
  })

  it("rejects zero/negative quantities", () => {
    expect(
      shapePosItems([{ variant_id: "v", unit_price: 100, quantity: 0 }])
    ).toMatchObject({ ok: false })
  })

  it("rejects items with neither variant_id nor title", () => {
    const r = shapePosItems([
      { variant_id: "v", unit_price: 100 },
      { unit_price: 100, title: "  " },
    ])
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.message).toContain("items[1]")
  })
})

describe("buildPosOrderMetadata", () => {
  it("stamps the pos channel + operator context", () => {
    expect(
      buildPosOrderMetadata({ seller_id: "seller_1", payment_method: "card", note: "market stall" })
    ).toEqual({
      order_channel: "pos",
      pos_seller_id: "seller_1",
      pos_payment_method: "card",
      pos_note: "market stall",
    })
  })

  it("defaults payment method to cash and omits an absent note", () => {
    const md = buildPosOrderMetadata({ seller_id: "seller_1" })
    expect(md).toEqual({
      order_channel: "pos",
      pos_seller_id: "seller_1",
      pos_payment_method: "cash",
    })
    expect("pos_note" in md).toBe(false)
  })
})
