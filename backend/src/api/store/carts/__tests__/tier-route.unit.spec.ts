import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../[id]/tier/route"
import { PLAYBOOK_MODULE } from "../../../../modules/playbook"
import {
  BASE_CURRENCY_METADATA_KEY,
  BASE_UNIT_PRICE_METADATA_KEY,
} from "../../../../lib/sliding-scale"

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

type Variant = {
  id: string
  calculated_price?: { calculated_amount?: number | string | null } | null
}

const makeScope = ({
  cart,
  products = [],
  variants = [],
  assignments = [],
}: {
  cart: Record<string, unknown> | null
  products?: Array<{
    id: string
    metadata?: Record<string, unknown> | null
    seller?: { id: string } | null
  }>
  variants?: Variant[]
  assignments?: Array<{ seller_id: string; recipe_id: string | null }>
}) => {
  const cartModule = {
    updateLineItems: jest.fn(async () => {}),
    updateCarts: jest.fn(async () => {}),
  }
  const playbookService = {
    listPlaybookAssignments: jest.fn(async () => assignments),
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
      if (key === PLAYBOOK_MODULE) return playbookService
      if (key === ContainerRegistrationKeys.QUERY) return query
      throw new Error(`unexpected resolve: ${key}`)
    },
  }
  return { scope, cartModule, playbookService, query }
}

const baseCart = (overrides: Record<string, unknown> = {}) => ({
  id: "cart_1",
  metadata: {},
  currency_code: "usd",
  items: [
    {
      id: "li_1",
      product_id: "prod_1",
      variant_id: "var_1",
      unit_price: 10, // major units => 1000 minor
      is_custom_price: false,
      metadata: {},
    },
  ],
  ...overrides,
})

const sellerProducts = [
  { id: "prod_1", metadata: {}, seller: { id: "seller_1" } },
]

// atelier has allow_sliding_scale: true; stall does not.
const slidingAssignments = [{ seller_id: "seller_1", recipe_id: "atelier" }]

const listedVariants: Variant[] = [
  { id: "var_1", calculated_price: { calculated_amount: 10 } },
]

const post = async (
  scope: unknown,
  tier: unknown,
  id = "cart_1"
): Promise<any> => {
  const res = createRes()
  await POST({ params: { id }, body: { tier }, scope } as any, res)
  return res
}

describe("store cart tier route", () => {
  it("400s on an invalid tier", async () => {
    const { scope, cartModule } = makeScope({ cart: baseCart() })
    const res = await post(scope, "bogus")

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain("tier must be one of")
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
  })

  it("404s when the cart does not exist", async () => {
    const { scope } = makeScope({ cart: null })
    const res = await post(scope, "solidarity", "cart_missing")

    expect(res.statusCode).toBe(404)
  })

  it("applies the solidarity tier off the variant price and stashes the base", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      variants: listedVariants,
      assignments: slidingAssignments,
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      cart_id: "cart_1",
      tier: "solidarity",
      line_items_repriced: 1,
    })
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      {
        id: "li_1",
        unit_price: 6.5, // 1000 minor * 6500 bps = 650 minor
        is_custom_price: true,
        metadata: {
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
          sliding_scale_tier: "solidarity",
        },
      },
    ])
    expect(cartModule.updateCarts).toHaveBeenCalledWith("cart_1", {
      metadata: { tier: "solidarity" },
    })
  })

  it("applies the supporter tier markup", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      variants: listedVariants,
      assignments: slidingAssignments,
    })
    const res = await post(scope, "supporter")

    expect(res.statusCode).toBe(200)
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "li_1",
        unit_price: 12.5, // 1000 minor * 12500 bps = 1250 minor
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
      variants: listedVariants,
      assignments: slidingAssignments,
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(200)
    // 1000 minor (variant price) * 65 % = 650 minor, NOT 999900 * 65 % and
    // NOT 800 * 65 %; the stash is overwritten with the trusted base.
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      {
        id: "li_1",
        unit_price: 6.5,
        is_custom_price: true,
        metadata: {
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
          sliding_scale_tier: "solidarity",
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
            unit_price: 10,
            is_custom_price: false,
            // even in the fallback path a stashed "base" must stay dead
            metadata: { [BASE_UNIT_PRICE_METADATA_KEY]: 999900 },
          },
        ],
      }),
      products: sellerProducts,
      variants: [{ id: "var_1", calculated_price: null }],
      assignments: slidingAssignments,
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(200)
    // base = toMinor(10) = 1000, from the line's unit_price
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({
        unit_price: 6.5,
        metadata: expect.objectContaining({
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
        }),
      }),
    ])
  })

  it("ignores a stashed base from another currency (the stash is never a pricing input)", async () => {
    // Mirrors the wholesale spec's B-money-7 case. Since the base-poisoning
    // fix the stash is never read at all, so a foreign-currency stash is
    // ignored trivially: with no variant price available the base re-derives
    // from the current line price and is re-stashed in the cart currency.
    const { scope, cartModule } = makeScope({
      cart: baseCart({
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            variant_id: null,
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
      assignments: slidingAssignments,
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(200)
    // base re-derived from the current usd price (1000), not the eur stash
    expect(cartModule.updateLineItems).toHaveBeenCalledWith([
      expect.objectContaining({
        unit_price: 6.5,
        metadata: expect.objectContaining({
          [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
          [BASE_CURRENCY_METADATA_KEY]: "usd",
        }),
      }),
    ])
  })

  it("leaves items untouched when the seller's playbook disallows sliding scale", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart(),
      products: sellerProducts,
      variants: listedVariants,
      assignments: [{ seller_id: "seller_1", recipe_id: "stall" }],
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(200)
    expect(res.body.line_items_repriced).toBe(0)
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    // the buyer's tier choice is still recorded on the cart
    expect(cartModule.updateCarts).toHaveBeenCalledWith("cart_1", {
      metadata: { tier: "solidarity" },
    })
  })

  it("re-applying the same tier is a no-op", async () => {
    const { scope, cartModule } = makeScope({
      cart: baseCart({
        metadata: { tier: "solidarity" },
        items: [
          {
            id: "li_1",
            product_id: "prod_1",
            variant_id: "var_1",
            unit_price: 6.5, // already priced off the listed 10
            is_custom_price: true,
            metadata: {
              [BASE_UNIT_PRICE_METADATA_KEY]: 1000,
              [BASE_CURRENCY_METADATA_KEY]: "usd",
              sliding_scale_tier: "solidarity",
            },
          },
        ],
      }),
      products: sellerProducts,
      variants: listedVariants,
      assignments: slidingAssignments,
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(200)
    expect(res.body.line_items_repriced).toBe(0)
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    expect(cartModule.updateCarts).not.toHaveBeenCalled()
  })
})
