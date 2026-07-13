import { describe, expect, it } from "vitest"
import {
  buildPosOrderPayload,
  posLinesTotal,
  toMinorUnits,
} from "./pos-helpers"

describe("toMinorUnits", () => {
  it("converts 2-decimal currencies", () => {
    expect(toMinorUnits(12.5, "usd")).toBe(1250)
    expect(toMinorUnits("12,50", "eur")).toBe(1250)
    expect(toMinorUnits(0.01, "usd")).toBe(1)
  })

  it("handles zero-decimal currencies (no *100!)", () => {
    expect(toMinorUnits(500, "jpy")).toBe(500)
  })

  it("handles three-decimal currencies", () => {
    expect(toMinorUnits(1.234, "kwd")).toBe(1234)
  })

  it("rounds float artifacts", () => {
    expect(toMinorUnits(0.1 + 0.2, "usd")).toBe(30)
  })
})

describe("posLinesTotal", () => {
  it("sums price*qty in major units, skipping unparseable lines", () => {
    expect(
      posLinesTotal([
        { title: "a", quantity: 2, unit_price: "12.50" },
        { title: "b", quantity: 1, unit_price: 5 },
        { title: "c", quantity: "x", unit_price: 99 },
      ])
    ).toBe(30)
  })
})

describe("buildPosOrderPayload", () => {
  const options = { currencyCode: "USD", paymentMethod: "cash" }

  it("builds items with minor-unit prices and lowercased currency", () => {
    const result = buildPosOrderPayload(
      [
        { variant_id: "var_1", title: "Widget", quantity: "2", unit_price: "12.50" },
        { title: "Ad-hoc eggs", quantity: 1, unit_price: 3 },
      ],
      { ...options, note: " market stall ", email: "buyer@example.com" }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload).toEqual({
      items: [
        { variant_id: "var_1", title: "Widget", quantity: 2, unit_price: 1250 },
        { title: "Ad-hoc eggs", quantity: 1, unit_price: 300 },
      ],
      currency_code: "usd",
      payment_method: "cash",
      note: "market stall",
      email: "buyer@example.com",
    })
  })

  it("omits blank note/email", () => {
    const result = buildPosOrderPayload(
      [{ title: "x", quantity: 1, unit_price: 1 }],
      { ...options, note: "  ", email: "" }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect("note" in result.payload).toBe(false)
    expect("email" in result.payload).toBe(false)
  })

  it("rejects an empty ring-up", () => {
    expect(buildPosOrderPayload([], options)).toMatchObject({ ok: false })
  })

  it("rejects a line with no variant and no title, naming the item", () => {
    const result = buildPosOrderPayload(
      [
        { title: "ok", quantity: 1, unit_price: 1 },
        { title: "   ", quantity: 1, unit_price: 1 },
      ],
      options
    )
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.message).toContain("Item 2")
  })

  it("rejects zero/negative quantity and negative price", () => {
    expect(
      buildPosOrderPayload([{ title: "x", quantity: 0, unit_price: 1 }], options)
    ).toMatchObject({ ok: false })
    expect(
      buildPosOrderPayload([{ title: "x", quantity: 1, unit_price: -1 }], options)
    ).toMatchObject({ ok: false })
  })
})
