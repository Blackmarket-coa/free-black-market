import { validateOrderCycleOnCompleteCart } from "../validate-order-cycle"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"

/**
 * D9-1/D9-3: a cart cannot complete against a closed cycle or past capacity.
 *
 * The cases that matter are the two the audit named as unfixed — a cart tagged
 * with a cycle that closed hours ago, and a cart built when stock was free and
 * completed after it went. Both used to pass silently and record a sale.
 */

const OPEN = { status: "open", name: "Week 12" }

const makeCtx = (opts: {
  cart?: Record<string, unknown>
  cycle?: Record<string, unknown> | null
  products?: Array<Record<string, unknown>>
  cycleThrows?: boolean
  productsThrow?: boolean
}) => ({
  container: {
    resolve: (key: string) => {
      if (key === "query") {
        return {
          graph: async () => ({ data: opts.cart ? [opts.cart] : [] }),
        }
      }
      if (key === ORDER_CYCLE_MODULE) {
        return {
          retrieveOrderCycle: async () => {
            if (opts.cycleThrows || opts.cycle === null) throw new Error("not found")
            return opts.cycle ?? OPEN
          },
          listOrderCycleProducts: async () => {
            if (opts.productsThrow) throw new Error("unavailable")
            return opts.products ?? []
          },
        }
      }
      throw new Error(`unresolvable: ${key}`)
    },
  },
})

const ARGS = { input: { cart_id: "cart_1" } }

const cartWith = (items: Array<Record<string, unknown>>, metadata = {}) => ({
  id: "cart_1",
  metadata,
  items,
})

const run = (ctx: ReturnType<typeof makeCtx>) =>
  validateOrderCycleOnCompleteCart(ARGS as never, ctx as never)

describe("validateOrderCycleOnCompleteCart", () => {
  it("resolves the module by the key the module actually registers", () => {
    // The hook names the module by string to stay out of its import graph.
    // If that key drifts from the module's own constant the guard silently
    // resolves nothing and stops guarding, so the two are pinned together.
    expect(ORDER_CYCLE_MODULE).toBe("orderCycleModuleService")
  })

  it("ignores a cart with no order-cycle items", async () => {
    await expect(
      run(makeCtx({ cart: cartWith([{ variant_id: "v1", quantity: 2 }]) }))
    ).resolves.toBeUndefined()
  })

  it("allows a cart inside capacity on an open cycle", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 3, metadata: { order_cycle_id: "oc_1" } },
          ]),
          products: [{ variant_id: "v1", available_quantity: 10, sold_quantity: 4 }],
        })
      )
    ).resolves.toBeUndefined()
  })

  it("allows an unlimited item (null capacity) whatever the quantity", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 999, metadata: { order_cycle_id: "oc_1" } },
          ]),
          products: [{ variant_id: "v1", available_quantity: null, sold_quantity: 40 }],
        })
      )
    ).resolves.toBeUndefined()
  })

  it("refuses a cycle that closed before checkout — D9-3's real gap", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 1, metadata: { order_cycle_id: "oc_1" } },
          ]),
          cycle: { status: "closed", name: "Week 11" },
        })
      )
    ).rejects.toThrow(/no longer taking orders/i)
  })

  it("refuses a cycle that no longer exists", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 1, metadata: { order_cycle_id: "oc_1" } },
          ]),
          cycleThrows: true,
        })
      )
    ).rejects.toThrow(/no longer exists/i)
  })

  it("refuses a quantity past what is left — D9-1's preventable half", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 5, metadata: { order_cycle_id: "oc_1" } },
          ]),
          products: [{ variant_id: "v1", available_quantity: 10, sold_quantity: 8 }],
        })
      )
    ).rejects.toThrow(/Only 2 left/i)
  })

  it("says sold out rather than 'only 0 left' when nothing remains", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 1, metadata: { order_cycle_id: "oc_1" } },
          ]),
          products: [{ variant_id: "v1", available_quantity: 10, sold_quantity: 10 }],
        })
      )
    ).rejects.toThrow(/sold out/i)
  })

  it("sums the same variant across lines before comparing", async () => {
    // Two cart lines of the same variant are individually inside capacity and
    // together are not. Checking them one at a time would pass both.
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 3, metadata: { order_cycle_id: "oc_1" } },
            { variant_id: "v1", quantity: 3, metadata: { order_cycle_id: "oc_1" } },
          ]),
          products: [{ variant_id: "v1", available_quantity: 10, sold_quantity: 6 }],
        })
      )
    ).rejects.toThrow(/Only 4 left/i)
  })

  it("honours a cart-level cycle tag when items carry none", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([{ variant_id: "v1", quantity: 9 }], {
            order_cycle_id: "oc_1",
          }),
          products: [{ variant_id: "v1", available_quantity: 10, sold_quantity: 8 }],
        })
      )
    ).rejects.toThrow(/Only 2 left/i)
  })

  it("refuses an item the cycle no longer offers", async () => {
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v_gone", quantity: 1, metadata: { order_cycle_id: "oc_1" } },
          ]),
          products: [{ variant_id: "v1", available_quantity: 10, sold_quantity: 0 }],
        })
      )
    ).rejects.toThrow(/no longer offered/i)
  })

  it("lets the sale through when the stock read fails", async () => {
    // Refusing a checkout we cannot prove is bad would turn a database blip
    // into lost sales. The post-payment path records and reports an overshoot,
    // which is the safer of the two failures.
    await expect(
      run(
        makeCtx({
          cart: cartWith([
            { variant_id: "v1", quantity: 1, metadata: { order_cycle_id: "oc_1" } },
          ]),
          productsThrow: true,
        })
      )
    ).resolves.toBeUndefined()
  })

  it("does nothing without a cart id or container", async () => {
    await expect(
      validateOrderCycleOnCompleteCart({ input: {} } as never, {} as never)
    ).resolves.toBeUndefined()
  })
})
