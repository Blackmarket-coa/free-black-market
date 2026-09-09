import orderPlacedHandler, { config } from "../order-cycle-order-placed"
import { ORDER_CYCLE_MODULE } from "../../modules/order-cycle"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The order-cycle sale recorder — a complete consumer that had no producer.
 *
 * It reads the cycle off each line item's metadata. That carrier is not a
 * preference: FBM checks out through `@mercurjs/b2c-core`, whose
 * `splitAndCompleteCartWorkflow` builds its order payload by hand and never
 * copies `cart.metadata` onto the orders, while it does carry line-item
 * metadata (`prepareLineItemData({ ..., metadata: item?.metadata })`).
 *
 * Per item is also the right unit: Mercur splits one cart into one order per
 * seller, and `recordSale` works per variant.
 */
const makeContainer = (
  order: Record<string, unknown> | null,
  opts: { retrieveThrows?: string[]; recordThrowsFor?: string[] } = {}
) => {
  const recordSale = jest.fn(async (cycleId: string, variantId: string) => {
    if (opts.recordThrowsFor?.includes(variantId)) {
      throw new Error("Product not found in order cycle")
    }
    return { cycleId, variantId }
  })
  const retrieveOrderCycle = jest.fn(async (id: string) => {
    if (opts.retrieveThrows?.includes(id)) throw new Error("not found")
    return { id, status: "open" }
  })
  const create = jest.fn(async () => undefined)

  return {
    recordSale,
    retrieveOrderCycle,
    create,
    container: {
      resolve: (key: string) => {
        if (key === ORDER_CYCLE_MODULE) return { recordSale, retrieveOrderCycle }
        if (key === ContainerRegistrationKeys.QUERY) {
          return { graph: async () => ({ data: order ? [order] : [] }) }
        }
        if (key === ContainerRegistrationKeys.REMOTE_LINK) return { create }
        return undefined
      },
    },
  }
}

const run = async (ctx: ReturnType<typeof makeContainer>) =>
  orderPlacedHandler({
    event: { name: "order.placed", data: { id: "order_1" } },
    container: ctx.container,
  } as never)

const item = (
  variantId: string,
  quantity: number,
  cycleId?: string
): Record<string, unknown> => ({
  variant_id: variantId,
  quantity,
  metadata: cycleId ? { order_cycle_id: cycleId } : null,
})

describe("order-cycle sale recording", () => {
  it("listens to order.placed", () => {
    expect(config.event).toBe("order.placed")
  })

  it("records each item against the cycle its own line names", async () => {
    const ctx = makeContainer({
      id: "order_1",
      metadata: null,
      items: [item("v_1", 2, "oc_1"), item("v_2", 1, "oc_1")],
    })

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledWith("oc_1", "v_1", 2)
    expect(ctx.recordSale).toHaveBeenCalledWith("oc_1", "v_2", 1)
    expect(ctx.create).toHaveBeenCalledTimes(1)
  })

  it("splits a mixed order across both cycles instead of losing one", async () => {
    // The reason for per-item over a single order-level tag: with one tag, the
    // second cycle's items were recorded against the first — silently, since a
    // per-item miss is swallowed as "product might not be in the cycle".
    const ctx = makeContainer({
      id: "order_1",
      metadata: null,
      items: [item("v_1", 2, "oc_1"), item("v_2", 3, "oc_2")],
    })

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledWith("oc_1", "v_1", 2)
    expect(ctx.recordSale).toHaveBeenCalledWith("oc_2", "v_2", 3)
    expect(ctx.create).toHaveBeenCalledTimes(2)
  })

  it("ignores items with no cycle on them", async () => {
    const ctx = makeContainer({
      id: "order_1",
      metadata: null,
      items: [item("v_1", 2, "oc_1"), item("v_2", 1)],
    })

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledTimes(1)
    expect(ctx.recordSale).toHaveBeenCalledWith("oc_1", "v_1", 2)
  })

  it("falls back to an order-level tag for paths that do propagate it", async () => {
    // FBM's other completion routes wrap Medusa's own completeCartWorkflow,
    // which does copy cart.metadata onto the order.
    const ctx = makeContainer({
      id: "order_1",
      metadata: { order_cycle_id: "oc_legacy" },
      items: [item("v_1", 2), item("v_2", 1)],
    })

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledWith("oc_legacy", "v_1", 2)
    expect(ctx.recordSale).toHaveBeenCalledWith("oc_legacy", "v_2", 1)
  })

  it("prefers the line's own cycle over the order-level one", async () => {
    const ctx = makeContainer({
      id: "order_1",
      metadata: { order_cycle_id: "oc_order" },
      items: [item("v_1", 1, "oc_item")],
    })

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledWith("oc_item", "v_1", 1)
    expect(ctx.recordSale).not.toHaveBeenCalledWith("oc_order", "v_1", 1)
  })

  it("does nothing for an order that went through no cycle", async () => {
    const ctx = makeContainer({
      id: "order_1",
      metadata: null,
      items: [item("v_1", 1), item("v_2", 2)],
    })

    await run(ctx)

    expect(ctx.recordSale).not.toHaveBeenCalled()
    expect(ctx.create).not.toHaveBeenCalled()
  })

  it("skips a cycle that no longer exists without abandoning the others", async () => {
    const ctx = makeContainer(
      {
        id: "order_1",
        metadata: null,
        items: [item("v_1", 1, "oc_gone"), item("v_2", 1, "oc_1")],
      },
      { retrieveThrows: ["oc_gone"] }
    )

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledTimes(1)
    expect(ctx.recordSale).toHaveBeenCalledWith("oc_1", "v_2", 1)
  })

  it("keeps going when one item cannot be recorded", async () => {
    const ctx = makeContainer(
      {
        id: "order_1",
        metadata: null,
        items: [item("v_bad", 1, "oc_1"), item("v_good", 2, "oc_1")],
      },
      { recordThrowsFor: ["v_bad"] }
    )

    await run(ctx)

    expect(ctx.recordSale).toHaveBeenCalledWith("oc_1", "v_good", 2)
    expect(ctx.create).toHaveBeenCalledTimes(1)
  })

  it("does not throw when the order is missing", async () => {
    const ctx = makeContainer(null)
    await expect(run(ctx)).resolves.toBeUndefined()
    expect(ctx.recordSale).not.toHaveBeenCalled()
  })

  it("ignores a non-string cycle id rather than coercing it", async () => {
    const ctx = makeContainer({
      id: "order_1",
      metadata: { order_cycle_id: 42 },
      items: [{ variant_id: "v_1", quantity: 1, metadata: { order_cycle_id: true } }],
    })

    await run(ctx)

    expect(ctx.recordSale).not.toHaveBeenCalled()
  })
})
