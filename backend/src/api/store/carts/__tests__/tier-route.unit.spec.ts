// SD-115: the route ends in a cart refresh, which is Medusa's workflow and
// runs for real in integration-tests/http/cart-payment-refresh.spec.ts. Here
// it is a recorder: when it is called, for which cart, and what the caller is
// told when it fails.
const refreshCartAfterReprice = jest.fn()
jest.mock("../../../../lib/cart-payment-refresh", () => ({
  refreshCartAfterReprice: (...args: unknown[]) => refreshCartAfterReprice(...args),
}))
const logError = jest.fn()
jest.mock("../../../../shared/logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => logError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../[id]/tier/route"
import { PLAYBOOK_MODULE } from "../../../../modules/playbook"
import {
  BASE_CURRENCY_METADATA_KEY,
  BASE_UNIT_PRICE_METADATA_KEY,
} from "../../../../lib/sliding-scale"
import { CART_ALREADY_COMPLETED_MESSAGE, CART_PAYMENT_REFRESH_FAILED_MESSAGE } from "../../../../lib/cart-payment-amount"

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

beforeEach(() => {
  logError.mockClear()
  refreshCartAfterReprice.mockReset()
  refreshCartAfterReprice.mockResolvedValue(undefined)
})

describe("store cart tier route", () => {
  it("400s on an invalid tier", async () => {
    const { scope, cartModule } = makeScope({ cart: baseCart() })
    const res = await post(scope, "bogus")

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain("tier must be one of")
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    expect(refreshCartAfterReprice).not.toHaveBeenCalled()
  })

  it("404s when the cart does not exist", async () => {
    const { scope } = makeScope({ cart: null })
    const res = await post(scope, "solidarity", "cart_missing")

    expect(res.statusCode).toBe(404)
    expect(refreshCartAfterReprice).not.toHaveBeenCalled()
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

  it("refuses a cart that has already completed before it reads or writes anything else (SD-115 review)", async () => {
    // The refresh this route ends in refuses a completed cart, so the lines
    // were repriced and every call then answered 500 cart_payment_refresh_failed.
    const { scope, cartModule, query, playbookService } = makeScope({
      cart: baseCart({ completed_at: "2026-11-16T12:00:00.000Z" }),
      products: sellerProducts,
      variants: listedVariants,
      assignments: slidingAssignments,
    })
    const res = await post(scope, "solidarity")

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ code: "cart_already_completed", type: "invalid_data", message: CART_ALREADY_COMPLETED_MESSAGE })
    expect(query.graph).toHaveBeenCalledTimes(1)
    expect(playbookService.listPlaybookAssignments).not.toHaveBeenCalled()
    expect(cartModule.updateLineItems).not.toHaveBeenCalled()
    expect(cartModule.updateCarts).not.toHaveBeenCalled()
    expect(refreshCartAfterReprice).not.toHaveBeenCalled()
  })

  describe("the currency's minor unit (SD-115 review: the lookup was case-sensitive and every currency got two decimals)", () => {
    const repriceIn = async (currency: string, listed: number) => {
      const { scope, cartModule, query } = makeScope({
        cart: baseCart({
          currency_code: currency,
          items: [{ id: "li_1", product_id: "prod_1", variant_id: "var_1", unit_price: listed, is_custom_price: false, metadata: {} }],
        }),
        products: sellerProducts,
        variants: [{ id: "var_1", calculated_price: { calculated_amount: listed } }],
        assignments: slidingAssignments,
      })
      const res = await post(scope, "solidarity")
      expect(res.statusCode).toBe(200)
      return { update: (cartModule.updateLineItems.mock.calls as unknown as Array<[Array<Record<string, any>>]>)[0][0][0], query }
    }

    it("prices a yen line in whole yen: 65% of 999 is 649, not 649.35", async () => {
      const { update } = await repriceIn("jpy", 999)
      expect(update.unit_price).toBe(649)
      expect(update.metadata[BASE_UNIT_PRICE_METADATA_KEY]).toBe(999)
      expect(update.metadata[BASE_CURRENCY_METADATA_KEY]).toBe("jpy")
    })

    it("keeps a dinar's third decimal: 65% of 1.999 is 1.299, not 1.30", async () => {
      const { update } = await repriceIn("bhd", 1.999)
      expect(update.unit_price).toBe(1.299)
      expect(update.metadata[BASE_UNIT_PRICE_METADATA_KEY]).toBe(1999)
    })

    it("reads an upper-case code the same way, and asks for the variant's price in the cart's currency", async () => {
      const { update, query } = await repriceIn("JPY", 999)
      expect(update.unit_price).toBe(649)
      expect(update.metadata[BASE_CURRENCY_METADATA_KEY]).toBe("jpy")
      const variantRead = query.graph.mock.calls.map((c: unknown[]) => c[0] as Record<string, any>).find((a) => a.entity === "product_variant")
      expect(variantRead?.context?.calculated_price).toMatchObject({ currency_code: "jpy" })
    })

    it("still treats a code Medusa's table does not have as two decimals", async () => {
      const { update } = await repriceIn("zzz", 10)
      expect(update.unit_price).toBe(6.5)
      expect(update.metadata[BASE_UNIT_PRICE_METADATA_KEY]).toBe(1000)
    })
  })

  describe("the cart refresh after the reprice (SD-115)", () => {
    const repricing = () =>
      makeScope({
        cart: baseCart(),
        products: sellerProducts,
        variants: listedVariants,
        assignments: slidingAssignments,
      })

    it("runs after the line items are written, for this cart, before the route answers", async () => {
      const { scope, cartModule } = repricing()
      const order: string[] = []
      cartModule.updateLineItems.mockImplementation(async () => {
        order.push("reprice")
      })
      cartModule.updateCarts.mockImplementation(async () => {
        order.push("metadata")
      })
      refreshCartAfterReprice.mockImplementation(async () => {
        order.push("refresh")
      })
      const res = await post(scope, "solidarity")

      expect(order).toEqual(["reprice", "metadata", "refresh"])
      expect(refreshCartAfterReprice).toHaveBeenCalledTimes(1)
      expect(refreshCartAfterReprice).toHaveBeenCalledWith(scope, "cart_1")
      expect(res.statusCode).toBe(200)
      expect(res.body.line_items_repriced).toBe(1)
    })

    it("runs on a call that reprices nothing too, so that repeating a call whose refresh failed is the cure", async () => {
      const { scope, cartModule } = makeScope({
        cart: baseCart(),
        products: sellerProducts,
        variants: listedVariants,
        assignments: [{ seller_id: "seller_1", recipe_id: "stall" }],
      })
      const res = await post(scope, "solidarity")

      expect(cartModule.updateLineItems).not.toHaveBeenCalled()
      expect(refreshCartAfterReprice).toHaveBeenCalledWith(scope, "cart_1")
      expect(res.statusCode).toBe(200)
    })

    it("when it fails the route does not answer success: 500 cart_payment_refresh_failed, and the failure is logged with the cart", async () => {
      const { scope, cartModule } = repricing()
      refreshCartAfterReprice.mockRejectedValue(new Error("Failed to acquire lock for key cart_1"))
      const res = await post(scope, "solidarity")

      expect(cartModule.updateLineItems).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(500)
      expect(res.body).toEqual({
        code: "cart_payment_refresh_failed",
        type: "cart_payment_refresh_failed",
        message: CART_PAYMENT_REFRESH_FAILED_MESSAGE,
      })
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("Failed to acquire lock"), { cart_id: "cart_1" })
    })

    it("does not run when the reprice itself failed", async () => {
      const { scope, cartModule } = repricing()
      cartModule.updateLineItems.mockRejectedValue(new Error("write failed"))

      await expect(post(scope, "solidarity")).rejects.toThrow("write failed")
      expect(refreshCartAfterReprice).not.toHaveBeenCalled()
    })
  })
})
