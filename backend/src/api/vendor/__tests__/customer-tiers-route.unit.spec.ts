import { parseTierInput } from "../customer-tiers/route"
import { MAX_TERMS_DAYS } from "../../../modules/accounts-receivable/terms"

describe("vendor customer-tiers: parseTierInput", () => {
  it("requires name and tier_type on create, not on patch", () => {
    expect(parseTierInput({}, { partial: false }).ok).toBe(false)
    expect(parseTierInput({}, { partial: true })).toEqual({ ok: true, data: {} })
  })

  it("accepts a full create", () => {
    const r = parseTierInput(
      {
        name: "Wholesale",
        tier_type: "wholesale",
        payment_terms_days: 30,
        credit_limit_cents: 500_000,
        customer_ids: ["cus_1", "cus_1", "cus_2"],
      },
      { partial: false }
    )
    expect(r).toEqual({
      ok: true,
      data: {
        name: "Wholesale",
        tier_type: "WHOLESALE",
        payment_terms_days: 30,
        credit_limit_cents: 500_000,
        customer_ids: ["cus_1", "cus_2"],
      },
    })
  })

  it("distinguishes null (no limit) from 0 (no credit)", () => {
    // Both are real settings a vendor might choose; see resolveCreditLimitCents.
    expect(parseTierInput({ credit_limit_cents: null }, { partial: true })).toEqual({
      ok: true,
      data: { credit_limit_cents: null },
    })
    expect(parseTierInput({ credit_limit_cents: 0 }, { partial: true })).toEqual({
      ok: true,
      data: { credit_limit_cents: 0 },
    })
  })

  it("refuses a negative or fractional credit limit", () => {
    expect(parseTierInput({ credit_limit_cents: -1 }, { partial: true }).ok).toBe(false)
    expect(parseTierInput({ credit_limit_cents: 10.5 }, { partial: true }).ok).toBe(false)
  })

  it("caps terms at the AR maximum, so a tier cannot promise what AR refuses", () => {
    expect(
      parseTierInput({ payment_terms_days: MAX_TERMS_DAYS }, { partial: true }).ok
    ).toBe(true)
    expect(
      parseTierInput({ payment_terms_days: MAX_TERMS_DAYS + 1 }, { partial: true }).ok
    ).toBe(false)
    expect(parseTierInput({ payment_terms_days: -1 }, { partial: true }).ok).toBe(false)
  })

  it("rejects an unknown tier type", () => {
    expect(parseTierInput({ tier_type: "vip" }, { partial: true }).ok).toBe(false)
  })

  it("rejects non-boolean flags and non-string customer ids", () => {
    expect(parseTierInput({ active: "yes" }, { partial: true }).ok).toBe(false)
    expect(parseTierInput({ customer_ids: ["cus_1", 7] }, { partial: true }).ok).toBe(false)
  })
})
