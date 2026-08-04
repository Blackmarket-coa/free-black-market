import { processChannelOrderSync } from "../channel-order-sync"
import { CHANNEL_CONNECTOR_MODULE } from "../../modules/channel-connector/module-key"
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

const makeContainer = (opts: { stored?: Record<string, { id: string; inventory_applied: boolean }> } = {}) => {
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

  const service = {
    listChannelConnections: async () => [
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
    // Advancing past orders we never saw would lose them permanently.
    mockPullOrders.mockRejectedValue(
      new ChannelApiError("rate limited", 429, "faire")
    )
    const { container, recordSync } = makeContainer()

    const result = await processChannelOrderSync(container as never)

    expect(result.failed).toBe(1)
    const call = recordSync.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(call.orders_synced_through).toBeUndefined()
    expect(call.error).toContain("rate limited")
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
})
