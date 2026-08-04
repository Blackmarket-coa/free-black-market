import {
  DEFAULT_WHOLESALE_RATIO,
  FAIRE_MAX_IMAGES,
  FAIRE_MAX_NAME_LENGTH,
  mapFaireOrder,
  mapProductToFaire,
} from "../mapping"
import type { ChannelProduct } from "../types"

/**
 * The roadmap is explicit that schema translation is the hard part and the
 * HTTP is not. These are the cases where the obvious mapping is wrong in a way
 * that costs a vendor money or fills their catalogue with duplicates.
 */

const product = (overrides: Partial<ChannelProduct> = {}): ChannelProduct => ({
  id: "prod_1",
  title: "Sourdough Starter",
  description: "A living culture.",
  sku: "SD-001",
  price_amount: 1_200,
  currency_code: "usd",
  inventory_quantity: 40,
  images: ["https://cdn.example.com/a.jpg"],
  categories: ["Food & Drink"],
  weight_grams: 250,
  active: true,
  ...overrides,
})

describe("mapProductToFaire", () => {
  it("maps a complete product", () => {
    const result = mapProductToFaire(product())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toMatchObject({
      name: "Sourdough Starter",
      sku: "SD-001",
      retail_price_cents: 1_200,
      wholesale_price_cents: 600,
      currency: "USD",
      available_quantity: 40,
      active: true,
    })
    expect(result.value.images).toEqual([
      { url: "https://cdn.example.com/a.jpg" },
    ])
    expect(result.warnings).toEqual([])
  })

  it("refuses a product with no SKU", () => {
    // The most damaging thing this mapper could do. Faire matches updates on
    // SKU, so pushing without one creates a duplicate listing on every sync
    // rather than updating the original.
    const result = mapProductToFaire(product({ sku: null }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.field)).toContain("sku")
  })

  it("treats whitespace as absent, not as a SKU", () => {
    const result = mapProductToFaire(product({ sku: "   " }))
    expect(result.ok).toBe(false)
  })

  it("refuses a zero or negative price rather than listing it free", () => {
    // A misconfigured price reaching a live wholesale catalogue is a real loss
    // and exactly what an integration gets blamed for.
    for (const price of [0, -100, Number.NaN]) {
      const result = mapProductToFaire(product({ price_amount: price }))
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.problems.map((p) => p.field)).toContain("price_amount")
    }
  })

  it("refuses an over-long name rather than silently truncating it", () => {
    // A cut-off title is a listing the vendor never approved.
    const result = mapProductToFaire(
      product({ title: "x".repeat(FAIRE_MAX_NAME_LENGTH + 1) })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0].reason).toContain(String(FAIRE_MAX_NAME_LENGTH))
  })

  it("reports every problem at once, not just the first", () => {
    // A vendor with fifty products should not fix them one round trip at a
    // time.
    const result = mapProductToFaire(
      product({ sku: null, price_amount: 0, title: "", currency_code: "" })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.length).toBeGreaterThanOrEqual(4)
  })

  it("lists untracked stock as zero rather than claiming availability", () => {
    // `null` means FBM is not counting. Telling a wholesale buyer stock exists
    // when nothing tracks it produces oversells the vendor absorbs.
    const result = mapProductToFaire(product({ inventory_quantity: null }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.available_quantity).toBe(0)
    expect(result.warnings.map((w) => w.field)).toContain("inventory_quantity")
  })

  it("never sends negative stock", () => {
    const result = mapProductToFaire(product({ inventory_quantity: -5 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.available_quantity).toBe(0)
  })

  it("rounds the wholesale price rather than flooring it", () => {
    // Flooring every product biases a whole catalogue a cent low, which over a
    // wholesale order of hundreds of units is a systematic giveaway.
    const result = mapProductToFaire(product({ price_amount: 1_001 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wholesale_price_cents).toBe(501)
    expect(DEFAULT_WHOLESALE_RATIO).toBe(0.5)
  })

  it("never maps a real price down to zero", () => {
    const result = mapProductToFaire(product({ price_amount: 1 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wholesale_price_cents).toBeGreaterThanOrEqual(1)
  })

  it("honours a vendor's own wholesale ratio", () => {
    const result = mapProductToFaire(product(), { wholesaleRatio: 0.7 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wholesale_price_cents).toBe(840)
  })

  it("caps images and says so rather than dropping them silently", () => {
    const many = Array.from({ length: FAIRE_MAX_IMAGES + 3 }, (_, i) =>
      `https://cdn.example.com/${i}.jpg`
    )
    const result = mapProductToFaire(product({ images: many }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.images).toHaveLength(FAIRE_MAX_IMAGES)
    expect(result.warnings.map((w) => w.field)).toContain("images")
  })

  it("carries an inactive product through as inactive", () => {
    // Not an error: a vendor unpublishing a product should unpublish it on the
    // channel too, not have the push refuse and leave it live to buyers.
    const result = mapProductToFaire(product({ active: false }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.active).toBe(false)
  })
})

describe("mapFaireOrder", () => {
  const raw = {
    id: "bo_123",
    created_at: "2026-08-01T10:00:00.000Z",
    customer: { name: "Corner Store", email: "buyer@example.com" },
    address: { city: "Portland" },
    payout_costs: { commission_cents: 300, payout_fee_cents: 45 },
    items: [
      { sku: "SD-001", product_name: "Starter", quantity: 4, price_cents: 600 },
      { sku: "SD-002", product_name: "Flour", quantity: 2, price_cents: 900 },
    ],
  }

  it("maps an order into FBM's vocabulary", () => {
    const order = mapFaireOrder(raw)
    expect(order).not.toBeNull()
    expect(order).toMatchObject({
      external_id: "bo_123",
      buyer_name: "Corner Store",
      buyer_email: "buyer@example.com",
      total_amount: 4 * 600 + 2 * 900,
    })
    expect(order?.items).toHaveLength(2)
  })

  it("carries the channel's own cut rather than dropping it", () => {
    // Faire takes its commission before money reaches the vendor. An order
    // imported at gross overstates what they earned — the reconciliation gap
    // Phase 11 exists to close, and capturing it now is free.
    expect(mapFaireOrder(raw)?.channel_fee_amount).toBe(345)
  })

  it("reports no fee rather than zero when the channel reports none", () => {
    const order = mapFaireOrder({ ...raw, payout_costs: {} })
    expect(order?.channel_fee_amount).toBeNull()
  })

  it("refuses an order with no channel id", () => {
    // `external_id` is the idempotency key. Without it the order re-imports on
    // every poll, duplicating the vendor's revenue figures.
    expect(mapFaireOrder({ ...raw, id: undefined })).toBeNull()
    expect(mapFaireOrder({ ...raw, id: "  " })).toBeNull()
  })

  it("falls back to the epoch rather than an Invalid Date", () => {
    // An Invalid Date poisons every comparison downstream silently.
    const order = mapFaireOrder({ ...raw, created_at: "not-a-date" })
    expect(order?.placed_at.getTime()).toBe(0)

    const missing = mapFaireOrder({ ...raw, created_at: undefined })
    expect(Number.isNaN(missing?.placed_at.getTime())).toBe(false)
  })

  it("survives an order with no items", () => {
    const order = mapFaireOrder({ ...raw, items: undefined })
    expect(order?.items).toEqual([])
    expect(order?.total_amount).toBe(0)
  })

  it("clamps nonsense quantities and prices", () => {
    const order = mapFaireOrder({
      ...raw,
      items: [
        { sku: "X", product_name: "X", quantity: -3, price_cents: -100 },
        { sku: "Y", product_name: "Y", quantity: 2.7, price_cents: 100.9 },
      ],
    })
    expect(order?.items[0]).toMatchObject({ quantity: 0, unit_amount: 0 })
    expect(order?.items[1]).toMatchObject({ quantity: 2, unit_amount: 100 })
  })

  it("keeps the raw payload for diagnosing a mismatch", () => {
    expect(mapFaireOrder(raw)?.raw).toMatchObject({ id: "bo_123" })
  })
})
