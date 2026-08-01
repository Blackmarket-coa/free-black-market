import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../[id]/wholesale/route"
import { VENDOR_RULES_MODULE } from "../../../../modules/vendor-rules"
import { CustomerTierType } from "../../../../modules/vendor-rules/models/vendor-customer-tier"
import {
  BASE_CURRENCY_METADATA_KEY,
  BASE_UNIT_PRICE_METADATA_KEY,
} from "../../../../lib/sliding-scale"
import { WHOLESALE_DISCOUNT_METADATA_KEY } from "../../../../lib/wholesale-pricing"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

type Tier = {
  tier_type: string
  discount_percent: number
  waive_order_minimum?: boolean
}

type Variant = {
  id: string
  calculated_price?: { calculated_amount?: number | string | null } | null
}

const makeScope = ({
  cart,
  products = [],
  variants = [],
  tiersBySeller = new Map<string, Tier>(),
  minimumsBySeller = new Map<
    string,
    { min_order_value: number; min_order_items: number }
  >(),
}: {
  cart: Record<string, unknown> | null
  products?: Array<{ id: string; seller?: { id: string } | null }>
  variants?: Variant[]
  tiersBySeller?: Map<string, Tier>
  minimumsBySeller?: Map<
    string,
    { min_order_value: number; min_order_items: number }
  >
}) => {
  const cartModule = {
    updateLineItems: jest.fn(async () => {}),
    updateCarts: jest.fn(async () => {}),
  }
  const vendorRules = {
    getCustomerTiersForSellers: jest.fn(async () => tiersBySeller),
    getOrderMinimumsForSellers: jest.fn(async (sellerIds: string[]) => {
      const map = new Map<
        string,
        { min_order_value: number; min_order_items: number }
      >()
      for (const sellerId of sellerIds) {
        map.set(
          sellerId,
          minimumsBySeller.get(sellerId) ?? {
            min_order_value: 0,
            min_order_items: 1,
          }
        )
      }
      return map
    }),
  }
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "cart") return { data: cart ? [cart] : [] }
      if (entity === "product") return { data: products }
      if (entity === "product_variant") return { data: variants }
      throw new Error(`unexpected graph entity: ${entity}`)
    }),
  }
  const scope = {
    resolve: (key: string) => {
      if (key === Modules.CART) return cartModule
      if (key === VENDOR_RULES_MODULE) return vendorRules
      if (key === ContainerRegistrationKeys.QUERY) return query
      throw new Error(`unexpected resolve: ${key}`)
    },
  }
  return { scope, cartModule, vendorRules, query }
}

const baseCart = (overrides: Record<string, unknown> = {}) => ({
  id: "cart_1",
  metadata: {},
  currency_code: "usd",
  customer_id: "cus_1",
  items: [
    {
      id: "li_1",
      product_id: "prod_1",
      quantity: 5,
      unit_price: 10, // major units => 1000 minor
      is_custom_price: false,
      metadata: {},
    },
  ],
  ...overrides,
})

const sellerProducts = [{ id: "prod_1", seller: { id: "seller_1" } }]

const wholesaleTier = (overrides: Partial<Tier> = {}): Tier => ({
  tier_type: CustomerTierType.WHOLESALE,
  discount_percent: 45,
  waive_order_minimum: false,
  ...overrides,
})

