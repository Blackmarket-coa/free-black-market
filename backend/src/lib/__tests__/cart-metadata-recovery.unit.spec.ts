/**
 * Recovering cart metadata that FBM's main checkout path drops.
 *
 * `splitAndCompleteCartWorkflow` builds its order payload by hand and has no
 * `metadata` key, so anything the storefront stamped on the cart is gone by
 * the time an `order.placed` subscriber runs. The same workflow records the
 * originating `cart_id` on an `order_set`, which is what makes recovery
 * possible. D9-5 in docs/AUDIT_DEBT.md.
 */
import { getOrderCartMetadata } from "../cart-metadata-recovery"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const makeContainer = (opts: {
  cartId?: string | null
  cartMetadata?: Record<string, unknown>
  throwOn?: "order_set" | "cart"
}) => {
  const graph = jest.fn(async ({ entity }: { entity: string; [k: string]: unknown }) => {
    if (entity === "order_set") {
      if (opts.throwOn === "order_set") throw new Error("link table gone")
      return { data: opts.cartId ? [{ cart_id: opts.cartId }] : [] }
    }
    if (entity === "cart") {
      if (opts.throwOn === "cart") throw new Error("cart read failed")
      return { data: [{ metadata: opts.cartMetadata ?? {} }] }
    }
    throw new Error(`unexpected entity: ${entity}`)
  })

  return {
    container: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unresolvable: ${String(key)}`)
      },
    } as never,
    graph,
  }
}

const KEYS = ["donation_total", "donation_beneficiary_id", "storefront_id"] as const

describe("getOrderCartMetadata", () => {
  it("recovers the donation preferences the checkout dropped", async () => {
    // The failure this fixes: order.metadata is empty, so the subscriber's
    // guard returned early and the buyer's donation was never accrued.
    const { container } = makeContainer({
      cartId: "cart_1",
      cartMetadata: {
        donation_total: 500,
        donation_beneficiary_id: "ben_1",
        storefront_id: "sf_1",
      },
    })

    const out = await getOrderCartMetadata(container, { id: "order_1", metadata: {} }, KEYS)

    expect(out.donation_total).toBe(500)
    expect(out.donation_beneficiary_id).toBe("ben_1")
    expect(out.storefront_id).toBe("sf_1")
  })

  it("skips the lookup entirely when the order already carries the data", async () => {
    // The other completion routes wrap Medusa's completeCartWorkflow and do
    // propagate. Those must not pay for two extra queries.
    const { container, graph } = makeContainer({ cartId: "cart_1" })

    const out = await getOrderCartMetadata(
      container,
      { id: "order_1", metadata: { donation_total: 750, donation_beneficiary_id: "ben_x" } },
      KEYS
    )

    expect(graph).not.toHaveBeenCalled()
    expect(out.donation_total).toBe(750)
  })

  it("lets the order win on any key it carries", async () => {
    // An operator may have edited the order after the fact; the cart is a
    // fallback, not the source of truth.
    const { container } = makeContainer({
      cartId: "cart_1",
      cartMetadata: { donation_total: 500, storefront_id: "sf_cart" },
    })

    const out = await getOrderCartMetadata(
      container,
      { id: "order_1", metadata: { donation_total: 999 } },
      ["nothing_here"]
    )

    expect(out.donation_total).toBe(999)
    expect(out.storefront_id).toBe("sf_cart")
  })

  it("returns the order's own metadata when no order_set is found", async () => {
    const { container } = makeContainer({ cartId: null })
    const out = await getOrderCartMetadata(
      container,
      { id: "order_1", metadata: { unrelated: 1 } },
      KEYS
    )
    expect(out).toEqual({ unrelated: 1 })
  })

  it("never throws when the link lookup fails", async () => {
    // This runs inside an order.placed subscriber; failing to recover an
    // optional preference must not fail the order.
    const { container } = makeContainer({ throwOn: "order_set" })
    await expect(
      getOrderCartMetadata(container, { id: "order_1", metadata: {} }, KEYS)
    ).resolves.toEqual({})
  })

  it("never throws when the cart read fails", async () => {
    const { container } = makeContainer({ cartId: "cart_1", throwOn: "cart" })
    await expect(
      getOrderCartMetadata(container, { id: "order_1", metadata: {} }, KEYS)
    ).resolves.toEqual({})
  })

  it("tolerates a null metadata on the order", async () => {
    const { container } = makeContainer({ cartId: "cart_1", cartMetadata: { a: 1 } })
    const out = await getOrderCartMetadata(container, { id: "order_1", metadata: null }, KEYS)
    expect(out.a).toBe(1)
  })

  it("looks the order_set up by the order's own id", async () => {
    const { container, graph } = makeContainer({ cartId: "cart_1", cartMetadata: {} })
    await getOrderCartMetadata(container, { id: "order_42", metadata: {} }, KEYS)
    const call = graph.mock.calls.find((c) => c[0].entity === "order_set")!
    expect(JSON.stringify(call[0].filters)).toContain("order_42")
  })
})
