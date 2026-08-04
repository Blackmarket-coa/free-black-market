import { processChannelOrderSync } from "../channel-order-sync"
import { CHANNEL_CONNECTOR_MODULE } from "../../modules/channel-connector/module-key"
import { shouldAttemptNow } from "../../modules/channel-connector/throttle"
import { ChannelApiError } from "../../modules/channel-connector/types"

/**
 * Exactly-once ingestion, because both failure modes cost real money: stock
 * taken twice for one sale is a phantom stockout, stock never taken is an
 * oversell on a real buyer.
 */

const mockPullOrders = jest.fn()
jest.mock("../../modules/channel-connector/adapters", () => ({
  getChannelAdapter: (id: string) =>
    id === "faire"
      ? {
          id: "faire",
          capabilities: ["pull_orders"],
          supports: (c: string) => c === "pull_orders",
          pullOrders: (...args: unknown[]) => mockPullOrders(...args),
        }
      : null,
}))

const mockVariants = jest.fn()
const mockApply = jest.fn()
jest.mock("../../shared/channel-inventory", () => ({
  loadSellerVariantContexts: () => mockVariants(),
  applyChannelInventory: (_c: unknown, adj: unknown[]) => mockApply(adj),
}))

const order = (externalId: string, sku = "A", quantity = 2) => ({
  external_id: externalId,
  placed_at: new Date("2026-08-02T10:00:00Z"),
  currency_code: "USD",
  total_amount: 1_000,
  buyer_name: null,
  buyer_email: null,
  shipping_address: null,
  items: [{ sku, title: "Item", quantity, unit_amount: 500 }],
  channel_fee_amount: 100,
  raw: {},
})

const makeContainer = (
  opts: {
    stored?: Record<string, { id: string; inventory_applied: boolean }>
    connections?: Record<string, unknown>[]
  } = {}
) => {
  const stored = { ...(opts.stored ?? {}) }
  const recordOrder = jest.fn(async (input: { order: { external_id: string } }) => {
    const row = { id: `co_${input.order.external_id}`, inventory_applied: false }
    stored[input.order.external_id] = row
    return row
  })
  const markInventoryApplied = jest.fn(async (id: string, _report?: unknown) => {
    const key = Object.keys(stored).find((k) => stored[k].id === id)
    if (key) stored[key].inventory_applied = true
  })
  const recordSync = jest.fn(async (_input: Record<string, unknown>) => undefined)

  const recordFailure = jest.fn(
    async (_input: {
      row: { id: string; channel_id: string }
      status: number
      retryAfterSeconds?: number | null
      message?: string
      now?: Date
    }) => undefined
  )
  const recordSuccess = jest.fn(async (_id: string, _now?: Date) => undefined)
  const service = {
    // The real gate rather than a constant, so a stub cannot quietly disagree
    // with what the service actually does.
    mayAttempt: (row: { throttled_until?: Date | null }, now: Date) =>
      shouldAttemptNow({ throttled_until: row.throttled_until ?? null }, now),
    recordFailure,
    recordSuccess,
    listChannelConnections: async () =>
      opts.connections ?? [
        {
          id: "cc_1",
          seller_id: "sel_1",
          channel_id: "faire",
          api_base_url: "https://faire.test",
          access_token: "tok",
          enabled: true,
          orders_synced_through: new Date("2026-08-01T00:00:00Z"),
        },
      ],
    toCredentials: () => ({ api_base_url: "https://faire.test", access_token: "tok" }),
    findOrder: async (_c: string, externalId: string) => stored[externalId] ?? null,
    recordOrder,
    markInventoryApplied,
    recordSync,
  }

  return {
    container: {
      resolve: (k: string) => (k === CHANNEL_CONNECTOR_MODULE ? service : undefined),
    },
    recordOrder,
    markInventoryApplied,
    recordSync,
    recordFailure,
    recordSuccess,
    stored,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVariants.mockResolvedValue([
    {
      sku: "A",
      variant_id: "var_A",
      manage_inventory: true,
      inventory_item_id: "iitem_A",
      location_id: "sloc_1",
    },
  ])
  mockApply.mockImplementation(async (adj: unknown[]) =>
    (adj as Record<string, unknown>[]).map((a) => ({ ...a, applied: true }))
  )
})