describe("store cart wholesale route", () => {
  it("404s when the cart does not exist", async () => {
    const { scope } = makeScope({ cart: null })
    const res = createRes()
    await POST({ params: { id: "cart_missing" }, scope } as any, res)

    expect(res.statusCode).toBe(404)
  })

  it("no-ops with applied:false for an anonymous cart", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart({ customer_id: null }),
      products: sellerProducts,
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      cart_id: "cart_1",
      applied: false,
      reason: "no_customer",
    })
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
  })

  it("falls back to the session's customer actor when the cart is unclaimed", async () => {
    const { scope, vendorRules } = makeScope({
      cart: baseCart({ customer_id: null }),
      products: sellerProducts,
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST(
      {
        params: { id: "cart_1" },
        auth_context: { actor_type: "customer", actor_id: "cus_session" },
        scope,
      } as any,
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)
    expect(vendorRules.getCustomerTiersForSellers).toHaveBeenCalledWith(
      ["seller_1"],
      "cus_session"
    )
  })

  it("no-ops with applied:false when the customer has no tier", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map(),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ cart_id: "cart_1", applied: false })
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    expect(cartModule.updateCarts).not.toHaveBeenCalled()
  })

  it("no-ops for a non-wholesale tier with no discount", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([
        [
          "seller_1",
          { tier_type: CustomerTierType.REGULAR, discount_percent: 0 },
        ],
      ]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.body).toEqual({ cart_id: "cart_1", applied: false })
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
  })

  it("applies the WHOLESALE discount and stashes the base price", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      cart_id: "cart_1",
      applied: true,
      line_items_repriced: 1,
      sellers: ["seller_1"],
    })
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      {
        id: "li_1",
        unit_price: 5.5, // 1000 minor - 45 % = 550 minor
        is_custom_price: true,
        metadata: {
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
          [WHOLESALE_DISCOUNT_METADATA_KEY]: 45,
        },
      },
    ])
    expect(cartModule.updateCarts).toHaveBeenCalledWith("cart_1", {
      metadata: { wholesale_applied: true },
    })
  })

  it("applies a non-wholesale tier that carries a discount (e.g. PREFERRED)", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([
        [
          "seller_1",
          { tier_type: CustomerTierType.PREFERRED, discount_percent: 10 },
        ],
      ]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.body.applied).toBe(true)
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: "li_1", unit_price: 9 }),
    ])
  })

  it("re-POST is a no-op: derives from the variant price and never compounds", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart({
        metadata: { wholesale_applied: true },
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            variant_id: "var_1",
            quantity: 5,
            unit_price: 5.5, // already discounted from the listed 10
            is_custom_price: true,
            metadata: {
              [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
              [BASE_CURRENCY_METADATA_KEY]: "usd",
              [WHOLESALE_DISCOUNT_METADATA_KEY]: 45,
            },
          },
        ],
      }),
      products: sellerProducts,
      variants: [{ id: "var_1", calculated_price: { calculated_amount: 10 } }],
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)
    expect(res.body.line_items_repriced).toBe(0)
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    expect(cartModule.updateCarts).not.toHaveBeenCalled()
  })

  it("400s with moq_unmet and applies NO price changes when minimums are unmet", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
      // discounted subtotal is 550 * 5 = 2750 minor < 5000
      minimumsBySeller: new Map([
        ["seller_1", { min_order_value: 5000, min_order_items: 1 }],
      ]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({
      code: "moq_unmet",
      unmet: [
        {
          seller_id: "seller_1",
          unmet: [
            { code: "min_order_value", required: 5000, actual: 2750 },
          ],
        },
      ],
    })
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    expect(cartModule.updateCarts).not.toHaveBeenCalled()
  })

  it("enforces min_order_items across the seller's line quantities", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
      minimumsBySeller: new Map([
        ["seller_1", { min_order_value: 0, min_order_items: 10 }],
      ]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe("moq_unmet")
    expect(res.body.unmet[0].unmet).toEqual([
      { code: "min_order_items", required: 10, actual: 5 },
    ])
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
  })

  it("gates a 0 %-discount WHOLESALE tier on MOQ too", async () => {
    const { scope } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([
        ["seller_1", wholesaleTier({ discount_percent: 0 })],
      ]),
      minimumsBySeller: new Map([
        ["seller_1", { min_order_value: 0, min_order_items: 10 }],
      ]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe("moq_unmet")
  })

  it("waive_order_minimum bypasses the MOQ gate", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      tiersBySeller: new Map([
        ["seller_1", wholesaleTier({ waive_order_minimum: true })],
      ]),
      minimumsBySeller: new Map([
        ["seller_1", { min_order_value: 999999, min_order_items: 999 }],
      ]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: "li_1", unit_price: 5.5 }),
    ])
  })

  it("only reprices items from sellers where the tier applies", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart({
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            quantity: 5,
            unit_price: 10,
            is_custom_price: false,
            metadata: {},
          },
          {
            id: "li_2",
            product_id: "prod_2",
            quantity: 1,
            unit_price: 20,
            is_custom_price: false,
            metadata: {},
          },
        ],
      }),
      products: [
        { id: "prod_1", seller: { id: "seller_1" } },
        { id: "prod_2", seller: { id: "seller_2" } },
      ],
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.line_items_repriced).toBe(1)
    expect(res.body.sellers).toEqual(["seller_1"])
    const updated = (
      cartModule.updateLineItems.mock.calls[0] as unknown[]
    )[0] as Array<{ id: string }>
    expect(updated.map((u) => u.id)).toEqual(["li_1"])
  })

  it("ignores a stashed base from another currency (the stash is never a pricing input)", async () => {
    // Historically this guarded the currency-mismatch rule (B-money-7). Since
    // the base-poisoning fix, the metadata stash is never read as a pricing
    // base at all, so a foreign-currency stash is ignored trivially: with no
    // variant price available the base re-derives from the current line price.
    const { scope, cartModule } = makeScope({
      cart: baseCart({
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            quantity: 5,
            unit_price: 10,
            is_custom_price: false,
            metadata: {
              [BASE_UNIT_PRICE_METADATA_KEY]: 900, // captured in eur
              [BASE_CURRENCY_METADATA_KEY]: "eur",
            },
          },
        ],
      }),
      products: sellerProducts,
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    // base re-derived from the current usd price (1000), not the eur stash
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({
        unit_price: 5.5,
        metadata: expect.objectContaining({
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
        }),
      }),
    ])
  })

  it("derives the base from the variant's calculated price, never a poisoned stash", async () => {
    // Regression (security audit: repricing base poisoning): line-item
    // metadata is buyer-writable. A hostile client stashes an inflated
    // "base" (and the current unit_price has drifted too); the written
    // price must derive from the variant's authoritative price.
    const { scope, cartModule, query } = makeScope({
      cart: baseCart({
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            variant_id: "var_1",
            quantity: 5,
            unit_price: 8, // drifted from the listed 10
            is_custom_price: false,
            metadata: {
              [BASE_UNIT_PRICE_METADATA_KEY]: 999900, // hostile, same currency
              [BASE_CURRENCY_METADATA_KEY]: "usd",
            },
          },
        ],
      }),
      products: sellerProducts,
      variants: [{ id: "var_1", calculated_price: { calculated_amount: 10 } }],
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)
    // 1000 minor (variant price) - 45 % = 550 minor, NOT 999900 - 45 % and
    // NOT 800 - 45 %; the stash is overwritten with the trusted base.
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      {
        id: "li_1",
        unit_price: 5.5,
        is_custom_price: true,
        metadata: {
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
          [WHOLESALE_DISCOUNT_METADATA_KEY]: 45,
        },
      },
    ])
    // The authoritative price is fetched for the cart's variants in the
    // cart's currency.
    const variantCall = query.graph.mock.calls
      .map((call) => call[0] as any)
      .find((arg) => arg.entity === "product_variant")
    expect(variantCall).toBeDefined()
    expect(variantCall.filters).toEqual({ id: ["var_1"] })
    expect(variantCall.context.calculated_price).toMatchObject({
      currency_code: "usd",
    })
  })

  it("falls back to the current unit_price base when the variant has no calculated price", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart({
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            variant_id: "var_1",
            quantity: 5,
            unit_price: 10,
            is_custom_price: false,
            // even in the fallback path a stashed "base" must stay dead
            metadata: { [BASE_UNIT_PRICE_METADATA_KEY]: 999900 },
          },
        ],
      }),
      products: sellerProducts,
      variants: [{ id: "var_1", calculated_price: null }],
      tiersBySeller: new Map([["seller_1", wholesaleTier()]]),
    })
    const res = createRes()
    await POST({ params: { id: "cart_1" }, scope } as any, res)

    expect(res.statusCode).toBe(200)
    // base = toMinor(10) = 1000, from the line's unit_price
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({
        unit_price: 5.5,
        metadata: expect.objectContaining({
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
        }),
      }),
    ])
  })
})
