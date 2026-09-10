/**
 * Channel attribution on order.placed.
 *
 * The live failure this locks out: `POST /store/carts/:id/channel` writes
 * `order_channel` onto the CART, on its own stated expectation that the value
 * "propagates to order.metadata at completion". On FBM's main checkout path it
 * does not — `splitAndCompleteCartWorkflow` drops cart metadata (D9-5) — and
 * this subscriber read `order.metadata` directly. Every POS, vending and
 * pickup sale therefore resolved to the `online` default. That is worse than a
 * missing number: the channel report looked complete and was wrong.
 */
import handler from "../attribute-channel-on-placed"
import { ORDER_CHANNEL_MODULE } from "../../modules/order-channel"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const makeContainer = (opts: {
  orderMetadata?: Record<string, unknown> | null
  cartMetadata?: Record<string, unknown>
  cartId?: string | null
  graphThrows?: boolean
}) => {
  const channels = { setChannelForOrder: jest.fn(async () => ({})) }

  // Two different reads hit `entity: "order"` — the subscriber's own fetch and
  // the recovery traversal of `order.order_set.cart_id` — so they are told
  // apart by `fields`. Recovery does NOT filter `order_set` on a nested
  // `orders.id`: `RemoteQueryFilters` accepts only direct fields, and the
  // nested form passes plain `tsc` then fails `medusa build`.
  const graph = jest.fn(async (args: { entity: string; fields?: string[] }) => {
    const { entity, fields } = args
    const isRecovery = !!fields?.includes("order_set.cart_id")

    if (entity === "order" && !isRecovery) {
      return {
        data: [
          {
            id: "order_1",
            customer_id: "cus_1",
            metadata: opts.orderMetadata ?? {},
          },
        ],
      }
    }
    if (opts.graphThrows) throw new Error("link table missing")
    if (entity === "order" && isRecovery) {
      return {
        data:
          opts.cartId === null
            ? [{ order_set: null }]
            : [{ order_set: { cart_id: opts.cartId ?? "cart_1" } }],
      }
    }
    if (entity === "cart") return { data: [{ metadata: opts.cartMetadata ?? {} }] }
    throw new Error(`unexpected entity ${entity}`)
  })

  const container = {
    resolve: (key: string) => {
      if (key === ORDER_CHANNEL_MODULE) return channels
      if (key === "query" || key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }
      throw new Error(`unresolvable: ${String(key)}`)
    },
  }

  return { container, channels, graph }
}

const run = (container: unknown) =>
  handler({ event: { data: { id: "order_1" } }, container } as never)

describe("attribute-channel-on-placed", () => {
  it("recovers the channel the checkout path dropped from the order", async () => {
    const { container, channels } = makeContainer({
      orderMetadata: {},
      cartMetadata: { order_channel: "pos" },
    })

    await run(container)

    expect(channels.setChannelForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "order_1", channel: "pos" })
    )
  })

  it("prefers the order's own stamp over the cart's", async () => {
    // A server-side flow that stamps the order directly is the more recent
    // and more specific statement; the cart is only the fallback.
    const { container, channels } = makeContainer({
      orderMetadata: { order_channel: "vending" },
      cartMetadata: { order_channel: "pos" },
    })

    await run(container)

    expect(channels.setChannelForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "vending" })
    )
  })

  it("still defaults to online when neither carries a stamp", async () => {
    const { container, channels } = makeContainer({
      orderMetadata: {},
      cartMetadata: {},
    })

    await run(container)

    expect(channels.setChannelForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "online" })
    )
  })

  it("still records a channel when the cart cannot be reached", async () => {
    // Recovery is best-effort. Losing it must not lose the attribution row.
    const { container, channels } = makeContainer({
      orderMetadata: {},
      graphThrows: true,
    })

    await run(container)

    expect(channels.setChannelForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "online" })
    )
  })
})
