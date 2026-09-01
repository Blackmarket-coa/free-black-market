import {
  itemCount,
  loadOrderForSellerPush,
  pushToOrderSeller,
  resolveNativePush,
} from "../native-push-seller"

/**
 * Container/query doubles. `pushToOrderSeller` is the shared path behind
 * both the order.placed and order.canceled seller pushes, and its whole
 * contract is "never throw, never send when you shouldn't" — so these
 * tests are mostly about the soft-fail branches.
 */
const makeContainer = (opts: {
  nativePush?: unknown
  graph?: (args: unknown) => Promise<{ data: unknown[] }>
  missingModule?: boolean
}) => ({
  resolve: (key: string) => {
    if (key === "query") {
      return {
        graph:
          opts.graph ??
          (async () => ({
            data: [],
          })),
      }
    }
    if (opts.missingModule) {
      throw new Error(`module ${key} not registered`)
    }
    return opts.nativePush
  },
})

const makePush = (
  overrides: Partial<{
    configured: boolean
    summary: {
      configured: boolean
      sent: string[]
      invalid: string[]
      failed: string[]
    }
    onSend: (sellerId: string, notification: unknown) => void
  }> = {}
) => {
  const summary = overrides.summary ?? {
    configured: true,
    sent: ["tok_1"],
    invalid: [],
    failed: [],
  }
  return {
    isSendingConfigured: () => overrides.configured ?? true,
    sendToSeller: async (sellerId: string, notification: unknown) => {
      overrides.onSend?.(sellerId, notification)
      return summary
    },
  }
}

const ORDER_WITH_SELLER = {
  id: "order_1",
  display_id: 42,
  total: 2500,
  currency_code: "usd",
  items: [{ quantity: 2 }, { quantity: 1 }],
  seller: { id: "sel_1", name: "Test Farm" },
}

describe("itemCount", () => {
  it("sums line item quantities", () => {
    expect(itemCount(ORDER_WITH_SELLER)).toBe(3)
  })

  it("is zero for missing, empty, or malformed items", () => {
    expect(itemCount({ id: "o" })).toBe(0)
    expect(itemCount({ id: "o", items: [] })).toBe(0)
    expect(
      itemCount({
        id: "o",
        items: [{ quantity: null }, { quantity: undefined }],
      })
    ).toBe(0)
  })
})

describe("resolveNativePush", () => {
  it("returns null instead of throwing when the module is absent", () => {
    expect(resolveNativePush(makeContainer({ missingModule: true }))).toBeNull()
  })
})

describe("loadOrderForSellerPush", () => {
  it("returns the first matching order", async () => {
    const container = makeContainer({
      graph: async () => ({ data: [ORDER_WITH_SELLER] }),
    })
    await expect(loadOrderForSellerPush(container, "order_1")).resolves.toEqual(
      ORDER_WITH_SELLER
    )
  })

  it("returns null when the query throws", async () => {
    const container = makeContainer({
      graph: async () => {
        throw new Error("db down")
      },
    })
    await expect(loadOrderForSellerPush(container, "order_1")).resolves.toBeNull()
  })

  it("returns null when no order matches", async () => {
    const container = makeContainer({ graph: async () => ({ data: [] }) })
    await expect(loadOrderForSellerPush(container, "nope")).resolves.toBeNull()
  })
})

describe("pushToOrderSeller", () => {
  it("sends to the seller linked to the order", async () => {
    const sends: Array<{ sellerId: string; notification: any }> = []
    const container = makeContainer({
      nativePush: makePush({
        onSend: (sellerId, notification) =>
          sends.push({ sellerId, notification }),
      }),
      graph: async () => ({ data: [ORDER_WITH_SELLER] }),
    })

    await pushToOrderSeller(container, "order_1", (order) => ({
      title: "New order",
      body: `#${order.display_id}`,
      data: { path: `/vendor/orders/${order.id}` },
    }))

    expect(sends).toHaveLength(1)
    expect(sends[0].sellerId).toBe("sel_1")
    expect(sends[0].notification.title).toBe("New order")
    expect(sends[0].notification.data.path).toBe("/vendor/orders/order_1")
  })

  it("does not send when the order has no linked seller", async () => {
    let sent = false
    const container = makeContainer({
      nativePush: makePush({ onSend: () => (sent = true) }),
      graph: async () => ({ data: [{ id: "order_2", seller: null }] }),
    })
    await pushToOrderSeller(container, "order_2", () => ({
      title: "t",
      body: "b",
    }))
    expect(sent).toBe(false)
  })

  it("does not query or send when FCM is unconfigured", async () => {
    let queried = false
    let sent = false
    const container = makeContainer({
      nativePush: makePush({ configured: false, onSend: () => (sent = true) }),
      graph: async () => {
        queried = true
        return { data: [ORDER_WITH_SELLER] }
      },
    })
    await pushToOrderSeller(container, "order_1", () => ({
      title: "t",
      body: "b",
    }))
    expect(queried).toBe(false)
    expect(sent).toBe(false)
  })

  it("is a no-op when the native-push module is not registered", async () => {
    const container = makeContainer({ missingModule: true })
    await expect(
      pushToOrderSeller(container, "order_1", () => ({ title: "t", body: "b" }))
    ).resolves.toBeUndefined()
  })

  it("never throws when delivery fails", async () => {
    const container = makeContainer({
      nativePush: {
        isSendingConfigured: () => true,
        sendToSeller: async () => {
          throw new Error("fcm exploded")
        },
      },
      graph: async () => ({ data: [ORDER_WITH_SELLER] }),
    })
    await expect(
      pushToOrderSeller(container, "order_1", () => ({ title: "t", body: "b" }))
    ).resolves.toBeUndefined()
  })
})
