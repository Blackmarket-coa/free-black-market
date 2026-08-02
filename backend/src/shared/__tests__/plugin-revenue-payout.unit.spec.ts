import { disbursePluginDeveloperShare } from "../plugin-revenue-payout"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"

/**
 * A revenue share is the least important thing happening on an order, so every
 * failure mode here has to degrade rather than propagate — the settlement that
 * funds the share must never fail because of it.
 */

const makeContainer = (opts: {
  platformBalance?: number
  transferThrows?: string[]
  ledgerMissing?: boolean
} = {}) => {
  const transfers: Record<string, unknown>[] = []

  const hawala = {
    getOrCreateSystemAccount: jest.fn(async (t: string) => ({ id: `acc_${t}` })),
    getOrCreateSellerEarnings: jest.fn(async (s: string) => ({ id: `acc_${s}` })),
    getAccountBalance: jest.fn(async () => ({
      available_balance: opts.platformBalance ?? 1000,
    })),
    createTransfer: jest.fn(async (data: Record<string, unknown>) => {
      const slug = (data.metadata as { plugin_slug?: string })?.plugin_slug
      if (slug && opts.transferThrows?.includes(slug)) {
        throw new Error(`transfer failed for ${slug}`)
      }
      transfers.push(data)
      return { id: `le_${transfers.length}` }
    }),
  }

  const container = {
    resolve: (key: string) => {
      if (key === HAWALA_LEDGER_MODULE) {
        if (opts.ledgerMissing) throw new Error("ledger module unavailable")
        return hawala
      }
      return undefined
    },
  }

  return { container, hawala, transfers }
}

const allocation = (slug: string, dev: string, cents: number) => ({
  slug,
  author_seller_id: dev,
  amount_cents: cents,
})

describe("disbursePluginDeveloperShare", () => {
  it("pays each developer out of the platform-fee account", async () => {
    const { container, transfers } = makeContainer()
    const result = await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      allocations: [allocation("analytics", "sel_dev", 150)],
    })

    expect(result).toEqual({ transferred: 1, deferred: 0, failed: 0 })
    // Debited from money the platform already collected, never from escrow —
    // so an unfunded transfer can never touch the customer's payment.
    expect(transfers[0].debit_account_id).toBe("acc_PLATFORM_FEE")
    expect(transfers[0].credit_account_id).toBe("acc_sel_dev")
    expect(transfers[0].amount).toBe(1.5)
  })

  it("keys idempotency on the plugin, not the developer", async () => {
    // One developer with two installed plugins is owed two shares; keying on
    // the developer would silently collapse the second.
    const { container, transfers } = makeContainer()
    await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      allocations: [
        allocation("a", "sel_dev", 50),
        allocation("b", "sel_dev", 50),
      ],
    })

    expect(transfers.map((t) => t.idempotency_key)).toEqual([
      "plugin-share:order_1:a",
      "plugin-share:order_1:b",
    ])
  })

  it("defers rather than overdrawing the platform account", async () => {
    // The platform-fee leg may not have posted yet on a slow settlement. The
    // money is owed and the breakdown records it; an overdraft would put the
    // platform negative against money it has not received.
    const { container, transfers } = makeContainer({ platformBalance: 0.5 })
    const result = await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      allocations: [allocation("a", "sel_dev", 150)],
    })

    expect(result.deferred).toBe(1)
    expect(result.transferred).toBe(0)
    expect(transfers).toHaveLength(0)
  })

  it("keeps paying the others when one leg fails", async () => {
    const { container, transfers } = makeContainer({ transferThrows: ["b"] })
    const result = await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      allocations: [
        allocation("a", "sel_a", 50),
        allocation("b", "sel_b", 50),
        allocation("c", "sel_c", 50),
      ],
    })

    expect(result).toEqual({ transferred: 2, deferred: 0, failed: 1 })
    expect(transfers.map((t) => t.reference_id)).toEqual(["order_1", "order_1"])
  })

  it("does not throw when the ledger is unavailable", async () => {
    const { container } = makeContainer({ ledgerMissing: true })
    const result = await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      allocations: [allocation("a", "sel_dev", 50)],
    })

    expect(result).toEqual({ transferred: 0, deferred: 0, failed: 1 })
  })

  it("does nothing at all with no allocations", async () => {
    const { container, hawala } = makeContainer()
    const result = await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      allocations: [],
    })

    expect(result).toEqual({ transferred: 0, deferred: 0, failed: 0 })
    expect(hawala.getOrCreateSystemAccount).not.toHaveBeenCalled()
  })

  it("credits the developer in the order's currency", async () => {
    const { container, hawala } = makeContainer()
    await disbursePluginDeveloperShare(container as never, {
      orderId: "order_1",
      sellerId: "sel_vendor",
      currencyCode: "eur",
      allocations: [allocation("a", "sel_dev", 50)],
    })

    expect(hawala.getOrCreateSellerEarnings).toHaveBeenCalledWith("sel_dev", "EUR")
  })
})