describe("processChannelOrderSync", () => {
  it("ingests a new order and decrements the shared pool", async () => {
    mockPullOrders.mockResolvedValue([order("bo_1")])
    const { container, recordOrder, markInventoryApplied } = makeContainer()

    const result = await processChannelOrderSync(container as never)

    expect(result).toMatchObject({ fetched: 1, ingested: 1, skipped: 0 })
    expect(recordOrder).toHaveBeenCalled()
    expect(mockApply).toHaveBeenCalledWith([
      expect.objectContaining({ sku: "A", quantity: 2 }),
    ])
    expect(markInventoryApplied).toHaveBeenCalled()
  })

  it("never decrements twice for the same sale", async () => {
    // The phantom-stockout guard. A re-poll returning the same order must do
    // nothing at all to stock.
    mockPullOrders.mockResolvedValue([order("bo_1")])
    const { container } = makeContainer({
      stored: { bo_1: { id: "co_bo_1", inventory_applied: true } },
    })

    const result = await processChannelOrderSync(container as never)

    expect(result).toMatchObject({ skipped: 1, ingested: 0 })
    expect(mockApply).not.toHaveBeenCalled()
  })

  it("finishes an order recorded but never decremented", async () => {
    // The oversell guard: a crash between the two steps left stock un-taken.
    // The next poll must complete it without creating a second record.
    mockPullOrders.mockResolvedValue([order("bo_1")])
    const { container, recordOrder, markInventoryApplied } = makeContainer({
      stored: { bo_1: { id: "co_bo_1", inventory_applied: false } },
    })

    const result = await processChannelOrderSync(container as never)

    expect(result).toMatchObject({ replayed: 1, ingested: 0 })
    expect(recordOrder).not.toHaveBeenCalled()
    expect(mockApply).toHaveBeenCalled()
    expect(markInventoryApplied).toHaveBeenCalledWith(
      "co_bo_1",
      expect.anything()
    )
  })

  it("counts and reports lines whose SKU matched nothing", async () => {
    // Every one of these is a sale whose stock did not move — the most
    // important thing this job can surface.
    mockPullOrders.mockResolvedValue([order("bo_1", "GHOST")])
    const { container, recordSync } = makeContainer()

    const result = await processChannelOrderSync(container as never)

    expect(result.unmatched_lines).toBe(1)
    expect(recordSync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({
          unmatched: [
            { external_id: "bo_1", sku: "GHOST", reason: "unknown_sku" },
          ],
        }),
      })
    )
  })

  it("advances the cursor to the latest ingested order, not the clock", async () => {
    // A clock cursor skips anything the channel had not yet returned.
    mockPullOrders.mockResolvedValue([
      { ...order("bo_1"), placed_at: new Date("2026-08-02T10:00:00Z") },
      { ...order("bo_2"), placed_at: new Date("2026-08-03T08:00:00Z") },
    ])
    const { container, recordSync } = makeContainer()

    await processChannelOrderSync(container as never, {
      now: new Date("2026-08-09T00:00:00Z"),
    })

    const call = recordSync.mock.calls.at(-1)?.[0] as {
      orders_synced_through: Date
    }
    expect(call.orders_synced_through.toISOString()).toBe(
      "2026-08-03T08:00:00.000Z"
    )
  })

  it("leaves the cursor alone when the poll itself fails", async () => {
    // Advancing past orders we never saw would lose them permanently. Since
    // Phase 12 a channel answer goes through `recordFailure` — which writes the
    // error and a backoff, and touches no cursor field at all.
    mockPullOrders.mockRejectedValue(
      new ChannelApiError("rate limited", 429, "faire")
    )
    const { container, recordSync, recordFailure } = makeContainer()

    const result = await processChannelOrderSync(container as never)

    expect(result.failed).toBe(1)
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 429,
        message: expect.stringContaining("rate limited"),
      })
    )
    // Nothing wrote a cursor: the poll saw no orders to advance past.
    for (const [call] of recordSync.mock.calls) {
      expect((call as Record<string, unknown>).orders_synced_through).toBeUndefined()
    }
  })

  it("records a non-channel error without standing the connection down", async () => {
    // A bug on our side, or an adapter throwing before it reached the network.
    // Pausing a channel because of our own defect would hide it behind what
    // looks like an outage on theirs.
    mockPullOrders.mockRejectedValue(new Error("undefined is not a function"))
    const { container, recordSync, recordFailure } = makeContainer()

    const result = await processChannelOrderSync(container as never)

    expect(result.failed).toBe(1)
    expect(recordFailure).not.toHaveBeenCalled()
    const call = recordSync.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(call.error).toContain("undefined is not a function")
  })

  it("does not advance past an order that failed to ingest", async () => {
    mockPullOrders.mockResolvedValue([
      { ...order("bo_1"), placed_at: new Date("2026-08-02T10:00:00Z") },
      { ...order("bo_2"), placed_at: new Date("2026-08-03T08:00:00Z") },
    ])
    const { container, recordSync } = makeContainer()
    // Second order blows up mid-ingest.
    mockApply
      .mockImplementationOnce(async (adj: unknown[]) =>
        (adj as Record<string, unknown>[]).map((a) => ({ ...a, applied: true }))
      )
      .mockRejectedValueOnce(new Error("inventory module down"))

    const result = await processChannelOrderSync(container as never)

    expect(result.failed).toBe(1)
    const call = recordSync.mock.calls.at(-1)?.[0] as {
      orders_synced_through: Date
    }
    // Stops at the one that succeeded, so the failed order is re-read.
    expect(call.orders_synced_through.toISOString()).toBe(
      "2026-08-02T10:00:00.000Z"
    )
  })

  it("resolves the catalogue once per connection, not per order", async () => {
    mockPullOrders.mockResolvedValue([order("bo_1"), order("bo_2"), order("bo_3")])
    const { container } = makeContainer()

    await processChannelOrderSync(container as never)

    expect(mockVariants).toHaveBeenCalledTimes(1)
  })

  it("skips a paused connection entirely", async () => {
    const { container } = makeContainer()
    ;(container.resolve(CHANNEL_CONNECTOR_MODULE) as {
      listChannelConnections: () => Promise<unknown[]>
    }).listChannelConnections = async () => [
      { id: "cc_1", seller_id: "sel_1", channel_id: "faire", enabled: false },
    ]

    const result = await processChannelOrderSync(container as never)
    expect(result.connections).toBe(0)
    expect(mockPullOrders).not.toHaveBeenCalled()
  })

  it("does no catalogue work when a poll returns nothing", async () => {
    mockPullOrders.mockResolvedValue([])
    const { container, recordSync } = makeContainer()

    const result = await processChannelOrderSync(container as never)

    expect(result.fetched).toBe(0)
    expect(mockVariants).not.toHaveBeenCalled()
    expect(recordSync).toHaveBeenCalledWith(
      expect.objectContaining({ error: null })
    )
  })

  describe("standing down (Phase 12)", () => {
    const now = new Date("2026-08-04T12:00:00.000Z")

    it("does not poll a connection that is still backing off", async () => {
      const { container } = makeContainer({
        connections: [
          {
            id: "cc_1",
            seller_id: "sel_1",
            channel_id: "faire",
            api_base_url: "https://faire.test",
            access_token: "tok",
            enabled: true,
            orders_synced_through: null,
            throttled_until: new Date("2026-08-04T12:30:00.000Z"),
          },
        ],
      })

      const result = await processChannelOrderSync(container as never, { now })

      expect(result.throttled).toBe(1)
      expect(result.connections).toBe(0)
      expect(mockPullOrders).not.toHaveBeenCalled()
    })

    it("passes the channel's own Retry-After through to the backoff", async () => {
      mockPullOrders.mockRejectedValue(
        new ChannelApiError("slow down", 429, "faire", undefined, 1_800)
      )
      const { container, recordFailure } = makeContainer()

      await processChannelOrderSync(container as never, { now })

      expect(recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ status: 429, retryAfterSeconds: 1_800 })
      )
    })

    it("clears the stand-down as soon as the channel answers", async () => {
      // An empty poll still proves the channel is reachable and the credentials
      // are live. Holding a backoff open through it would penalise a quiet
      // vendor for being quiet.
      mockPullOrders.mockResolvedValue([])
      const { container, recordSuccess } = makeContainer()

      await processChannelOrderSync(container as never, { now })

      expect(recordSuccess).toHaveBeenCalledWith("cc_1", now)
    })
  })
})
